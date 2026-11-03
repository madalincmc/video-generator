// Runs a hero scene live on a web page. Bundled into the hero.js a website loads.
// Handles what every scene needs on a real page: resizing, pausing off-screen, reduced motion,
// slow devices and cleanup. If WebGL is unavailable it does nothing, leaving the page as it was.
import * as THREE from 'three';

const DEFAULTS = { maxPixelRatio: 1.5, stillAt: 2 };

const SLOW_FRAME_MS = 24; // below ~40 fps
const FRAMES_PER_QUALITY_CHECK = 60;
const QUALITY_STEP = 0.75;
const MIN_PIXEL_RATIO = 0.6;
const MAX_FRAME_GAP_MS = 250; // longer gaps are tab switches or hitches, not rendering speed
const POINTER_DAMPING = 4;

const inert = { setTheme() {}, destroy() {}, seek() {}, renderer: null };

export function createMount(create, sceneConfig = {}) {
  const config = { ...DEFAULTS, ...sceneConfig };

  return function mount(el, { theme = 'dark' } = {}) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return inert;
    }
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      opacity: '0',
      transition: 'opacity 1.2s ease',
    });
    el.append(canvas);

    let pixelRatio = Math.min(window.devicePixelRatio || 1, config.maxPixelRatio);
    let width = Math.max(1, el.clientWidth);
    let height = Math.max(1, el.clientHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    const instance = create({ renderer, width, height, pixelRatio, theme });
    const pointer = { x: 0, y: 0, active: 0 };
    const pointerTarget = { x: 0, y: 0, active: 0 };

    let time = 0;
    let lastFrame = null;
    let frameId = null;
    let seeking = false;
    let tooSlow = false;
    let contextLost = false;
    let inView = true;
    let slowFrames = 0;
    let measuredFrames = 0;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const draw = (dt) => {
      instance.update?.(time, { dt, pointer });
      if (instance.render) instance.render(time);
      else renderer.render(instance.scene, instance.camera);
    };

    const applySize = () => {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      instance.resize?.(width, height, pixelRatio);
    };

    const adaptQuality = (ms) => {
      measuredFrames++;
      if (ms > SLOW_FRAME_MS) slowFrames++;
      if (measuredFrames < FRAMES_PER_QUALITY_CHECK) return;
      const slow = slowFrames > measuredFrames / 2;
      measuredFrames = 0;
      slowFrames = 0;
      if (!slow) return;
      if (pixelRatio * QUALITY_STEP >= MIN_PIXEL_RATIO) {
        pixelRatio *= QUALITY_STEP;
        applySize();
      } else {
        tooSlow = true; // keeps the current frame on screen as a still image
      }
    };

    const loop = (now) => {
      frameId = requestAnimationFrame(loop);
      const ms = lastFrame === null ? 0 : now - lastFrame;
      lastFrame = now;
      const gapped = ms > MAX_FRAME_GAP_MS;
      const dt = gapped ? 0 : ms / 1000;
      time += dt;

      const k = 1 - Math.exp(-POINTER_DAMPING * dt);
      pointer.x += (pointerTarget.x - pointer.x) * k;
      pointer.y += (pointerTarget.y - pointer.y) * k;
      pointer.active += (pointerTarget.active - pointer.active) * k;

      draw(dt);
      if (ms > 0 && !gapped) adaptQuality(ms);
      if (tooSlow) sync();
    };

    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      lastFrame = null;
    };

    const drawStill = () => {
      if (time === 0) time = config.stillAt;
      draw(0);
    };

    // Single decision point for whether the loop should be running.
    const sync = () => {
      const still = motion.matches || tooSlow;
      const run = !seeking && !still && !contextLost && inView && !document.hidden;
      if (run && frameId === null) frameId = requestAnimationFrame(loop);
      if (!run) stop();
      if (still && !seeking && !contextLost) drawStill();
    };

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(1, el.clientWidth);
      const nextHeight = Math.max(1, el.clientHeight);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      applySize();
      if (frameId === null && !contextLost) draw(0); // resizing clears the canvas
    });
    resizeObserver.observe(el);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    intersectionObserver.observe(el);

    const onPointerMove = (event) => {
      if (event.pointerType === 'touch') return; // touches are scrolling, not pointing
      const rect = el.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      pointerTarget.active = inside ? 1 : 0;
      if (!inside) return;
      pointerTarget.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerTarget.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    };
    const onContextLost = (event) => {
      event.preventDefault();
      contextLost = true;
      sync();
    };
    const onContextRestored = () => {
      contextLost = false;
      sync();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    sync();
    if (frameId === null && !motion.matches) draw(0);
    requestAnimationFrame(() => {
      canvas.style.opacity = '1';
    });

    return {
      setTheme(next) {
        instance.setTheme?.(next);
        if (frameId === null && !contextLost) draw(0);
      },
      // Freezes the loop and draws time `t`. Used by the budget check.
      seek(t, nextPointer = { x: 0, y: 0, active: 0 }) {
        seeking = true;
        sync();
        time = t;
        Object.assign(pointer, nextPointer);
        canvas.style.transition = 'none';
        canvas.style.opacity = '1';
        draw(1 / 60);
      },
      renderer,
      destroy() {
        stop();
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('visibilitychange', sync);
        motion.removeEventListener('change', sync);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        instance.dispose?.();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      },
    };
  };
}
