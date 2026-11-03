// Builds a live hero scene into one self-contained hero.js, and checks it is fit for a real page.
//
//   node src/hero/build.mjs heroes/foo/scene.js                 build, check -> dist/hero.js, preview.png
//   node src/hero/build.mjs heroes/foo/scene.js --out <dir>     also copy hero.js to <dir> if checks pass
//
// Exits non-zero if any budget is missed.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import ffmpegPath from 'ffmpeg-static';
import { LOW_POWER_GPU, ROOT, openPage, serveProject } from '../shared/browser.mjs';

const BUDGET = {
  gzipKb: 250,
  medianMs: 12, // on the integrated GPU at 1920x1080, leaving room for the page in a 16ms frame
  p95Ms: 20,
  maxOpaque: 0.5, // share of pixels fully covering the page behind
  minMotion: 0.02, // the scene has to visibly move
};

const SHEET_TIMES = [1, 4, 12, 3600]; // last column shows the scene after an hour on screen
const SHEET_LOOKS = [
  ['dark', null],
  ['light', null],
  ['dark', 390],
];
const SHEET_VIEWPORT = { width: 1200, height: 560 };

async function bundle(scenePath, outfile) {
  const toImport = (path) => `./${relative(ROOT, path).split(sep).join('/')}`;
  await build({
    stdin: {
      contents: `
        import { createMount } from ${JSON.stringify(toImport(join(ROOT, 'src/hero/mount.js')))};
        import create, * as scene from ${JSON.stringify(toImport(scenePath))};
        export const mount = createMount(create, scene.config);
      `,
      resolveDir: ROOT,
    },
    alias: { kit: join(ROOT, 'src/shared/kit.js') },
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    outfile,
    logLevel: 'warning',
  });
}

function contactSheet(frames, out) {
  return new Promise((done, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-',
      '-vf', `scale=480:-2,tile=${SHEET_TIMES.length}x${SHEET_LOOKS.length}`, '-frames:v', '1', out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? done() : reject(new Error(`ffmpeg exited with code ${code}`))));
    ffmpeg.stdin.end(Buffer.concat(frames));
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' } },
  });
  if (positionals.length !== 1) throw new Error('Usage: node src/hero/build.mjs <scene.js> [--out <dir>]');

  const scenePath = resolve(positionals[0]);
  if (!existsSync(scenePath)) throw new Error(`Scene not found: ${scenePath}`);
  if (!scenePath.startsWith(ROOT + sep)) throw new Error('Scene must live inside the project folder.');
  const sceneDir = dirname(scenePath);
  const distDir = join(sceneDir, 'dist');
  const bundlePath = join(distDir, 'hero.js');
  const previewPath = join(sceneDir, 'preview.png');

  await bundle(scenePath, bundlePath);
  const source = readFileSync(bundlePath);
  const gzipKb = gzipSync(source).length / 1024;
  const bundleUrl = `/${relative(ROOT, bundlePath).split(sep).join('/')}`;

  const { server, origin } = await serveProject();
  const { browser, page, check } = await openPage(origin, { path: '/src/hero/test-page.html', gpu: LOW_POWER_GPU });

  const failures = [];
  const expect = (ok, message) => {
    if (!ok) failures.push(message);
  };

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.evaluate((url) => window.__mountHero(url), bundleUrl);
    check();

    const gpuName = await page.evaluate(() => {
      const canvas = document.querySelector('#hero canvas');
      const gl = canvas.getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const softwareGpu = /swiftshader|llvmpipe/i.test(gpuName);

    const bench = await page.evaluate(() => window.__benchmark(240, 30));
    const look = await page.evaluate(() => window.__inspect());
    check();

    const frames = [];
    await page.setViewport({ ...SHEET_VIEWPORT, deviceScaleFactor: 1 });
    for (const [theme, widthPx] of SHEET_LOOKS) {
      await page.evaluate((a, b) => window.__setLook(a, b), theme, widthPx);
      for (const t of SHEET_TIMES) {
        await page.evaluate((value) => window.__seek(value), t);
        frames.push(Buffer.from(await page.screenshot({ type: 'png' })));
      }
    }
    await contactSheet(frames, previewPath);
    check();

    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    console.log(`GPU:           ${gpuName}`);
    console.log(`Bundle:        ${(source.length / 1024).toFixed(0)} KB, ${gzipKb.toFixed(0)} KB gzipped (budget ${BUDGET.gzipKb})`);
    console.log(`Frame time:    ${bench.median.toFixed(1)} ms median, ${bench.p95.toFixed(1)} ms p95 (budget ${BUDGET.medianMs} / ${BUDGET.p95Ms})`);
    console.log(`Draw:          ${bench.calls} calls, ${bench.triangles} triangles, ${bench.points} points`);
    console.log(`Coverage:      ${pct(look.early.opaque)} opaque, ${pct(look.early.meanAlpha)} mean alpha (budget ${pct(BUDGET.maxOpaque)} opaque)`);
    console.log(`After 1 hour:  ${pct(look.longRun.meanAlpha)} mean alpha`);
    console.log(`Motion:        ${look.motion.toFixed(2)}% frame difference (minimum ${BUDGET.minMotion})`);
    console.log(`Pointer:       ${look.pointerReaction.toFixed(2)}% frame difference when hovered`);
    console.log(`Preview:       ${previewPath} (rows: dark, light, phone; columns: t=${SHEET_TIMES.join(', ')}s)`);

    expect(gzipKb <= BUDGET.gzipKb, `Bundle is ${gzipKb.toFixed(0)} KB gzipped.`);
    if (softwareGpu) {
      console.log('Frame budgets skipped: no hardware GPU available to this browser.');
    } else {
      expect(bench.median <= BUDGET.medianMs, `Median frame takes ${bench.median.toFixed(1)} ms.`);
      expect(bench.p95 <= BUDGET.p95Ms, `p95 frame takes ${bench.p95.toFixed(1)} ms.`);
    }
    expect(look.early.opaque <= BUDGET.maxOpaque, `${pct(look.early.opaque)} of pixels are opaque, hiding the page behind.`);
    expect(look.early.meanAlpha > 0, 'The scene draws nothing.');
    expect(look.motion >= BUDGET.minMotion, `The scene barely moves (${look.motion.toFixed(3)}%).`);
    expect(
      look.longRun.meanAlpha >= look.early.meanAlpha / 3 && look.longRun.meanAlpha <= look.early.meanAlpha * 3,
      'The scene looks very different after an hour, so something drifts or accumulates over time.',
    );
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error(`\nFAILED:\n${failures.map((f) => `- ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');

  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    copyFileSync(bundlePath, join(values.out, 'hero.js'));
    console.log(`Copied to ${join(values.out, 'hero.js')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
