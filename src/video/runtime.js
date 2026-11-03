import * as THREE from 'three';

const DEFAULTS = { duration: 8, fps: 30, width: 1920, height: 1080, seed: 1 };

let canvas, renderer, instance, config;

// Reads a scene's config without building it, so the host can size the output first.
window.__loadConfig = async (sceneUrl) => {
  const mod = await import(sceneUrl);
  return { ...DEFAULTS, ...mod.config };
};

window.__setup = async (sceneUrl, width, height) => {
  const mod = await import(sceneUrl);
  config = { ...DEFAULTS, ...mod.config };
  window.__determinism.seed(config.seed);
  window.__determinism.setTime(0);

  canvas = document.createElement('canvas');
  document.body.append(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  instance = await mod.default({ renderer, width, height, config });
  if (!instance?.update && !instance?.render && !(instance?.scene && instance?.camera)) {
    throw new Error('Scene must return { scene, camera, update?, render? }');
  }

  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
};

// Draws frame `index`, returning a base64 PNG only when `capture` is set.
// Every frame always runs, in order, so simulations stay valid when previewing.
window.__frame = async (index, capture) => {
  const t = index / config.fps;
  window.__determinism.setTime(t);
  await instance.update?.(t, {
    frame: index,
    dt: 1 / config.fps,
    progress: t / config.duration,
  });
  if (instance.render) instance.render(t);
  else renderer.render(instance.scene, instance.camera);
  return capture ? canvas.toDataURL('image/png').split(',')[1] : null;
};

window.__ready = true;
