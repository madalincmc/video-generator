// Renders a Blender scene script to video. Long renders can stop and carry on later.
//
//   node src/blender-video/render.mjs videos/foo/scene.py                     full render -> videos/foo/video.mp4
//   node src/blender-video/render.mjs videos/foo/scene.py --preview           contact sheet -> videos/foo/preview.png
//   node src/blender-video/render.mjs videos/foo/scene.py --range 2 4         contact sheet of that window -> videos/foo/range.png
//   node src/blender-video/render.mjs videos/foo/scene.py --at 2.5            one final-quality frame -> videos/foo/frame-2.5.png
//   node src/blender-video/render.mjs videos/foo/scene.py --max-minutes 9     stop after 9 minutes, exit 75, run again to resume
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RUNNER = join(HERE, 'runner.py');
const KIT = join(HERE, 'kit.py');

const PREVIEW_COLUMNS = 4;
const PREVIEW_ROWS = 3;
const TILE_SIZE = 480;
const PREVIEW_SAMPLES = 16;
const EXIT_UNFINISHED = 75;

function findBlender() {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH;
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  if (onPath.status === 0) return onPath.stdout.split(/\r?\n/)[0].trim();
  if (process.platform === 'win32') {
    const base = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Blender Foundation');
    if (existsSync(base)) {
      const newest = readdirSync(base)
        .filter((name) => existsSync(join(base, name, 'blender.exe')))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .at(-1);
      if (newest) return join(base, newest, 'blender.exe');
    }
  }
  if (process.platform === 'darwin' && existsSync('/Applications/Blender.app/Contents/MacOS/Blender')) {
    return '/Applications/Blender.app/Contents/MacOS/Blender';
  }
  throw new Error('Blender not found. Install it from blender.org, or set BLENDER_PATH.');
}

function runBlender(blender, job, workDir) {
  const jobPath = join(workDir, 'job.json');
  writeFileSync(jobPath, JSON.stringify(job));
  return new Promise((done, reject) => {
    const child = spawn(
      blender,
      ['-b', '--factory-startup', '--offline-mode', '--python-exit-code', '1', '-P', RUNNER, '--', jobPath],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: dirname(job.scene) },
    );
    process.on('SIGINT', () => child.kill());
    process.on('SIGTERM', () => child.kill());
    const recent = [];
    let config = null;
    const onData = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        // Blender prints a line per render tile. Keeping those out of the output saves Claude's usage.
        if (line.startsWith('[bv] ')) {
          const match = line.match(/config fps=(\d+) total=(\d+)/);
          if (match) config = { fps: Number(match[1]), total: Number(match[2]) };
          else console.log(line.slice(5));
        } else {
          recent.push(line);
          if (recent.length > 25) recent.shift();
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return done(config);
      const memory = recent.some((line) => /out of (GPU |device )?memory/i.test(line));
      if (memory) console.error('Blender ran out of GPU memory. Reduce hair, instances, resolution or volumes.');
      console.error(recent.slice(-12).join('\n'));
      reject(new Error(`Blender exited with code ${code}.`));
    });
  });
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg exited with code ${result.status}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      preview: { type: 'boolean' },
      at: { type: 'string' },
      range: { type: 'string', multiple: false },
      'max-minutes': { type: 'string' },
      out: { type: 'string' },
    },
  });
  // `--range 2 4` reads more naturally than a quoted pair, so the end arrives as a positional.
  const rangeEnd = values.range !== undefined ? positionals.pop() : undefined;
  if (positionals.length !== 1) {
    throw new Error('Usage: node src/blender-video/render.mjs <scene.py> [--preview | --range <from> <to> | --at <seconds>] [--max-minutes <n>] [--out <file>]');
  }

  const scenePath = resolve(positionals[0]);
  if (!existsSync(scenePath)) throw new Error(`Scene not found: ${scenePath}`);
  if (!scenePath.startsWith(ROOT + sep)) throw new Error('Scene must live inside the project folder.');
  const sceneDir = dirname(scenePath);
  const blender = findBlender();
  const job = { scene: scenePath, tileSize: TILE_SIZE, previewSamples: PREVIEW_SAMPLES, tiles: PREVIEW_COLUMNS * PREVIEW_ROWS };
  const workDir = mkdtempSync(join(tmpdir(), 'blender-video-'));
  const started = Date.now();

  try {
    if (values.preview || values.range !== undefined) {
      job.mode = values.preview ? 'preview' : 'range';
      if (values.range !== undefined) job.range = [Number(values.range), Number(rangeEnd)];
      job.outDir = workDir;
      await runBlender(blender, job, workDir);
      const out = values.out ?? join(sceneDir, values.preview ? 'preview.png' : 'range.png');
      runFfmpeg(['-framerate', '1', '-i', join(workDir, 'tile-%02d.png'), '-vf', `tile=${PREVIEW_COLUMNS}x${PREVIEW_ROWS}`, '-frames:v', '1', '-update', '1', out]);
      console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${out}`);
      return;
    }

    if (values.at !== undefined) {
      job.mode = 'at';
      job.at = Number(values.at);
      job.out = resolve(values.out ?? join(sceneDir, `frame-${values.at}.png`));
      job.outDir = sceneDir;
      await runBlender(blender, job, workDir);
      console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${job.out}`);
      return;
    }

    // Frames from an older version of the scene must never mix with new ones.
    const framesDir = join(sceneDir, 'frames');
    const key = createHash('sha256').update(readFileSync(scenePath)).update(readFileSync(KIT)).update(readFileSync(RUNNER)).update(blender).digest('hex');
    const keyPath = join(framesDir, 'scene.key');
    if (existsSync(framesDir) && (!existsSync(keyPath) || readFileSync(keyPath, 'utf8') !== key)) {
      for (const name of readdirSync(framesDir)) {
        if (/^\d{5}\.png(\.partial\.png)?$/.test(name) || name === 'scene.key') rmSync(join(framesDir, name));
      }
    }
    job.mode = 'full';
    job.outDir = framesDir;
    if (values['max-minutes']) job.maxMinutes = Number(values['max-minutes']);
    const runnerConfigPromise = runBlender(blender, job, workDir);
    const config = await runnerConfigPromise;
    writeFileSync(keyPath, key);

    const done = readdirSync(framesDir).filter((name) => /^\d{5}\.png$/.test(name)).length;
    if (done < config.total) {
      console.log(`UNFINISHED: ${done}/${config.total} frames rendered. Run the same command again to continue.`);
      process.exitCode = EXIT_UNFINISHED;
      return;
    }
    const out = values.out ?? join(sceneDir, 'video.mp4');
    runFfmpeg([
      '-framerate', String(config.fps), '-i', join(framesDir, '%05d.png'),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-movflags', '+faststart', out,
    ]);
    console.log(`Done in ${((Date.now() - started) / 60000).toFixed(1)} minutes: ${out}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
