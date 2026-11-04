// 0-3.4s a goat gallops along an alpine pitch dribbling the ball, sun low ahead
// 3.4-5.65s it flicks the ball up and rears in slow motion for a diving header
// 5.65-7s reverse angle from behind the net as the ball bulges it
// 7-10s telephoto hero shot: the goat rears against a giant sun, then fade out
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ease, lerp, segment, smoothstep, clamp } from 'kit';

export const config = { duration: 10, fps: 30, width: 1920, height: 1080, seed: 11 };

const SUN = new THREE.Vector3(0.7, 0.096, -0.7).normalize();
const SUN_FLAT = new THREE.Vector3(SUN.x, 0, SUN.z).normalize();
const GOAL_X = 14;
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const BALL_R = 0.17;

const T_FLICK = 3.75;
const T_HEADER = 5.0;
const T_NET = 6.15;
const T_PUSHED = 6.37;

const noise = new SimplexNoise();
const hex = (value) => new THREE.Color(value);

// Tube along a curve with elliptical cross-sections: [x, y, z, radiusN, radiusB] per point.
function loft(points, { segments = 12, steps = 16, color = '#ffffff', round = 0, ref = [0, 0, 1], shag = 0, radius = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const refV = new THREE.Vector3(...ref);
  const colorFn = typeof color === 'function' ? color : () => hex(color);
  const positions = [];
  const colors = [];
  const indices = [];
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  const v = new THREE.Vector3();
  const last = points.length - 1;

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const c = curve.getPoint(u);
    const tangent = curve.getTangent(u);
    n.crossVectors(refV, tangent).normalize();
    b.crossVectors(tangent, n).normalize();
    const f = u * last;
    const k = Math.min(Math.floor(f), last - 1);
    const s = smoothstep(0, 1, f - k);
    let rn = lerp(points[k][3], points[k + 1][3], s);
    let rb = lerp(points[k][4], points[k + 1][4], s);
    if (round > 0) {
      const edge = Math.min(u, 1 - u) / round;
      const scale = edge < 1 ? Math.sqrt(Math.max(1 - (1 - edge) ** 2, 0.0004)) : 1;
      rn *= scale;
      rb *= scale;
    }
    if (radius) {
      const scale = radius(u);
      rn *= scale;
      rb *= scale;
    }
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      v.copy(c).addScaledVector(n, Math.cos(a) * rn).addScaledVector(b, Math.sin(a) * rb);
      if (shag > 0) {
        const bump = noise.noise3d(v.x * 13, v.y * 13, v.z * 13) + 0.5 * noise.noise3d(v.x * 34, v.y * 34, v.z * 34);
        v.addScaledVector(n, Math.cos(a) * bump * shag).addScaledVector(b, Math.sin(a) * bump * shag);
      }
      positions.push(v.x, v.y, v.z);
      colors.push(...colorFn(u, a, v).toArray());
      if (i < steps) {
        const row = i * segments;
        const next = (j + 1) % segments;
        indices.push(row + j, row + next, row + segments + j);
        indices.push(row + next, row + segments + next, row + segments + j);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Glowing edge when looking toward the sun, added to any standard material.
function withRim(material, shared, strength = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunView = shared.sunView;
    shader.uniforms.uRimGain = shared.rimGain;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform float uRimGain;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 rimView = normalize(vViewPosition);
        float rimEdge = pow(1.0 - saturate(dot(normal, rimView)), 2.4);
        float rimFacing = saturate(dot(-rimView, uSunView) * 0.5 + 0.5);
        float rimWrap = saturate(dot(normal, uSunView) * 0.65 + 0.55);
        totalEmissiveRadiance += vec3(1.0, 0.56, 0.22) * rimEdge * rimFacing * rimFacing * rimWrap * uRimGain * ${(3.6 * strength).toFixed(2)};`);
  };
  return material;
}

function buildGoat(shared) {
  const cream = hex('#efe2c8');
  const shade = hex('#c9ad86');
  const brown = hex('#4d3524');
  const dark = hex('#20150f');
  const fur = withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), shared);
  const horn = withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48 }), shared, 1.4);
  const shagMat = withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), shared, 0.12);

  const part = (parent, pivot) => {
    const group = new THREE.Group();
    group.position.set(pivot[0] - parent.anchor[0], pivot[1] - parent.anchor[1], pivot[2] - parent.anchor[2]);
    group.anchor = pivot;
    parent.add(group);
    return group;
  };
  const skin = (group, geometries, material = fur) => {
    const geometry = geometries.length > 1 ? mergeGeometries(geometries) : geometries[0];
    geometry.translate(-group.anchor[0], -group.anchor[1], -group.anchor[2]);
    if (material !== shagMat) geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  };
  const tuft = (x, y, z, dx, dy, dz, r, color) => {
    const strand = loft([[x, y, z, r, r], [x + dx * 0.5, y + dy * 0.5, z + dz * 0.5, r * 0.7, r * 0.7], [x + dx, y + dy, z + dz, 0.001, 0.001]], { segments: 4, steps: 2, color });
    const normal = new THREE.Vector3(0, 0.15, 1).normalize();
    const normals = strand.attributes.normal;
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, normal.x, normal.y, normal.z);
    return strand;
  };

  const root = new THREE.Group();
  root.anchor = [0, 0, 0];
  const torso = part(root, [-0.42, 0.74, 0]);

  const shagParts = [];
  const torsoParts = [
    loft(
      [[-0.68, 0.87, 0, 0.1, 0.09], [-0.52, 0.89, 0, 0.22, 0.2], [-0.25, 0.88, 0, 0.27, 0.25], [0.05, 0.86, 0, 0.3, 0.27], [0.32, 0.88, 0, 0.28, 0.22], [0.52, 0.94, 0, 0.2, 0.16]],
      {
        segments: 28, steps: 40, round: 0.1, shag: 0.012,
        color: (u, a) => {
          const up = Math.cos(a);
          if (up > 0.965) return brown.clone().lerp(cream, 0.25);
          return cream.clone().lerp(shade, smoothstep(0.1, -0.9, up));
        },
      },
    ),
    loft([[-0.63, 0.99, 0, 0.05, 0.04], [-0.68, 1.06, 0, 0.038, 0.028], [-0.7, 1.13, 0, 0.01, 0.008]], { segments: 8, steps: 8, color: shade }),
  ];
  // Shaggy fringe along the belly and chest.
  for (let i = 0; i < 1700; i++) {
    const x = lerp(-0.58, 0.5, Math.random());
    const a = (0.5 + (Math.random() - 0.5) * 0.85) * Math.PI;
    const z = Math.cos(a) * 0.24;
    const y = 0.88 - Math.sin(a) * (0.27 - Math.abs(x + 0.02) * 0.1);
    const len = 0.05 + Math.random() ** 2 * 0.09;
    shagParts.push(tuft(x, y, z, -0.05 + Math.random() * 0.03, -len, z * 0.15, 0.017, shade.clone().lerp(cream, 0.3 + Math.random() * 0.7)));
  }
  skin(torso, torsoParts);
  skin(torso, shagParts, shagMat);

  const neck = part(torso, [0.4, 1.0, 0]);
  const neckParts = [
    loft([[0.26, 0.92, 0, 0.2, 0.15], [0.5, 1.1, 0, 0.135, 0.115], [0.72, 1.32, 0, 0.095, 0.085]], { segments: 18, steps: 14, shag: 0.008, color: cream }),
  ];
  const neckShag = [];
  for (let i = 0; i < 260; i++) {
    const k = Math.random();
    neckShag.push(tuft(lerp(0.3, 0.66, k), lerp(1.1, 1.38, k), (Math.random() - 0.5) * 0.07, -0.05, 0.035, 0, 0.012, brown.clone().lerp(cream, Math.random() * 0.4)));
  }
  for (let i = 0; i < 320; i++) {
    const k = Math.random();
    neckShag.push(tuft(lerp(0.44, 0.7, k), lerp(0.84, 1.17, k), (Math.random() - 0.5) * 0.16, 0.015, -0.05 - Math.random() * 0.07, 0, 0.014, cream));
  }
  skin(neck, neckParts);
  skin(neck, neckShag, shagMat);

  const head = part(neck, [0.7, 1.3, 0]);
  const faceColor = (u, a) => {
    if (u > 0.9) return hex('#2c1d17');
    const up = Math.cos(a);
    return up > 0.82 && u > 0.2 ? brown.clone().lerp(cream, 0.25) : cream;
  };
  const headParts = [
    loft([[0.61, 1.37, 0, 0.09, 0.08], [0.72, 1.39, 0, 0.11, 0.095], [0.83, 1.34, 0, 0.09, 0.075], [0.94, 1.26, 0, 0.066, 0.056], [1.02, 1.2, 0, 0.056, 0.047]], { segments: 16, steps: 20, round: 0.09, color: faceColor }),
    loft([[0.9, 1.22, 0, 0.038, 0.034], [0.875, 1.09, 0, 0.05, 0.04], [0.85, 0.9, 0, 0.004, 0.004]], { segments: 7, steps: 7, color: hex('#6d543d') }),
  ];
  for (const side of [-1, 1]) {
    headParts.push(loft(
      [[0.66, 1.42, side * 0.06, 0.02, 0.012], [0.65, 1.41, side * 0.15, 0.05, 0.016], [0.67, 1.36, side * 0.27, 0.042, 0.012], [0.7, 1.31, side * 0.34, 0.006, 0.004]],
      { segments: 8, steps: 12, ref: [0, 1, 0], color: (u, a) => cream.clone().lerp(brown, 0.15 + u * 0.3) },
    ));
  }
  skin(head, headParts);

  const hornParts = [];
  for (const side of [-1, 1]) {
    hornParts.push(loft(
      [[0.71, 1.45, side * 0.045, 0.05, 0.042], [0.66, 1.63, side * 0.075, 0.042, 0.036], [0.5, 1.8, side * 0.115, 0.032, 0.028], [0.28, 1.84, side * 0.16, 0.022, 0.019], [0.08, 1.72, side * 0.2, 0.004, 0.004]],
      {
        segments: 10, steps: 44,
        radius: (u) => 1 + 0.1 * Math.max(0, Math.sin(u * 62)) * (1 - u),
        color: (u) => hex('#30221a').lerp(hex('#8b7355'), Math.max(0, Math.sin(u * 62)) * 0.5 + u * 0.3),
      },
    ));
  }
  skin(head, hornParts, horn);

  const eye = new THREE.MeshStandardMaterial({ color: '#150c07', roughness: 0.2 });
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), eye);
    mesh.position.set(0.82 - head.anchor[0], 1.365 - head.anchor[1], side * 0.066);
    head.add(mesh);
  }
  const forehead = new THREE.Object3D();
  forehead.position.set(0.33, 0.16, 0);
  head.add(forehead);

  const legs = [];
  const buildLeg = (parent, hip, side, front, offset) => {
    const l1 = front ? 0.38 : 0.36;
    const l2 = front ? 0.36 : 0.34;
    const x = hip[0];
    const y = hip[1];
    const z = hip[2];
    const upper = part(parent, hip);
    const thigh = front
      ? [[x, y + 0.04, z, 0.12, 0.08], [x, y - 0.2, z, 0.08, 0.062], [x, y - l1, z, 0.055, 0.05]]
      : [[x, y + 0.08, z, 0.16, 0.09], [x, y - 0.18, z, 0.105, 0.07], [x, y - l1, z, 0.056, 0.05]];
    skin(upper, [loft(thigh, { segments: 12, steps: 14, round: 0.12, color: (u) => cream.clone().lerp(hex('#a78a64'), smoothstep(0.5, 1, u)) })]);
    const lower = part(upper, [x, y - l1, z]);
    const yk = y - l1;
    skin(lower, [
      loft([[x, yk + 0.05, z, 0.058, 0.052], [x, yk - l2 * 0.5, z, 0.04, 0.037], [x, yk - l2, z, 0.045, 0.04]], { segments: 10, steps: 12, round: 0.1, color: (u) => hex('#a78a64').lerp(brown, smoothstep(0, 0.4, u)) }),
      loft([[x, yk + 0.065, z, 0.062, 0.056], [x, yk - 0.065, z, 0.062, 0.056]], { segments: 10, steps: 10, round: 0.5, color: '#8f7354' }),
      loft([[x, yk - l2 + 0.005, z, 0.05, 0.044], [x + 0.01, yk - l2 - 0.04, z, 0.062, 0.052]], { segments: 10, steps: 2, color: dark }),
    ]);
    const hoof = new THREE.Object3D();
    hoof.position.set(0, -l2 - 0.04, 0);
    lower.add(hoof);
    legs.push({ upper, lower, hoof, front, offset, side });
  };
  buildLeg(root, [-0.42, 0.74, -0.13], -1, false, 0);
  buildLeg(root, [-0.42, 0.74, 0.13], 1, false, 0.12);
  buildLeg(torso, [0.33, 0.78, -0.12], -1, true, 0.5);
  buildLeg(torso, [0.33, 0.78, 0.12], 1, true, 0.62);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { root, torso, neck, head, legs, forehead };
}

function ballTexture() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const pentagons = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) pentagons.push([0, a, b], [a, b, 0], [b, 0, a]);
  const hexagons = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hexagons.push([a, b, c]);
  for (const a of [-1 / phi, 1 / phi]) for (const b of [-phi, phi]) hexagons.push([a, 0, b], [b, a, 0], [0, b, a]);
  const unit = (p) => new THREE.Vector3(...p).normalize();
  const cells = [...pentagons.map(unit).map((v) => ({ v, black: true })), ...hexagons.map(unit).map((v) => ({ v, black: false }))];

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const theta = ((y + 0.5) / canvas.height) * Math.PI;
    for (let x = 0; x < canvas.width; x++) {
      const az = ((x + 0.5) / canvas.width) * Math.PI * 2;
      const dx = -Math.cos(az) * Math.sin(theta);
      const dy = Math.cos(theta);
      const dz = Math.sin(az) * Math.sin(theta);
      let best = -2;
      let second = -2;
      let black = false;
      for (const cell of cells) {
        const d = dx * cell.v.x + dy * cell.v.y + dz * cell.v.z + (cell.black ? 0.012 : 0);
        if (d > best) {
          second = best;
          best = d;
          black = cell.black;
        }
        else if (d > second) second = d;
      }
      const seam = best - second < 0.011;
      const value = seam ? 70 : black ? 26 : 240;
      const i = (y * canvas.width + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value - (black || seam ? 0 : 6);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function buildSky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: SUN }, uTime: { value: 0 }, uDisc: { value: 1 } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uSun; uniform float uTime; uniform float uDisc; varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 11.0; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          float s = dot(d, uSun);
          vec3 col = mix(vec3(1.5, 0.66, 0.24), vec3(1.05, 0.34, 0.22), smoothstep(0.0, 0.13, h));
          col = mix(col, vec3(0.42, 0.16, 0.36), smoothstep(0.1, 0.36, h));
          col = mix(col, vec3(0.05, 0.07, 0.2), smoothstep(0.3, 0.85, h));
          col = mix(col, col * vec3(0.72, 0.62, 1.1), smoothstep(0.3, -0.6, s));
          col += vec3(0.5, 0.2, 0.05) * pow(max(s, 0.0), 8.0);
          col += vec3(0.9, 0.42, 0.12) * pow(max(s, 0.0), 120.0);
          vec2 cp = d.xz / (h + 0.16);
          float f = fbm(cp * vec2(1.1, 2.6) + vec2(uTime * 0.012, 0.0));
          float cover = smoothstep(0.48, 0.76, f) * smoothstep(0.015, 0.09, h) * (1.0 - 0.55 * pow(max(s, 0.0), 40.0));
          vec3 cloud = mix(vec3(0.24, 0.1, 0.22), vec3(2.3, 0.95, 0.36), clamp(pow(max(s * 0.5 + 0.5, 0.0), 3.0) + (f - 0.6) * 0.8, 0.0, 1.0));
          col = mix(col, cloud, cover * 0.88);
          float disc = smoothstep(0.99815, 0.99835, s);
          col = mix(col, vec3(13.0, 7.6, 3.2) * uDisc, disc);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
}

function buildRidge(radius, peak, top, haze, freq, seed) {
  const steps = 720;
  const positions = [];
  const colors = [];
  const indices = [];
  const topColor = hex(top);
  const hazeColor = hex(haze);
  const glow = hex('#ff9a4a');
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    let n = 0;
    let amp = 0.6;
    let f = freq;
    for (let o = 0; o < 5; o++) {
      n += amp * (1 - Math.abs(noise.noise(cx * f + seed, cz * f - seed)));
      amp *= 0.5;
      f *= 2.1;
    }
    const toSun = cx * SUN_FLAT.x + cz * SUN_FLAT.z;
    const dip = lerp(0.42, 1, smoothstep(0.93, 0.995, -toSun + 1.93 - 0.0) * 0 + smoothstep(0.985, 0.9, toSun));
    const y = (peak * clamp(n * n * 1.05)) * dip + peak * 0.1;
    const lit = smoothstep(0.3, 1, toSun) * 0.4;
    positions.push(cx * radius, -8, cz * radius, cx * radius, y, cz * radius);
    const low = hazeColor.clone();
    const high = topColor.clone().lerp(glow, lit);
    colors.push(...low.toArray(), ...high.toArray());
    if (i < steps) {
      const k = i * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
}

function buildPines() {
  const parts = [
    new THREE.ConeGeometry(0.3, 0.5, 7).translate(0, 0.75, 0),
    new THREE.ConeGeometry(0.22, 0.42, 7).translate(0, 0.98, 0),
    new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5).translate(0, 0.15, 0),
    new THREE.ConeGeometry(0.37, 0.56, 7).translate(0, 0.5, 0),
  ].map((g) => g.toNonIndexed());
  const trees = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: '#2a2a22' }), 900);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  while (placed < 900) {
    const a = Math.random() * Math.PI * 2;
    const r = 105 + Math.random() * 60;
    const toSun = Math.cos(a) * SUN_FLAT.x + Math.sin(a) * SUN_FLAT.z;
    if (toSun > 0.9) continue;
    const scale = 3 + Math.random() * 4.5;
    q.setFromAxisAngle(up, Math.random() * 6.28);
    m.compose(new THREE.Vector3(Math.cos(a) * r, -0.2, Math.sin(a) * r), q, new THREE.Vector3(scale, scale, scale));
    trees.setMatrixAt(placed++, m);
  }
  return trees;
}

function buildGround() {
  const group = new THREE.Group();
  const width = 4096;
  const height = 3277;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const px = (x) => ((x + 60) / 100) * width;
  const pz = (z) => ((z + 40) / 80) * height;
  const meadow = '#4b5a26';

  ctx.fillStyle = meadow;
  ctx.fillRect(0, 0, width, height);
  for (let x = -60; x < GOAL_X + 3; x += 5) {
    ctx.fillStyle = Math.round((x + 60) / 5) % 2 ? '#4f7d2c' : '#3f6a26';
    ctx.fillRect(px(x), pz(-34), px(x + 5) - px(x), pz(34) - pz(-34));
  }
  for (let i = 0; i < 90000; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '20,30,8' : '150,160,60'},${0.04 + Math.random() * 0.1})`;
    ctx.fillRect(Math.random() * width, Math.random() * height, 2 + Math.random() * 7, 1 + Math.random() * 4);
  }
  ctx.strokeStyle = 'rgba(245,240,220,0.92)';
  ctx.lineWidth = 0.13 * (width / 100);
  const box = (x1, x2, z) => ctx.strokeRect(px(x1), pz(-z), px(x2) - px(x1), pz(z) - pz(-z));
  ctx.beginPath();
  ctx.moveTo(px(GOAL_X), pz(-34));
  ctx.lineTo(px(GOAL_X), pz(34));
  ctx.stroke();
  box(GOAL_X - 16.5, GOAL_X, 20);
  box(GOAL_X - 5.5, GOAL_X, 9);
  ctx.beginPath();
  ctx.arc(px(GOAL_X - 11), pz(0), 9.15 * (width / 100), Math.PI * 0.7, Math.PI * 1.3);
  ctx.stroke();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(100, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map, roughness: 1, color: '#79935a' }));
  pitch.position.set(-10, 0, 0);
  pitch.receiveShadow = true;
  group.add(pitch);

  const outer = new THREE.Mesh(new THREE.CircleGeometry(1000, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: meadow, roughness: 1 }));
  outer.position.y = -0.03;
  group.add(outer);

  const near = 520000;
  const far = 220000;
  const count = near + far;
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.009, 0, 0, 0.009, 0, 0, 0, 1, 0], 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute([0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1.25, 1.2, 0.95], 3));
  const grass = new THREE.InstancedMesh(blade, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), count);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const isFar = i >= near;
    const x = isFar ? -60 + Math.random() * 100 : -34 + Math.random() * 56;
    const z = isFar ? -40 + Math.random() * 62 : -9 + Math.random() * 21;
    dummy.position.set(x, 0, z);
    dummy.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 6.28, (Math.random() - 0.5) * 0.7);
    const h = 0.045 + Math.random() * 0.06;
    const wide = isFar ? 3.5 : 1;
    dummy.scale.set(wide, h, wide);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    const light = Math.round((Math.floor((x + 60) / 5) * 5) / 5) % 2;
    tint.set(light ? '#5d8e30' : '#4b7a29').multiplyScalar(0.8 + Math.random() * 0.4);
    grass.setColorAt(i, tint);
  }
  grass.receiveShadow = true;
  group.add(grass);
  return group;
}

function buildGoal(shared) {
  const group = new THREE.Group();
  const white = withRim(new THREE.MeshStandardMaterial({ color: '#f6f1e6', roughness: 0.45 }), shared, 0.8);
  const bar = (from, to, r) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 12), white);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    group.add(mesh);
  };
  const halfW = GOAL_W / 2;
  const backLow = 1.8;
  const backTop = 0.8;
  for (const side of [-1, 1]) {
    bar([GOAL_X, 0, side * halfW], [GOAL_X, GOAL_H, side * halfW], 0.06);
    bar([GOAL_X, GOAL_H, side * halfW], [GOAL_X + backTop, GOAL_H, side * halfW], 0.022);
    bar([GOAL_X + backTop, GOAL_H, side * halfW], [GOAL_X + backLow, 0.02, side * halfW], 0.022);
    bar([GOAL_X + backLow, 0.02, side * halfW], [GOAL_X, 0.02, side * halfW], 0.022);
  }
  bar([GOAL_X, GOAL_H, -halfW], [GOAL_X, GOAL_H, halfW], 0.06);
  bar([GOAL_X + backTop, GOAL_H, -halfW], [GOAL_X + backTop, GOAL_H, halfW], 0.022);
  bar([GOAL_X + backLow, 0.02, -halfW], [GOAL_X + backLow, 0.02, halfW], 0.022);

  const positions = [];
  const indices = [];
  const backVerts = [];
  const grid = (cols, rows, at, track = false) => {
    const start = positions.length / 3;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const p = at(i / cols, j / rows);
        if (track) backVerts.push({ index: positions.length / 3, x: p[0], y: p[1], z: p[2], edge: Math.sin(Math.PI * (i / cols)) * Math.sqrt(Math.sin(Math.PI * (j / rows))) });
        positions.push(...p);
        const here = start + i * (rows + 1) + j;
        if (j < rows) indices.push(here, here + 1);
        if (i < cols) indices.push(here, here + rows + 1);
      }
    }
  };
  grid(46, 16, (u, v) => [GOAL_X + lerp(backLow, backTop, v), v * GOAL_H, lerp(-halfW, halfW, u)], true);
  grid(46, 6, (u, v) => [GOAL_X + v * backTop, GOAL_H, lerp(-halfW, halfW, u)]);
  for (const side of [-1, 1]) grid(10, 16, (u, v) => [GOAL_X + u * lerp(backLow, backTop, v), v * GOAL_H, side * halfW]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const net = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#fff0d8', transparent: true, opacity: 0.62 }));
  group.add(net);
  return { group, net, backVerts };
}

// Stateless particles: every position comes from its birth time, so any frame stands alone.
function buildParticles(height) {
  const origin = [];
  const velocity = [];
  const info = [];
  const alpha = [];
  const add = (o, v, birth, life, size, a) => {
    origin.push(...o);
    velocity.push(...v);
    info.push(birth, life, size);
    alpha.push(a);
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uT: { value: 0 }, uH: { value: height } },
    vertexShader: `attribute vec3 aVel; attribute vec3 aInfo; attribute float aAlpha; uniform float uT; uniform float uH; varying float vA;
      void main() {
        float age = uT - aInfo.x; float a = age / aInfo.y;
        if (age < 0.0 || a > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
        vec3 p = position + aVel * (age - 0.25 * age * age / max(aInfo.y, 0.5));
        p += vec3(sin(uT * 0.6 + position.z * 3.0), sin(uT * 0.8 + position.x * 2.0) * 0.5, cos(uT * 0.5 + position.y * 4.0)) * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aInfo.z * uH * (0.6 + a) / -mv.z;
        vA = smoothstep(0.0, 0.08, a) * pow(1.0 - a, 1.5) * aAlpha;
      }`,
    fragmentShader: `varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float k = pow(max(1.0 - d, 0.0), 1.7);
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * k * vA, k * vA);
      }`,
  });
  return { add, material, origin, velocity, info, alpha };
}

export default async function create({ renderer, width, height }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const shared = { sunView: { value: new THREE.Vector3() }, rimGain: { value: 1 } };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#e08a52', 0.0062);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 2000);

  const sky = buildSky();
  scene.add(sky);
  scene.add(buildRidge(340, 34, '#a85a68', '#f0985a', 1.5, 3.1));
  scene.add(buildRidge(250, 19, '#5f3a5e', '#e88a56', 2.4, 8.2));
  scene.add(buildRidge(180, 10, '#33283f', '#c9794f', 3.6, 15.7));
  scene.add(buildPines());
  scene.add(buildGround());

  const goal = buildGoal(shared);
  scene.add(goal.group);

  const goat = buildGoat(shared);
  scene.add(goat.root);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 48, 32),
    withRim(new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.42 }), shared, 0.9),
  );
  ball.castShadow = true;
  scene.add(ball);

  const sun = new THREE.DirectionalLight('#ffab62', 6.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight('#c9a2c4', '#8a6234', 1.25);
  scene.add(fill);

  // Story: everything below is a pure function of t.
  const decel = 0.8;
  const goatX = (t) => {
    if (t < 3.6) return -15.12 + 4.2 * t;
    const k = clamp((t - 3.6) / decel);
    return 4.2 * decel * (k - (k * k) / 2);
  };
  const gallopPhase = (t) => ((goatX(t) + 15.12) * 2.6) / 4.2;

  const pose = (t) => {
    const phase = gallopPhase(t);
    const shuffle = segment(t, 5.85, 6.2) * (1 - segment(t, 6.7, 7.0));
    const run = Math.max(1 - segment(t, 3.45, 4.2), shuffle * 0.32);
    const stride = phase + Math.max(t - 5.85, 0) * 2.1;

    const rearHeader = 1.08 * segment(t, 3.9, 4.85, ease.outCubic) * (1 - segment(t, 5.1, 5.8, ease.inOutCubic));
    const rearHero = 1.12 * segment(t, 7.4, 8.25, ease.outBack);
    const rear = rearHeader + rearHero;
    const windup = segment(t, 4.3, 4.9) * (1 - segment(t, 4.9, 5.0, ease.outCubic));
    const strike = segment(t, 4.9, 5.0, ease.outCubic) * (1 - segment(t, 5.15, 5.7));
    const jump = 0.5 * segment(t, 4.25, 5.0, ease.outQuad) * (1 - segment(t, 5.0, 5.72, ease.inQuad));
    const breathe = Math.sin(t * 1.9) * 0.018;

    goat.root.rotation.y = -(Math.PI / 4) * segment(t, 5.9, 6.95);
    goat.torso.rotation.z = rear + Math.sin(stride * Math.PI * 4) * 0.045 * run + breathe + rearHero * Math.sin(t * 2.2) * 0.02;

    const heroLift = segment(t, 7.4, 8.25);
    goat.neck.rotation.z = -rear * 0.72 + 0.42 * windup - 0.5 * strike + Math.sin(stride * Math.PI * 4 + 1) * 0.05 * run + 0.12 * run + heroLift * 0.2;
    goat.head.rotation.z = -rear * 0.2 + 0.2 * windup - 0.32 * strike - 0.12 * run + heroLift * 0.22 + Math.sin(t * 2.4) * 0.015;

    for (const leg of goat.legs) {
      const s = Math.PI * 2 * (stride + leg.offset);
      const lift = Math.max(0, Math.cos(s));
      const paw = t * 5.2 + (leg.side > 0 ? 0 : 2.1);
      if (leg.front) {
        const gait = { u: 0.6 * Math.sin(s), l: -1.0 * lift };
        const up = rear > 0.05 ? smoothstep(0.05, 0.6, rear) : 0;
        leg.upper.rotation.z = lerp(gait.u * run, -0.1 + 0.42 * Math.sin(paw), up);
        leg.lower.rotation.z = lerp(gait.l * run, -1.25 - 0.3 * Math.cos(paw), up);
      }
      else {
        const air = segment(jump, 0.05, 0.4);
        const stance = leg.side * 0.2 * (segment(t, 7.3, 8) + air);
        leg.upper.rotation.z = lerp(-0.12, -0.28 * lift, run) + 0.58 * Math.sin(s) * run - air * 0.4 + stance;
        leg.lower.rotation.z = lerp(0.12, 0.2 + 0.85 * lift, run) + air * 0.55 - stance * 0.4;
      }
    }

    goat.root.position.set(goatX(t), 0, 0);
    goat.root.updateMatrixWorld(true);
    let lowest = Infinity;
    const p = new THREE.Vector3();
    for (const leg of goat.legs) lowest = Math.min(lowest, leg.hoof.getWorldPosition(p).y);
    const hop = Math.abs(Math.sin(stride * Math.PI * 2)) * 0.06 * run;
    goat.root.position.y = -lowest + jump + hop;
    goat.root.updateMatrixWorld(true);
  };

  pose(T_HEADER);
  const strikePoint = goat.forehead.getWorldPosition(new THREE.Vector3());
  const netPoint = new THREE.Vector3(GOAL_X + 0.89, 1.8, 1.6);

  const dribble = (t) => {
    const k = (gallopPhase(t) / 2) % 1;
    return goatX(t) + 0.98 + 0.2 * Math.sin(Math.PI * k);
  };
  const flickStart = new THREE.Vector3(dribble(T_FLICK), BALL_R, 0);

  const ballAt = (t, out) => {
    if (t < T_FLICK) return out.set(dribble(t), BALL_R + Math.abs(Math.sin(t * 8)) * 0.012, 0);
    if (t < T_HEADER) {
      const u = (t - T_FLICK) / (T_HEADER - T_FLICK);
      out.lerpVectors(flickStart, strikePoint, u);
      out.y += 0.85 * 4 * u * (1 - u);
      return out;
    }
    if (t < T_NET) {
      const k = (t - T_HEADER) / (T_NET - T_HEADER);
      const u = 0.55 * k + 0.45 * k ** 3;
      out.lerpVectors(strikePoint, netPoint, u);
      out.y += 0.5 * 4 * u * (1 - u);
      return out;
    }
    if (t < T_PUSHED) {
      const k = ease.outCubic((t - T_NET) / (T_PUSHED - T_NET));
      return out.set(netPoint.x + 0.85 * k, netPoint.y, netPoint.z);
    }
    const dt = t - T_PUSHED;
    const drop = netPoint.y - BALL_R;
    const fall = Math.sqrt((2 * drop) / 9.8);
    let y;
    if (dt < fall) y = netPoint.y - 4.9 * dt * dt;
    else {
      const rest = (dt - fall) % (fall * 1.0);
      y = BALL_R + Math.max(0, 0.5 * 9.8 * fall * 0.5 * rest - 4.9 * rest * rest);
    }
    return out.set(lerp(netPoint.x + 0.85, GOAL_X + 0.7, segment(dt, 0, 0.8)), y, netPoint.z - dt * 0.15);
  };

  const parts = buildParticles(height);
  for (let i = 0; i < 1700; i++) {
    const b = Math.random() * 4.3;
    const gx = goatX(b);
    parts.add(
      [gx - 0.4 + Math.random() * 0.9, 0.03, (Math.random() - 0.5) * 0.35],
      [-0.9 - Math.random() * 1.5, 0.25 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7],
      b, 0.7 + Math.random() * 0.9, 0.16 + Math.random() * 0.26, 0.09 + Math.random() * 0.1,
    );
  }
  const burst = (center, n, tBirth, speed, life, size, a, flat = false) => {
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3().randomDirection();
      if (flat) d.y = Math.abs(d.y) * 0.4;
      parts.add(center.toArray(), d.multiplyScalar(speed * (0.3 + Math.random())).toArray(), tBirth + Math.random() * 0.05, life * (0.5 + Math.random()), size * (0.5 + Math.random()), a);
    }
  };
  burst(strikePoint, 120, T_HEADER, 1.7, 0.75, 0.07, 0.75);
  burst(new THREE.Vector3(goatX(5.7), 0.05, 0), 160, 5.72, 1.3, 1.5, 0.3, 0.16, true);
  burst(netPoint.clone().setX(GOAL_X + 1.2), 70, T_NET, 1.4, 0.8, 0.09, 0.55);
  burst(new THREE.Vector3(goatX(9), 0.05, 0), 170, 7.45, 0.9, 1.9, 0.34, 0.15, true);
  for (let i = 0; i < 1800; i++) {
    parts.add(
      [-22 + Math.random() * 44, 0.1 + Math.random() * 4.5, -9 + Math.random() * 20],
      [Math.random() * 0.04, 0.02 + Math.random() * 0.03, Math.random() * 0.04],
      -20, 60, 0.018 + Math.random() * 0.04, 0.3 + Math.random() * 0.5,
    );
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.origin, 3));
  particleGeometry.setAttribute('aVel', new THREE.Float32BufferAttribute(parts.velocity, 3));
  particleGeometry.setAttribute('aInfo', new THREE.Float32BufferAttribute(parts.info, 3));
  particleGeometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(parts.alpha, 1));
  const particles = new THREE.Points(particleGeometry, parts.material);
  particles.frustumCulled = false;
  scene.add(particles);

  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const rays = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uStrength: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; varying vec2 vUv;
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        vec3 sum = vec3(0.0);
        if (uStrength > 0.001) {
          vec2 step = (uSun - vUv) / 64.0 * 0.92;
          vec2 p = vUv;
          float decay = 1.0;
          for (int i = 0; i < 64; i++) {
            p += step;
            vec3 s = max(texture2D(tDiffuse, p).rgb - vec3(5.0), vec3(0.0));
            sum += s * decay;
            decay *= 0.965;
          }
          sum *= uStrength / 64.0;
        }
        gl_FragColor = vec4(base + sum * vec3(1.0, 0.72, 0.42), 1.0);
      }`,
  });
  composer.addPass(rays);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.2, 0.6, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uFade: { value: 1 }, uFrame: { value: 0 }, uAspect: { value: width / height } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uFade; uniform float uFrame; uniform float uAspect; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame * 0.37) * 43758.5453); }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, c * vec3(0.9, 0.94, 1.12), smoothstep(0.42, 0.04, l) * 0.55);
        c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.42, 0.9, l) * 0.6);
        vec2 q = (vUv - 0.5) * vec2(1.0, 0.85);
        c *= 1.0 - smoothstep(0.32, 0.8, length(q)) * 0.42;
        c += (hash(vUv * 900.0) - 0.5) * 0.016;
        float bar = (1.0 - uAspect / 2.39) * 0.5;
        float bars = step(bar, vUv.y) * step(vUv.y, 1.0 - bar);
        gl_FragColor = vec4(c * uFade * bars, 1.0);
      }`,
  });
  composer.addPass(grade);

  const ballPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const sunNdc = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const netPositions = goal.net.geometry.attributes.position;

  const shake = (t, amount) => new THREE.Vector3(
    (Math.sin(t * 17.3) + Math.sin(t * 29.1 + 1)) * amount,
    (Math.sin(t * 21.7 + 2) + Math.sin(t * 13.9)) * amount,
    Math.sin(t * 19.1 + 4) * amount,
  );

  return {
    scene,
    camera,
    update(t, { frame }) {
      pose(t);
      const goatPos = goat.root.position;

      ballAt(t, ballPos);
      ball.position.copy(ballPos);
      if (t < T_HEADER) {
        ball.rotation.set(0, 0, -ballPos.x / BALL_R - Math.max(t - T_FLICK, 0) * 5);
      }
      else {
        const spin = Math.min(t, T_PUSHED + 1) - T_HEADER;
        ball.rotation.set(spin * 7, spin * 3, -T_HEADER * 2 - spin * 16);
      }

      // Net bulges where the ball lands, then rings down.
      let bulge = 0;
      if (t >= T_NET) {
        const push = 0.85 * ease.outCubic(clamp((t - T_NET) / (T_PUSHED - T_NET)));
        const dt = Math.max(t - T_PUSHED, 0);
        bulge = t < T_PUSHED ? push : 0.85 * Math.exp(-3.1 * dt) * Math.cos(dt * 13);
      }
      for (const v of goal.backVerts) {
        const d2 = (v.y - netPoint.y) ** 2 + (v.z - netPoint.z) ** 2;
        netPositions.setX(v.index, v.x + bulge * v.edge * Math.exp(-d2 / 0.75));
      }
      netPositions.needsUpdate = true;

      if (t < 3.4) {
        const k = segment(t, 0, 3.4, ease.outQuad);
        const dist = lerp(1.45, 1, k);
        camera.fov = 30;
        camera.position.set(goatPos.x - 3 * dist, lerp(0.75, 0.5, k), 5.5 * dist);
        camera.position.add(shake(t, 0.012));
        look.set(goatPos.x + 0.42, 0.98, 0);
        focus.copy(goatPos);
      }
      else if (t < 5.65) {
        const k = segment(t, 3.4, 5.65);
        camera.fov = 40;
        camera.position.set(strikePoint.x - lerp(4.3, 4.3, k), 0.3, lerp(5.6, 4.9, k));
        const follow = segment(t, 5.05, 5.65);
        look.set(lerp(goatPos.x + 0.4, ballPos.x, follow * 0.28), lerp(0.95, 1.72, segment(t, 3.8, 4.9)), 0);
        camera.position.add(shake(t, 0.007 + 0.03 * Math.exp(-Math.max(t - T_HEADER, 0) * 8) * (t > T_HEADER ? 1 : 0)));
        focus.copy(goatPos);
      }
      else if (t < 7) {
        const k = segment(t, 5.65, 7, ease.outQuad);
        const hit = t > T_NET ? Math.exp(-(t - T_NET) * 6) : 0;
        camera.fov = lerp(32, 29, k);
        camera.position.set(GOAL_X + 7.2, lerp(1.05, 0.9, k), lerp(4.2, 3.6, k));
        camera.position.add(shake(t, 0.006 + hit * 0.05));
        look.set(GOAL_X - 1.2, 1.4, 0.7);
        focus.set(GOAL_X - 5, 0, 0);
      }
      else {
        const k = segment(t, 7, 10, ease.outQuad);
        const dist = lerp(15.5, 12.2, k);
        camera.fov = 16;
        camera.position.set(goatPos.x - SUN_FLAT.x * dist, 0.34, goatPos.z - SUN_FLAT.z * dist);
        camera.position.add(shake(t, 0.004));
        look.set(goatPos.x, 1.2, goatPos.z);
        focus.copy(goatPos);
      }
      camera.updateProjectionMatrix();
      camera.lookAt(look);
      camera.updateMatrixWorld();

      sun.position.copy(focus).addScaledVector(SUN, 80);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();

      shared.sunView.value.copy(SUN).transformDirection(camera.matrixWorldInverse);
      sky.material.uniforms.uTime.value = t;
      parts.material.uniforms.uT.value = t;

      camera.getWorldDirection(forward);
      sunNdc.copy(camera.position).addScaledVector(SUN, 500).project(camera);
      rays.uniforms.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
      const hero = t >= 7;
      bloom.strength = hero ? 0.09 : 0.2;
      goal.group.visible = !hero;
      shared.rimGain.value = hero ? 0.3 : 1;
      fill.intensity = hero ? 0.45 : 1.25;
      sky.material.uniforms.uDisc.value = hero ? 0.32 : 1;
      rays.uniforms.uStrength.value = (hero ? 0.02 : 0.32) * smoothstep(0.55, 0.92, forward.dot(SUN));

      grade.uniforms.uFade.value = segment(t, 0, 0.6, ease.outQuad) * (1 - segment(t, 9.45, 10, ease.inQuad));
      grade.uniforms.uFrame.value = frame;
    },
    render() {
      composer.render();
    },
  };
}
