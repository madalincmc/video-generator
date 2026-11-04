# Runs inside Blender. Builds a scene.py, then renders the frames render.mjs asked for.
# Lines starting with [bv] are the only ones render.mjs shows by default.
import importlib.util
import json
import os
import random
import sys
import tempfile
import time

sys.dont_write_bytecode = True

import bpy  # noqa: E402
import numpy as np  # noqa: E402

job = json.loads(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8').read())
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

SCENE_DIR = os.path.normcase(os.path.dirname(os.path.abspath(job['scene'])))
ALLOWED_WRITES = [SCENE_DIR, os.path.normcase(os.path.abspath(tempfile.gettempdir()))]
BLOCKED_EVENTS = (
    'subprocess.Popen', 'os.system', 'os.exec', 'os.spawn', 'os.posix_spawn', 'os.startfile',
    'socket.connect', 'socket.bind', 'socket.sendto', 'socket.getaddrinfo', 'urllib.Request',
)
PATH_EVENTS = ('os.remove', 'os.rename', 'os.rmdir', 'os.mkdir', 'os.link', 'os.symlink', 'shutil.rmtree', 'shutil.move', 'shutil.copyfile')
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def log(message):
    print(f'[bv] {message}', flush=True)


def allowed_path(path):
    if isinstance(path, bytes):
        path = os.fsdecode(path)
    if not isinstance(path, (str, os.PathLike)):
        return True
    path = os.path.normcase(os.path.abspath(path))
    return any(path == root or path.startswith(root + os.sep) for root in ALLOWED_WRITES)


# Stops a scene from reaching the network, launching programs or changing files elsewhere by
# accident. It only sees Python-level calls, so it is a guard rail and not a security sandbox.
def guard(event, args):
    if event in BLOCKED_EVENTS:
        raise PermissionError(f'Scenes may not use {event}.')
    if event == 'open':
        path, mode, flags = args
        writing = (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (isinstance(flags, int) and flags & WRITE_FLAGS)
        if writing and not allowed_path(path):
            raise PermissionError(f'Scenes may only write inside their own folder: {path}')
    elif event in PATH_EVENTS and not all(allowed_path(p) for p in args[:2] if isinstance(p, (str, bytes, os.PathLike))):
        raise PermissionError(f'Scenes may only change files inside their own folder: {event} {args[:2]}')


def load_scene(path):
    spec = importlib.util.spec_from_file_location('scene', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, 'config') or not hasattr(module, 'build'):
        raise RuntimeError('A scene must define `config` and `build(ctx)`.')
    return module


def use_best_device():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
        except Exception:
            continue
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for device in prefs.devices:
                device.use = device.type == backend
            return 'GPU', f'{gpus[0].name} ({backend})'
    return 'CPU', 'CPU'


def configure(scene, config, low_quality):
    render = scene.render
    scale = 1.0
    if low_quality:
        scale = min(job['tileSize'] / config['width'], job['tileSize'] / config['height'])
    render.resolution_x = max(2, round(config['width'] * scale / 2) * 2)
    render.resolution_y = max(2, round(config['height'] * scale / 2) * 2)
    render.resolution_percentage = 100
    render.fps = config['fps']
    scene.frame_start = 1
    scene.frame_end = round(config['duration'] * config['fps'])
    render.image_settings.file_format = 'PNG'
    render.image_settings.color_mode = 'RGB'
    render.image_settings.color_depth = '8'
    render.use_file_extension = False
    render.use_motion_blur = config.get('motion_blur', True)
    render.motion_blur_shutter = config.get('shutter', 0.5)
    render.use_persistent_data = True
    render.film_transparent = False

    scene.view_settings.view_transform = config.get('view', 'AgX')
    look = config.get('look', 'AgX - Medium High Contrast')
    if look:
        scene.view_settings.look = look
    scene.view_settings.exposure = config.get('exposure', 0.0)

    engine = config.get('engine', 'CYCLES')
    render.engine = {'EEVEE': 'BLENDER_EEVEE', 'CYCLES': 'CYCLES'}[engine]
    if engine != 'CYCLES':
        scene.eevee.taa_render_samples = job['previewSamples'] if low_quality else config.get('samples', 24)
        return f'{engine} on the GPU'

    device, label = use_best_device()
    cycles = scene.cycles
    cycles.device = device
    cycles.samples = job['previewSamples'] if low_quality else config.get('samples', 24)
    cycles.use_adaptive_sampling = True
    cycles.adaptive_threshold = 0.06 if low_quality else config.get('noise_threshold', 0.02)
    cycles.seed = config.get('seed', 1)
    cycles.use_animated_seed = False
    cycles.use_denoising = True
    cycles.denoiser = 'OPENIMAGEDENOISE'
    cycles.denoising_use_gpu = True
    cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cycles.denoising_prefilter = 'FAST' if low_quality else 'ACCURATE'
    cycles.max_bounces = config.get('bounces', 8)
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    cycles.sample_clamp_indirect = 8
    cycles.volume_step_rate = 4 if low_quality else 1.5
    render.use_simplify = low_quality
    if low_quality:
        render.simplify_child_particles_render = 0.25
        cycles.texture_limit_render = '1024'
    return f'Cycles on {label}'


def check_no_external_files():
    external = [i.filepath for i in bpy.data.images if i.source in {'FILE', 'SEQUENCE', 'MOVIE'} and i.filepath]
    external += [lib.filepath for lib in bpy.data.libraries]
    external += [m.filepath for m in bpy.data.movieclips]
    external += [s.filepath for s in bpy.data.sounds]
    if external:
        raise RuntimeError(f'Everything must be generated by the scene, but it loads external files: {external[:5]}')


def render_frame(scene, frame, path):
    # Written under a temporary name, so a killed render never counts as a finished frame.
    partial = f'{path}.partial.png'
    scene.frame_set(frame)
    scene.render.filepath = partial
    bpy.ops.render.render(write_still=True)
    if not os.path.exists(partial) or os.path.getsize(partial) == 0:
        raise RuntimeError(f'Frame {frame} produced no image at {partial}. If Blender logged a memory error, simplify the scene.')
    os.replace(partial, path)


def image_stats(path):
    image = bpy.data.images.load(path, check_existing=False)
    pixels = np.empty(image.size[0] * image.size[1] * image.channels, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    width = image.size[0]
    channels = image.channels
    bpy.data.images.remove(image)
    rgb = pixels.reshape(-1, channels)[:, :3]
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return {'luma': luma, 'width': width}


def report_stats(paths, times):
    previous = None
    still = 0
    for path, t in zip(paths, times):
        stats = image_stats(path)
        luma = stats['luma']
        mean = float(luma.mean())
        blown = float((luma > 0.98).mean()) * 100
        black = float((luma < 0.02).mean()) * 100
        notes = []
        if blown > 20:
            notes.append('BLOWN OUT')
        if black > 45:
            notes.append('VERY DARK')
        if mean < 0.08:
            notes.append('UNDEREXPOSED')
        if previous is not None and previous.size == luma.size and float(np.abs(previous - luma).mean()) < 0.002:
            still += 1
        previous = luma
        suffix = f'  <-- {", ".join(notes)}' if notes else ''
        log(f't={t:5.2f}s  brightness {mean:.2f}  blown {blown:4.1f}%  black {black:4.1f}%{suffix}')
    if still:
        log(f'WARNING: {still} of {len(paths) - 1} neighbouring samples barely change. Check that things actually move.')


def main():
    random.seed(0)
    module_started = time.time()
    sys.addaudithook(guard)

    module = load_scene(job['scene'])
    config = {'fps': 24, 'width': 1920, 'height': 1080, 'seed': 1, **module.config}
    if 'duration' not in config:
        raise RuntimeError('config needs a duration in seconds.')
    if config['width'] % 2 or config['height'] % 2:
        raise RuntimeError('width and height must be even numbers.')
    random.seed(config['seed'])
    np.random.seed(config['seed'])

    kit.reset(config)
    scene = bpy.context.scene
    low_quality = job['mode'] in {'preview', 'range'}
    device = configure(scene, config, low_quality)
    module.build(kit.Context(config, low_quality))
    check_no_external_files()
    if scene.camera is None:
        raise RuntimeError('The scene has no active camera. Use kit.camera(...) or kit.cut(...).')

    total = round(config['duration'] * config['fps'])
    log(f'{device}, built in {time.time() - module_started:.1f}s, {total} frames at {scene.render.resolution_x}x{scene.render.resolution_y}')
    log(f'config fps={config["fps"]} total={total}')

    if config.get('simulate') and job['mode'] != 'full':
        # Physics caches need every frame in order, even when only a few get rendered.
        last = total
        if job['mode'] == 'at':
            last = min(total, 1 + round(job['at'] * config['fps']))
        for frame in range(1, last + 1):
            scene.frame_set(frame)

    os.makedirs(job['outDir'], exist_ok=True)
    if job['mode'] in {'preview', 'range'}:
        start, end = (0.0, config['duration'])
        if job['mode'] == 'range':
            start, end = job['range']
            if not (0 <= start < end <= config['duration']):
                raise RuntimeError(f'--range must fall within 0..{config["duration"]}')
        first = 1 + start * config['fps']
        last = min(total, 1 + end * config['fps'])
        frames = sorted({round(first + (last - first) * k / (job['tiles'] - 1)) for k in range(job['tiles'])})
        paths = []
        times = []
        began = time.time()
        for index, frame in enumerate(frames):
            path = os.path.join(job['outDir'], f'tile-{index:02d}.png')
            render_frame(scene, frame, path)
            paths.append(path)
            times.append((frame - 1) / config['fps'])
        log(f'{len(frames)} samples in {time.time() - began:.1f}s')
        report_stats(paths, times)
    elif job['mode'] == 'at':
        if not (0 <= job['at'] <= config['duration']):
            raise RuntimeError(f'--at must fall within 0..{config["duration"]}')
        frame = min(total, 1 + round(job['at'] * config['fps']))
        began = time.time()
        render_frame(scene, frame, job['out'])
        seconds = time.time() - began
        log(f'One full-quality frame took {seconds:.1f}s, so all {total} frames would take about {seconds * total / 60:.0f} minutes.')
    else:
        began = time.time()
        rendered = 0
        for frame in range(1, total + 1):
            path = os.path.join(job['outDir'], f'{frame:05d}.png')
            if config.get('simulate'):
                scene.frame_set(frame)
            if os.path.exists(path):
                continue
            render_frame(scene, frame, path)
            rendered += 1
            elapsed = time.time() - began
            if rendered % max(1, config['fps'] // 2) == 0 or frame == total:
                left = sum(not os.path.exists(os.path.join(job['outDir'], f'{f:05d}.png')) for f in range(frame + 1, total + 1))
                log(f'frame {frame}/{total}, {elapsed / rendered:.1f}s each, about {left * elapsed / rendered / 60:.0f} minutes left')
            if job.get('maxMinutes') and elapsed > job['maxMinutes'] * 60:
                break


try:
    main()
except Exception as error:
    import traceback
    print(f'[bv] SCENE ERROR: {error}', flush=True)
    for line in traceback.format_exc().splitlines()[-8:]:
        print(f'[bv] {line}', flush=True)
    sys.stdout.flush()
    os._exit(1)
