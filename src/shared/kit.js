// Small helpers for scenes: import { ease, segment, textPlane } from 'kit'
import * as THREE from 'three';

export const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const remap = (x, a, b, c, d) => lerp(c, d, clamp((x - a) / (b - a)));
export const smoothstep = (a, b, x) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export const ease = {
  linear: (k) => k,
  inQuad: (k) => k * k,
  outQuad: (k) => 1 - (1 - k) ** 2,
  inOutQuad: (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
  outCubic: (k) => 1 - (1 - k) ** 3,
  inOutCubic: (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
  outExpo: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  outBack: (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
};

// Eased 0..1 progress of time `t` through the window [start, end].
export const segment = (t, start, end, easing = ease.inOutCubic) =>
  easing(clamp((t - start) / (end - start)));

// A plane showing text, `height` world units tall. Fade it through material.opacity.
export function textPlane(text, { height = 1, color = '#ffffff', font = 'Segoe UI, Arial, sans-serif', weight = 700 } = {}) {
  const px = 256;
  const pad = px * 0.25;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSpec = `${weight} ${px}px ${font}`;
  ctx.font = fontSpec;
  canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
  canvas.height = Math.ceil(px * 1.4);
  ctx.font = fontSpec; // resizing the canvas resets its state
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(height * (canvas.width / canvas.height), height),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }),
  );
}
