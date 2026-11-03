// 0-1.6s boat rides black swells under distant cloud flicker
// 1.6-3.4s a huge swell lifts it, far bolt on the left, then the main strike as it crests
// 3.4-4.6s scene lit white, boat tips over the crest and slams down in spray
// 4.6-6s storm passes, rain thins, moon opens through the clouds, boat sails on
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, ease, lerp, remap, segment, smoothstep } from 'kit';

export const config = { duration: 6, fps: 30, width: 1080, height: 1920, seed: 11 };

// ---------------------------------------------------------------- water surface
// One table drives both the GLSL and the JS height function so the boat really floats.
const WAVES = [
  { dir: [-0.97, 0.24], len: 21, amp: 0.62, sharp: 1.5, phase: 0.4 },
  { dir: [-0.82, 0.57], len: 12.5, amp: 0.34, sharp: 1.8, phase: 2.1 },
  { dir: [-0.99, -0.14], len: 7.3, amp: 0.2, sharp: 2.2, phase: 4.2 },
  { dir: [-0.55, 0.83], len: 4.4, amp: 0.1, sharp: 2.4, phase: 1.3 },
  { dir: [-0.9, -0.44], len: 2.5, amp: 0.05, sharp: 2.4, phase: 3.3 },
  { dir: [-0.3, -0.95], len: 1.45, amp: 0.024, sharp: 2.0, phase: 5.1 },
].map((w) => {
  const k = (Math.PI * 2) / w.len;
  return { ...w, k, omega: Math.sqrt(9.8 * k) * 0.8 };
});

const SWELL = { dir: [-0.96, 0.28], speed: 6.2, sigma: 6.5, amp: 2.3, peakAt: 3.3 };
const BOAT_SPEED = 1.5;
const BOAT_HEADING = new THREE.Vector2(0.97, 0.24).normalize();

const stormAt = (t) => lerp(1, 0.56, segment(t, 4.2, 5.9, ease.inOutQuad));
const boatXZ = (t) => [BOAT_HEADING.x * BOAT_SPEED * t, BOAT_HEADING.y * BOAT_SPEED * t];

const swellOrigin = (() => {
  const [x, z] = boatXZ(SWELL.peakAt);
  return x * SWELL.dir[0] + z * SWELL.dir[1];
})();

function heightAt(x, z, t) {
  let h = 0;
  for (const w of WAVES) {
    const s = 0.5 + 0.5 * Math.sin((w.dir[0] * x + w.dir[1] * z) * w.k - w.omega * t + w.phase);
    h += w.amp * (2 * s ** w.sharp - 1);
  }
  h *= stormAt(t);
  const q = (x * SWELL.dir[0] + z * SWELL.dir[1] - swellOrigin - SWELL.speed * (t - SWELL.peakAt)) / SWELL.sigma;
  return h + SWELL.amp * Math.exp(-q * q);
}

const WAVE_GLSL = `
uniform float uTime;
uniform float uStorm;
uniform float uSwellQ;
float waveHeight(vec2 p) {
  float h = 0.0;
  float s;
${WAVES.map((w) => `  s = 0.5 + 0.5 * sin(dot(vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)}), p) * ${w.k.toFixed(5)} - ${w.omega.toFixed(5)} * uTime + ${w.phase.toFixed(4)});
  h += ${w.amp.toFixed(4)} * (2.0 * pow(s, ${w.sharp.toFixed(3)}) - 1.0);`).join('\n')}
  h *= uStorm;
  float q = (dot(vec2(${SWELL.dir[0].toFixed(4)}, ${SWELL.dir[1].toFixed(4)}), p) - uSwellQ) / ${SWELL.sigma.toFixed(3)};
  return h + ${SWELL.amp.toFixed(3)} * exp(-q * q);
}`;

const NOISE_GLSL = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p, int octaves) {
  float a = 0.5;
  float v = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < octaves; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}`;

// Shared by sky and water so the far sea melts into the horizon, whatever the lightning does.
const ATMOS_GLSL = `
uniform float uFlash;
uniform vec3 uFlashDir;
uniform float uClear;
const vec3 FLASH_COLOR = vec3(0.78, 0.84, 1.0);
const vec3 MOON_DIR = normalize(vec3(-0.13, 0.40, -1.0));
vec3 hazeColor(vec3 dir) {
  float toFlash = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uFlashDir.x, 0.0, uFlashDir.z))), 0.0);
  vec3 c = mix(vec3(0.006, 0.011, 0.022), vec3(0.012, 0.02, 0.036), uClear);
  return c + FLASH_COLOR * uFlash * (0.035 + 0.3 * pow(toFlash, 10.0));
}`;

// ---------------------------------------------------------------- ocean
function buildOcean() {
  // Non-uniform grid: dense under the boat, huge cells out to the horizon.
  const cols = 480;
  const rows = 480;
  const reach = 1400;
  const warp = (u) => Math.sign(u) * (0.16 * Math.abs(u) + 0.84 * Math.abs(u) ** 4) * reach;
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  let n = 0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      positions[n++] = warp((i / cols) * 2 - 1) * 0.5;
      positions[n++] = 0;
      positions[n++] = warp((j / rows) * 2 - 1);
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  n = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index[n++] = a; index[n++] = c; index[n++] = b;
      index[n++] = b; index[n++] = c; index[n++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStorm: { value: 1 },
      uSwellQ: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0, 0.3, -1) },
      uFlashPos: { value: new THREE.Vector3(0, 40, -150) },
      uClear: { value: 0 },
      uBoat: { value: new THREE.Vector2() },
      uFwd: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: `
      uniform vec2 uOffset;
      varying vec3 vWorld;
      ${WAVE_GLSL}
      void main() {
        vec2 p = position.xz + uOffset;
        vec3 world = vec3(p.x, waveHeight(p), p.y);
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uFlashPos;
      uniform vec2 uBoat;
      uniform vec2 uFwd;
      varying vec3 vWorld;
      ${WAVE_GLSL}
      ${NOISE_GLSL}
      ${ATMOS_GLSL}
      void main() {
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        // Geometric normal from the wave function, plus fading ripples.
        float e = 0.09 + dist * 0.006;
        float h0 = waveHeight(p);
        float hx = waveHeight(p + vec2(e, 0.0));
        float hz = waveHeight(p + vec2(0.0, e));
        float hxm = waveHeight(p - vec2(e, 0.0));
        float hzm = waveHeight(p - vec2(0.0, e));
        vec2 grad = vec2(hx - hxm, hz - hzm) / (2.0 * e);
        float curvature = (hx + hxm + hz + hzm - 4.0 * h0) / (e * e);

        float rippleFade = exp(-dist * 0.045);
        vec2 q = p * 4.4 + vec2(uTime * 1.3, -uTime * 0.7);
        float r0 = fbm(q, 5);
        float rx = fbm(q + vec2(0.07, 0.0), 5);
        float rz = fbm(q + vec2(0.0, 0.07), 5);
        grad += vec2(rx - r0, rz - r0) * 3.4 * rippleFade;
        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

        float NdV = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.025 + 0.975 * pow(1.0 - NdV, 5.0);
        fresnel = min(fresnel, 0.72);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);

        // Reflected sky: dim gradient, moon pool opening later, sheet light from the flash.
        float toMoon = max(dot(R, MOON_DIR), 0.0);
        vec3 skyRefl = mix(vec3(0.012, 0.02, 0.04), vec3(0.022, 0.035, 0.065), R.y);
        skyRefl += vec3(0.5, 0.58, 0.72) * (0.03 + 0.07 * uClear) * pow(toMoon, 18.0);
        skyRefl += FLASH_COLOR * uFlash * (0.09 + 0.32 * pow(max(dot(R, uFlashDir), 0.0), 6.0));

        float crest = clamp(h0 * 0.28 + 0.34, 0.0, 1.0);
        vec3 body = mix(vec3(0.002, 0.007, 0.012), vec3(0.005, 0.026, 0.038), crest);
        // Light passing through thin wave tops.
        float back = pow(max(dot(-V, normalize(uFlashDir + N * 0.4)), 0.0), 3.0);
        body += vec3(0.05, 0.28, 0.33) * uFlash * (0.1 + back * 0.5) * (0.35 + crest);
        body += vec3(0.008, 0.03, 0.04) * pow(max(dot(-V, normalize(MOON_DIR + N * 0.4)), 0.0), 3.0);

        vec3 color = mix(body, skyRefl, fresnel);

        // Glints: moon streak and a hot streak under the bolt.
        vec3 H = normalize(V + MOON_DIR);
        color += vec3(0.75, 0.82, 1.0) * pow(max(dot(N, H), 0.0), 220.0) * (0.1 + 0.45 * uClear);
        vec3 L = normalize(uFlashPos - vWorld);
        H = normalize(V + L);
        color += FLASH_COLOR * pow(max(dot(N, H), 0.0), 160.0) * uFlash * 1.4;

        // Foam: on sharp crests, streaked along the wind, and hugging the hull and wake.
        float streak = fbm(vec2(p.x * 0.5 + uTime * 0.5, p.y * 1.9) * 1.5, 4);
        float grain = fbm(p * 5.5 + vec2(uTime * 0.6, 0.0), 3);
        float crestFoam = smoothstep(0.3, 0.9, -curvature * 0.5 + (streak - 0.5) * 1.1);
        float slopeFoam = smoothstep(0.62, 0.95, streak + grain * 0.25) * smoothstep(0.1, 0.7, length(grad)) * 0.5;

        vec2 rel = p - uBoat;
        float a = dot(rel, uFwd);
        float b = dot(rel, vec2(-uFwd.y, uFwd.x));
        float ring = (a * a) / (1.3 * 1.3) + (b * b) / (0.58 * 0.58);
        float hullFoam = smoothstep(2.6, 0.9, ring);
        float wakeEdge = 0.42 + 0.17 * max(-a, 0.0);
        float wake = smoothstep(wakeEdge * 1.7, wakeEdge * 0.7, abs(b)) * step(a, 0.2) * exp(a * 0.14);
        float boatFoam = max(hullFoam, wake * 0.8) * smoothstep(0.32, 0.62, grain + streak * 0.35);

        float foam = clamp(max(max(crestFoam * 0.9, slopeFoam), boatFoam), 0.0, 1.0) * rippleFade;
        foam *= smoothstep(0.1, 0.5, grain + 0.1);
        vec3 foamLit = vec3(0.035, 0.05, 0.07) + vec3(0.03, 0.04, 0.055) * uClear + FLASH_COLOR * uFlash * 0.38;
        // The boat's own churn catches the same moonlight as the paper, so the hull sits in the water.
        foamLit += vec3(0.16, 0.19, 0.24) * boatFoam;
        color = mix(color, foamLit, foam);

        // Into the haze.
        float fog = 1.0 - exp(-pow(dist * 0.0052, 1.7));
        color = mix(color, hazeColor(-V), fog);
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- sky
function buildSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0, 0.3, -1) },
      uClear: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${ATMOS_GLSL}
      float clouds(vec2 uv) {
        vec2 warp = vec2(fbm(uv * 0.8 + vec2(uTime * 0.05, 0.0), 3), fbm(uv * 0.8 + vec2(5.2, 1.3 - uTime * 0.04), 3));
        return fbm(uv + warp * 1.7 + vec2(uTime * 0.09, uTime * 0.02), 6);
      }
      void main() {
        vec3 dir = normalize(vDir);
        float up = max(dir.y, 0.0);
        vec2 uv = dir.xz / (up + 0.2) * 3.0 + vec2(3.1, 1.7);

        float d = clouds(uv);
        // Sample a step toward the light for cheap self-shadowing: billows get lit sides.
        vec2 lightStep = normalize(uFlashDir.xz / (uFlashDir.y + 0.2) * 3.0 + vec2(3.1, 1.7) - uv + 1e-4) * 0.2;
        float dLight = clouds(uv + lightStep);
        float billow = clamp((d - dLight) * 3.6 + 0.5, 0.0, 1.0);

        // Night behind the clouds, with the moon, and the deck tearing open around it at the end.
        float toMoon = max(dot(dir, MOON_DIR), 0.0);
        float coverage = mix(0.34, 0.43, uClear) + 0.42 * uClear * pow(toMoon, 40.0);
        float thick = smoothstep(coverage, coverage + 0.16, d);
        vec3 night = vec3(0.003, 0.006, 0.014);
        vec3 moonGlow = vec3(0.34, 0.42, 0.6) * pow(toMoon, 220.0) * 0.8 + vec3(0.1, 0.15, 0.26) * pow(toMoon, 30.0) * 0.3;
        float disc = smoothstep(0.99978, 0.99986, toMoon);
        vec3 back = night + moonGlow * (0.1 + 0.5 * uClear) + vec3(0.95, 1.0, 1.1) * disc * uClear;

        // Cloud body: bruised blue, edges catching what moonlight gets through.
        vec3 cloud = mix(vec3(0.005, 0.008, 0.016), vec3(0.024, 0.031, 0.054), smoothstep(0.35, 0.75, d));
        cloud += vec3(0.024, 0.032, 0.056) * billow * billow;
        cloud += vec3(0.32, 0.38, 0.52) * (0.03 + 0.34 * uClear) * pow(toMoon, 22.0) * (0.35 + billow);

        // Lightning: a soft bloom in the deck around the strike, plus a faint whole-sky sheet.
        float toFlash = max(dot(dir, uFlashDir), 0.0);
        float pool = 0.08 + 1.0 * pow(toFlash, 22.0) + 0.25 * pow(toFlash, 5.0);
        cloud += FLASH_COLOR * uFlash * pool * (0.14 + 0.72 * billow * billow) * (0.45 + d);

        vec3 color = mix(back + FLASH_COLOR * uFlash * 0.025, cloud, thick);
        color = mix(hazeColor(dir), color, smoothstep(0.0, 0.14, dir.y));
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ---------------------------------------------------------------- lightning
function jagged(from, to, roughness, depth) {
  let points = [from, to];
  let amount = from.distanceTo(to) * roughness;
  for (let d = 0; d < depth; d++) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const mid = a.clone().lerp(b, 0.42 + Math.random() * 0.16);
      mid.x += (Math.random() - 0.5) * amount;
      mid.y += (Math.random() - 0.5) * amount * 0.25;
      next.push(mid, b);
    }
    points = next;
    amount *= 0.56;
  }
  return points;
}

function buildBolt({ x, z, top, width, branches, ground = -3 }) {
  const start = new THREE.Vector3(x + (Math.random() - 0.5) * top * 0.3, top, z);
  const end = new THREE.Vector3(x, ground, z);
  const strands = [{ points: jagged(start, end, 0.26, 7), width, offset: 0, span: 1 }];

  // Branches peel from the main stem, thinner and fading out.
  const main = strands[0].points;
  for (let i = 0; i < branches; i++) {
    const at = 0.08 + Math.random() * 0.62;
    const index = Math.floor(at * (main.length - 1));
    const a = main[index];
    const length = top * (0.09 + Math.random() * 0.2) * (1 - at * 0.5);
    const side = Math.random() < 0.5 ? -1 : 1;
    const b = a.clone().add(new THREE.Vector3(side * length * (0.45 + Math.random() * 0.5), -length * (0.65 + Math.random() * 0.35), 0));
    strands.push({ points: jagged(a, b, 0.3, 5), width: width * 0.4, offset: at, span: 0.25 });
  }

  const pos = [];
  const across = [];
  const along = [];
  const taper = [];
  const indices = [];
  for (const strand of strands) {
    const { points } = strand;
    const base = pos.length / 3;
    for (let i = 0; i < points.length; i++) {
      const k = i / (points.length - 1);
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const w = strand.width * (strand.span === 1 ? 1 : 1 - k * 0.92);
      pos.push(p.x + nx * w, p.y + ny * w, p.z, p.x - nx * w, p.y - ny * w, p.z);
      across.push(-1, 1);
      const reveal = strand.offset + k * strand.span;
      along.push(reveal, reveal);
      const fade = strand.span === 1 ? 1 : 1 - k;
      taper.push(fade, fade);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geometry.setAttribute('aTaper', new THREE.Float32BufferAttribute(taper, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uStrength: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: `
      attribute float aAcross; attribute float aAlong; attribute float aTaper;
      varying float vAcross; varying float vAlong; varying float vTaper;
      void main() {
        vAcross = aAcross; vAlong = aAlong; vTaper = aTaper;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uStrength; uniform float uReveal;
      varying float vAcross; varying float vAlong; varying float vTaper;
      void main() {
        if (vAlong > uReveal) discard;
        float core = exp(-vAcross * vAcross * 9.0);
        float halo = exp(-vAcross * vAcross * 2.2) * 0.35;
        vec3 c = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.98, 1.0), core);
        gl_FragColor = vec4(c * (core * 6.0 + halo) * uStrength * vTaper, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

// ---------------------------------------------------------------- paper boat
function paperTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, size, size);
  // Fibers.
  for (let i = 0; i < 3500; i++) {
    const shade = Math.random() < 0.5 ? '255,252,244' : '176,166,146';
    ctx.strokeStyle = `rgba(${shade},${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.8;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    const l = 3 + Math.random() * 13;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // Notebook rules: the detail that says "paper", not "white plastic".
  ctx.strokeStyle = 'rgba(92,128,178,0.5)';
  ctx.lineWidth = 2.5;
  for (let y = 22; y < size; y += 51.2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

function buildBoat() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tipF = V(1.08, 0.66, 0);
  const tipB = V(-1.08, 0.66, 0);
  const keelF = V(0.54, 0, 0);
  const keelB = V(-0.54, 0, 0);
  const apex = V(0.0, 1.22, 0);

  const pos = [];
  const col = [];
  const uvs = [];
  const creases = [];
  // Each panel takes the ruled paper at its own angle, as a real fold would.
  const tri = (a, b, c, shade, angle) => {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      // Damp, greyer paper down by the waterline.
      const wet = 1 - 0.32 * smoothstep(0.32, 0.03, p.y);
      col.push(shade * wet, shade * wet * 0.99, shade * wet * 0.97);
      const u = p.x + p.z * 0.6;
      const v = p.y + p.z * 0.4;
      uvs.push((u * ca - v * sa) * 0.55, (u * sa + v * ca) * 0.55);
    }
    creases.push(a, b, b, c, c, a);
  };

  for (const s of [1, -1]) {
    const mid = V(0, 0.46, 0.4 * s);
    const belly = V(0, 0.0, 0.17 * s);
    const baseF = V(0.5, 0.42, 0.055 * s);
    const baseB = V(-0.5, 0.42, 0.055 * s);
    const floorF = V(0.42, 0.22, 0);
    const floorB = V(-0.42, 0.22, 0);
    const a = s > 0 ? 0.1 : -0.1;
    // Outer hull.
    tri(keelF, tipF, mid, 0.97, 0.55 * s + a);
    tri(keelB, mid, tipB, 0.88, -0.55 * s + a);
    tri(keelF, mid, belly, 0.92, 0.08 + a);
    tri(keelB, belly, mid, 0.85, -0.08 + a);
    tri(keelF, belly, keelB, 0.6, 0.0);
    // Inside of the hull, in shadow.
    tri(tipF, floorF, mid, 0.42, 1.0);
    tri(mid, floorF, floorB, 0.34, 0.2);
    tri(mid, floorB, tipB, 0.42, -1.0);
    // The peak, with a shelf down to the gunwale.
    tri(baseF, apex, baseB, s > 0 ? 1.0 : 0.82, 0.9 * s);
    tri(baseF, baseB, mid, 0.62, 0.3 * s);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: paperTexture(),
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    side: THREE.DoubleSide,
    emissive: new THREE.Color('#f0e4cc'),
    emissiveIntensity: 0.06,
  });
  material.emissiveMap = material.map;

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(creases),
    new THREE.LineBasicMaterial({ color: '#4a4438', transparent: true, opacity: 0.45 }),
  ));
  return group;
}

// ---------------------------------------------------------------- rain and spray
function buildRain() {
  const count = 2000;
  const seed = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  const position = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();
    const speed = 0.8 + Math.random() * 0.4;
    for (let k = 0; k < 2; k++) {
      seed.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k * speed;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 1 },
      uFlash: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
    },
    vertexShader: `
      attribute vec3 aSeed; attribute float aEnd;
      uniform float uTime; uniform vec3 uCenter;
      varying float vEnd; varying float vSeed;
      void main() {
        const vec3 box = vec3(22.0, 24.0, 26.0);
        const vec3 fall = vec3(-5.5, -25.0, 1.5);
        // Each drop's phase wraps in a box around the camera's view.
        vec3 p = fract(aSeed + (fall * uTime - uCenter) / box) * box - box * 0.5 + uCenter;
        p -= normalize(fall) * aEnd * 0.6;
        vEnd = aEnd; vSeed = aSeed.x;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uAmount; uniform float uFlash;
      varying float vEnd; varying float vSeed;
      void main() {
        if (fract(vSeed * 37.7) > uAmount) discard;
        vec3 c = vec3(0.34, 0.42, 0.56) * 0.14 + vec3(0.8, 0.86, 1.0) * uFlash * 0.2;
        gl_FragColor = vec4(c * smoothstep(0.0, 0.5, vEnd), 1.0);
      }`,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

function buildSpray(pointScale) {
  const count = 420;
  const particles = [];
  const fwd = new THREE.Vector3(BOAT_HEADING.x, 0, BOAT_HEADING.y);
  const side = new THREE.Vector3(-BOAT_HEADING.y, 0, BOAT_HEADING.x);
  for (let i = 0; i < count; i++) {
    // Most of it is the slam at the foot of the swell, the rest is steady bow spit.
    const burst = i < count * 0.62;
    const te = burst ? 4.02 + Math.random() ** 2 * 0.42 : Math.random() * 5.8;
    const sign = Math.random() < 0.5 ? -1 : 1;
    const along = burst ? 0.15 + Math.random() * 0.75 : 0.7 + Math.random() * 0.2;
    const [bx, bz] = boatXZ(te);
    const origin = new THREE.Vector3(bx, 0, bz)
      .addScaledVector(fwd, along)
      .addScaledVector(side, sign * (0.25 + Math.random() * 0.2));
    origin.y = heightAt(origin.x, origin.z, te) + 0.04;
    const power = burst ? 1.3 + Math.random() * 2.2 : 0.5 + Math.random() * 0.9;
    const velocity = new THREE.Vector3()
      .addScaledVector(fwd, BOAT_SPEED * 0.6 + Math.random() * power * 0.7)
      .addScaledVector(side, sign * (0.3 + Math.random() * power * 0.8));
    velocity.y = power * (0.9 + Math.random() * 0.8);
    particles.push({ te, origin, velocity, life: 0.45 + Math.random() * 0.55, size: 0.5 + Math.random() });
  }

  const position = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const size = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uFlash: { value: 0 }, uClear: { value: 0 }, uScale: { value: pointScale } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize;
      uniform float uScale; varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uFlash; uniform float uClear; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float soft = smoothstep(1.0, 0.25, d);
        vec3 c = vec3(0.12, 0.15, 0.2) + vec3(0.1, 0.11, 0.13) * uClear + vec3(0.78, 0.84, 1.0) * uFlash * 0.8;
        gl_FragColor = vec4(c, soft * vAlpha);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.update = (t) => {
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const age = t - p.te;
      const alive = age > 0 && age < p.life;
      alpha[i] = alive ? 0.75 * (1 - age / p.life) : 0;
      size[i] = p.size;
      position[i * 3] = p.origin.x + p.velocity.x * age;
      position[i * 3 + 1] = p.origin.y + p.velocity.y * age - 4.9 * age * age;
      position[i * 3 + 2] = p.origin.z + p.velocity.z * age;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  };
  return points;
}

// ---------------------------------------------------------------- lightning timeline
// `peaks` are [delay, brightness]; each decays fast, so a strike stutters like the real thing.
const STRIKES = [
  { time: 0.62, peaks: [[0, 0.3], [0.1, 0.42], [0.24, 0.2]], at: [-34, 0.33, -1], bolt: null },
  { time: 1.92, peaks: [[0, 0.7], [0.09, 0.42], [0.2, 0.76], [0.36, 0.28]], at: [-0.17, 0.2, -1], bolt: { dist: 215, offset: -6, top: 150, width: 1.45, branches: 5 } },
  { time: 3.27, peaks: [[0, 1.5], [0.08, 0.7], [0.17, 1.35], [0.32, 0.95], [0.5, 0.4]], at: [0.13, 0.26, -1], bolt: { dist: 135, offset: 8, top: 105, width: 1.25, branches: 8 } },
  { time: 5.0, peaks: [[0, 0.22], [0.13, 0.3]], at: [0.45, 0.2, -1], bolt: null },
];

const strikeLevel = (strike, t) => {
  let level = 0;
  for (const [delay, amount] of strike.peaks) {
    const age = t - strike.time - delay;
    if (age >= 0) level = Math.max(level, amount * Math.exp(-age / 0.075));
  }
  return level;
};

export default async function create({ renderer, width, height }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02040a');
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 4000);

  const sky = buildSky();
  scene.add(sky);
  const ocean = buildOcean();
  scene.add(ocean);

  for (const strike of STRIKES) {
    if (!strike.bolt) continue;
    const [bx, bz] = boatXZ(strike.time);
    strike.mesh = buildBolt({
      x: bx + strike.bolt.offset,
      z: bz - strike.bolt.dist,
      top: strike.bolt.top,
      width: strike.bolt.width,
      branches: strike.bolt.branches,
    });
    strike.boltWorld = new THREE.Vector3(bx + strike.bolt.offset, strike.bolt.top * 0.45, bz - strike.bolt.dist);
    scene.add(strike.mesh);
  }

  const boat = buildBoat();
  scene.add(boat);

  const rain = buildRain();
  scene.add(rain);
  const spray = buildSpray((height / 1920) * 62);
  scene.add(spray);

  // Moon keys the paper from the front so it stays the brightest thing in the dark.
  const moon = new THREE.DirectionalLight('#c4d2ee', 1.7);
  moon.position.set(-2, 3, 8);
  scene.add(moon);
  const hemi = new THREE.HemisphereLight('#7388ae', '#16303f', 0.8);
  scene.add(hemi);
  const flashFront = new THREE.DirectionalLight('#dbe3ff', 0);
  scene.add(flashFront);
  const flashBack = new THREE.DirectionalLight('#dbe3ff', 0);
  scene.add(flashBack);

  const samples = 4;
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.6, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const targetQuat = new THREE.Quaternion();
  const focus = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const flashVec = new THREE.Vector3();
  let boatY = null;
  let camY = null;

  return {
    scene,
    camera,
    update(t, { dt }) {
      const storm = stormAt(t);
      const clear = segment(t, 4.5, 5.9, ease.inOutQuad);
      const swellQ = swellOrigin + SWELL.speed * (t - SWELL.peakAt);

      // Which strike is loudest right now sets where the light comes from.
      let flash = 0;
      let active = STRIKES[0];
      for (const strike of STRIKES) {
        const level = strikeLevel(strike, t);
        if (level > flash) {
          flash = level;
          active = strike;
        }
        if (strike.mesh) {
          const age = t - strike.time;
          strike.mesh.visible = age >= 0 && age < 0.7 && level > 0.05;
          strike.mesh.material.uniforms.uStrength.value = Math.min(level * 1.5, 1.4);
          strike.mesh.material.uniforms.uReveal.value = remap(age, 0, 0.05, 0.3, 1.05);
        }
      }
      // Soft-clip so stacked peaks light the scene without whiting it out; bolts keep the raw level.
      flash = 1 - Math.exp(-1.1 * flash);
      if (active.boltWorld) flashVec.copy(active.boltWorld).sub(camera.position).normalize();
      else flashVec.set(...active.at).normalize();
      if (active.boltWorld && !isFinite(flashVec.x)) flashVec.set(0, 0.3, -1).normalize();

      // ---- boat floats on the true surface, with a little lag so it has weight.
      const [bx, bz] = boatXZ(t);
      const yawWobble = Math.sin(t * 1.3) * 0.05 + Math.sin(t * 2.9 + 1) * 0.025;
      const yaw = Math.atan2(BOAT_HEADING.y, BOAT_HEADING.x) + yawWobble;
      fwd.set(Math.cos(yaw), 0, Math.sin(yaw));
      side.set(-fwd.z, 0, fwd.x);

      const bowX = bx + fwd.x * 1.1;
      const bowZ = bz + fwd.z * 1.1;
      const sternX = bx - fwd.x * 1.1;
      const sternZ = bz - fwd.z * 1.1;
      const portX = bx + side.x * 0.55;
      const portZ = bz + side.z * 0.55;
      const starX = bx - side.x * 0.55;
      const starZ = bz - side.z * 0.55;
      const hBow = heightAt(bowX, bowZ, t);
      const hStern = heightAt(sternX, sternZ, t);
      const hPort = heightAt(portX, portZ, t);
      const hStar = heightAt(starX, starZ, t);
      const hCenter = heightAt(bx, bz, t);
      // Paper is light: it sits on the highest water under it instead of the mean.
      const surface = Math.max((hBow + hStern + hPort + hStar + hCenter * 2) / 6, hCenter);
      if (boatY === null) boatY = surface;
      boatY = lerp(boatY, surface, 1 - Math.exp(-dt * 15));

      tmp.set(fwd.x * 2.2, hBow - hStern, fwd.z * 2.2).normalize();
      const sideV = new THREE.Vector3(side.x * 1.1, hPort - hStar, side.z * 1.1).normalize();
      up.crossVectors(sideV, tmp).normalize();
      if (up.y < 0) up.negate();
      const realSide = new THREE.Vector3().crossVectors(tmp, up).normalize();
      basis.makeBasis(tmp, up, realSide);
      targetQuat.setFromRotationMatrix(basis);
      if (t === 0) boat.quaternion.copy(targetQuat);
      boat.quaternion.slerp(targetQuat, 1 - Math.exp(-dt * 7));
      boat.position.set(bx, boatY - 0.2, bz);

      // ---- camera: low on the water, and never behind a wave.
      const push = segment(t, 0, 6, ease.inOutQuad);
      const distance = lerp(8.2, 6.9, push);
      const lateral = lerp(-1.3, 1.1, push);
      const camX = bx + lateral;
      const camZ = bz + distance;
      let wanted = Math.max(boatY + 0.45, heightAt(camX, camZ, t) + 0.6);
      for (let k = 0.25; k < 1; k += 0.25) {
        const sx = lerp(camX, bx, k);
        const sz = lerp(camZ, bz, k);
        // The ray to the boat must clear the water here; solve for how high the camera has to be.
        const clearing = heightAt(sx, sz, t) + 0.18;
        wanted = Math.max(wanted, (clearing - (boatY + 0.3) * k) / (1 - k));
      }
      if (camY === null) camY = wanted;
      camY = lerp(camY, wanted, 1 - Math.exp(-dt * 6));
      camera.position.set(camX, camY, camZ);

      // Boat sits in the lower third, with the storm filling the rest of the tall frame.
      const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      focus.set(bx, boatY + 0.32 * halfHeight + 0.3, bz);
      camera.lookAt(focus);
      const shake = flash * 0.004;
      camera.rotation.z += Math.sin(t * 7.3) * 0.006 + Math.sin(t * 31) * shake;
      camera.updateMatrixWorld();

      // ---- uniforms
      const water = ocean.material.uniforms;
      water.uTime.value = t;
      water.uStorm.value = storm;
      water.uSwellQ.value = swellQ;
      water.uOffset.value.set(bx, bz);
      water.uFlash.value = flash;
      water.uFlashDir.value.copy(flashVec);
      if (active.boltWorld) water.uFlashPos.value.copy(active.boltWorld);
      else water.uFlashPos.value.copy(flashVec).multiplyScalar(200).add(camera.position);
      water.uClear.value = clear;
      water.uBoat.value.set(bx, bz);
      water.uFwd.value.set(fwd.x, fwd.z);

      const skyU = sky.material.uniforms;
      skyU.uTime.value = t;
      skyU.uFlash.value = flash;
      skyU.uFlashDir.value.copy(flashVec);
      skyU.uClear.value = clear;

      rain.material.uniforms.uTime.value = t;
      rain.material.uniforms.uAmount.value = lerp(1, 0.2, smoothstep(4.3, 5.8, t));
      rain.material.uniforms.uFlash.value = flash;
      camera.getWorldDirection(tmp);
      rain.material.uniforms.uCenter.value.copy(camera.position).addScaledVector(tmp, 9);

      spray.update(t);
      spray.material.uniforms.uFlash.value = flash;
      spray.material.uniforms.uClear.value = clear;

      // ---- light on the paper
      moon.intensity = lerp(1.7, 2.1, clear);
      hemi.intensity = lerp(0.8, 0.95, clear);
      flashFront.position.set(flashVec.x * 0.7, 2, 3);
      flashFront.intensity = flash * 1.3;
      flashBack.position.copy(flashVec);
      flashBack.intensity = flash * 1.4;
      bloom.strength = 0.26 + clamp(flash) * 0.2;
    },
    render() {
      composer.render();
    },
  };
}
