// Shared by the renderers: a local server for the project, and a locked-down headless browser.
import { existsSync, createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const HIGH_PERFORMANCE_GPU = '--force_high_performance_gpu';
export const LOW_POWER_GPU = '--force_low_power_gpu';

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

export function serveProject() {
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

export async function openPage(origin, { path, gpu = HIGH_PERFORMANCE_GPU }) {
  const executablePath = CHROME_CANDIDATES.find((path) => path && existsSync(path));
  if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a browser executable.');

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', gpu, '--enable-unsafe-swiftshader'],
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

  await page.goto(`${origin}${path}`);
  await page.waitForFunction('window.__ready === true');
  return { browser, page, check: () => { if (failure) throw failure; } };
}
