// Renders a three.js scene module to video, frame by frame, in headless Chrome.
//
//   node src/render.mjs videos/foo/scene.js            full render  -> videos/foo/video.mp4
//   node src/render.mjs videos/foo/scene.js --preview  contact sheet -> videos/foo/preview.png
//   node src/render.mjs videos/foo/scene.js --at 2.5   single frame  -> videos/foo/frame-2.5.png
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_COLUMNS = 4;
const PREVIEW_ROWS = 3;
const PREVIEW_TILE_SIZE = 480;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function serveProject() {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(ROOT, `.${pathname}`);
    if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function openPage(origin) {
  const executablePath = CHROME_CANDIDATES.find((path) => path && existsSync(path));
  if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a browser executable.');

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();

  let failure = null;
  const fail = (message) => {
    failure ??= new Error(message);
  };
  page.on('pageerror', (error) => fail(`Scene error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') fail(`Scene console error: ${message.text()}`);
  });

  // Renders are fully local, so anything reaching off this machine is a scene bug.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      request.continue();
    } else {
      fail(`Scene tried to load an external resource: ${url}`);
      request.abort();
    }
  });

  await page.goto(`${origin}/src/runtime/page.html`);
  await page.waitForFunction('window.__ready === true');
  return { browser, page, check: () => { if (failure) throw failure; } };
}

function startFfmpeg(args) {
  const ffmpeg = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', ...args], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const finished = new Promise((done, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? done() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
  // A dying ffmpeg surfaces through `finished`, not as an unhandled pipe error.
  ffmpeg.stdin.on('error', () => {});
  return {
    async write(png) {
      if (!ffmpeg.stdin.write(png)) {
        await new Promise((done) => ffmpeg.stdin.once('drain', done));
      }
    },
    end() {
      ffmpeg.stdin.end();
      return finished;
    },
  };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { preview: { type: 'boolean' }, at: { type: 'string' }, out: { type: 'string' } },
  });
  if (positionals.length !== 1) {
    throw new Error('Usage: node src/render.mjs <scene.js> [--preview | --at <seconds>] [--out <file>]');
  }

  const scenePath = resolve(positionals[0]);
  if (!existsSync(scenePath)) throw new Error(`Scene not found: ${scenePath}`);
  if (!scenePath.startsWith(ROOT + sep)) throw new Error('Scene must live inside the project folder.');
  const sceneUrl = `/${relative(ROOT, scenePath).split(sep).join('/')}`;
  const sceneDir = dirname(scenePath);

  const { server, origin } = await serveProject();
  const { browser, page, check } = await openPage(origin);

  try {
    const config = await page.evaluate((url) => window.__loadConfig(url), sceneUrl);
    check();
    const totalFrames = Math.round(config.duration * config.fps);

    const scale = values.preview ? Math.min(PREVIEW_TILE_SIZE / config.width, PREVIEW_TILE_SIZE / config.height) : 1;
    const width = even(config.width * scale);
    const height = even(config.height * scale);

    const glRenderer = await page.evaluate((url, w, h) => window.__setup(url, w, h), sceneUrl, width, height);
    check();
    console.log(`GPU: ${glRenderer}`);

    let lastFrame = totalFrames - 1;
    let captured;
    let sink;
    let out;

    if (values.at !== undefined) {
      const seconds = Number(values.at);
      if (!(seconds >= 0 && seconds <= config.duration)) throw new Error(`--at must be within 0..${config.duration}`);
      lastFrame = Math.min(totalFrames - 1, Math.round(seconds * config.fps));
      captured = new Set([lastFrame]);
      out = values.out ?? join(sceneDir, `frame-${values.at}.png`);
      sink = { write: (png) => writeFileSync(out, png), end: async () => {} };
    } else if (values.preview) {
      const tiles = PREVIEW_COLUMNS * PREVIEW_ROWS;
      captured = new Set(Array.from({ length: tiles }, (_, k) => Math.round((k * (totalFrames - 1)) / (tiles - 1))));
      out = values.out ?? join(sceneDir, 'preview.png');
      sink = startFfmpeg(['-i', '-', '-vf', `tile=${PREVIEW_COLUMNS}x${PREVIEW_ROWS}`, '-frames:v', '1', out]);
    } else {
      if (config.width % 2 || config.height % 2) throw new Error('width and height must be even numbers.');
      out = values.out ?? join(sceneDir, 'video.mp4');
      sink = startFfmpeg([
        '-framerate', String(config.fps), '-i', '-',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-movflags', '+faststart', out,
      ]);
    }

    const startedAt = Date.now();
    for (let frame = 0; frame <= lastFrame; frame++) {
      const capture = !captured || captured.has(frame);
      const base64 = await page.evaluate((f, c) => window.__frame(f, c), frame, capture);
      check();
      if (capture) await sink.write(Buffer.from(base64, 'base64'));
      if ((frame + 1) % config.fps === 0 || frame === lastFrame) {
        console.log(`frame ${frame + 1}/${lastFrame + 1}`);
      }
    }
    await sink.end();

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`Done in ${seconds}s: ${out}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
