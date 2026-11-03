// Browser side of src/hero/build.mjs: mounts a built hero and measures it.
const hero = document.getElementById('hero');
let handle;

const nextPaint = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

window.__mountHero = async (url) => {
  const { mount } = await import(url);
  handle = mount(hero, { theme: 'dark' });
  await nextPaint();
};

window.__setLook = async (theme, widthPx) => {
  document.documentElement.dataset.theme = theme;
  hero.style.right = widthPx ? 'auto' : '0';
  hero.style.left = widthPx ? `calc(50% - ${widthPx / 2}px)` : '0';
  hero.style.width = widthPx ? `${widthPx}px` : 'auto';
  await nextPaint();
  handle.setTheme(theme);
};

window.__seek = async (t) => {
  handle.seek(t);
  await nextPaint();
};

// Downsampled pixels of the frame at `t`, read in the same task it was drawn.
function sample(t, pointer) {
  handle.seek(t, pointer);
  const small = document.createElement('canvas');
  small.width = 96;
  small.height = 54;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(handle.renderer.domElement, 0, 0, small.width, small.height);
  return ctx.getImageData(0, 0, small.width, small.height).data;
}

function coverage(pixels) {
  let alpha = 0;
  let opaque = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    alpha += pixels[i];
    if (pixels[i] > 242) opaque++;
  }
  const count = pixels.length / 4;
  return { meanAlpha: alpha / count / 255, opaque: opaque / count };
}

// Mean per-channel difference, as a percentage of full range.
function difference(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return (total / a.length / 255) * 100;
}

window.__inspect = () => {
  const early = sample(2);
  const later = sample(2.5);
  const longRun = sample(3600);
  const hovered = sample(2, { x: 0.5, y: 0.2, active: 1 });
  return {
    early: coverage(early),
    longRun: coverage(longRun),
    motion: difference(early, later),
    pointerReaction: difference(early, hovered),
  };
};

// Forces the GPU to finish each frame, so this measures rendering rather than queueing commands.
window.__benchmark = (frames, warmup) => {
  const gl = handle.renderer.getContext();
  const pixel = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < frames + warmup; i++) {
    const start = performance.now();
    handle.seek(i / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (i >= warmup) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const { calls, triangles, points } = handle.renderer.info.render;
  return {
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    calls,
    triangles,
    points,
  };
};

window.__ready = true;
