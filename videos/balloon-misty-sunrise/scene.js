// 0-2.5s pre-dawn: violet valleys, rose horizon, balloon near-silhouette lit by a burner burst
// 2.5-5.5s sun crests the far ridge: gold floods the mist, shafts of light, envelope colors wake up
// 5.5-8s full sunrise: balloon drifts toward center with a second burn, mist glowing below, camera settles
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ease, lerp, segment, smoothstep } from 'kit';

export const config = { duration: 8, fps: 30, width: 1920, height: 1080, seed: 11 };

// Hex to a linear-space GLSL vec3, so palette entries can be written as hex below.
const c3 = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;
};

const KEY_DIR = new THREE.Vector3(0.75, 0.42, 0.35).normalize();
const SUN_AZIMUTH = 0.2;

const NOISE_GLSL = /* glsl */ `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return s / 0.97;
  }
`;

// Shared by sky, terrain haze and mist so everything sits in one atmosphere.
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSun;
  uniform float uDawn;
  uniform float uTime;
  vec3 skyBase(vec3 d) {
    float h = max(d.y, 0.0);
    vec3 horizon = mix(${c3('#c8707a')}, ${c3('#ffb46e')}, uDawn);
    vec3 mid = mix(${c3('#6a5590')}, ${c3('#f09a86')}, uDawn);
    vec3 zen = mix(${c3('#1f2a58')}, ${c3('#3f6fb4')}, uDawn);
    vec3 c = mix(horizon, mid, smoothstep(0.0, 0.14, h));
    c = mix(c, zen, smoothstep(0.1, 0.5, h));
    float s = max(dot(d, uSun), 0.0);
    c += ${c3('#ffb070')} * (pow(s, 14.0) * 0.16 + pow(s, 120.0) * 0.55) * (0.35 + 0.65 * uDawn);
    return c;
  }
`;

function buildSky(shared) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(2000, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...shared },
      vertexShader: /* glsl */ `varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vDir;
        ${SKY_GLSL}
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = skyBase(d);
          // Thin high cloud streaks that catch the color of the light.
          vec2 p = d.xz / (max(d.y, 0.0) + 0.14);
          float n = fbm(p * vec2(0.55, 2.4) + vec2(uTime * 0.012, 3.0));
          float mask = smoothstep(0.5, 0.78, n) * smoothstep(0.03, 0.14, d.y);
          float s = max(dot(d, uSun), 0.0);
          vec3 cloud = mix(${c3('#8a6a9c')}, ${c3('#ffb48a')}, uDawn) + ${c3('#ffcf9a')} * pow(s, 8.0) * uDawn;
          c = mix(c, cloud, mask * 0.7);
          // The sun disc, far above the bloom threshold.
          float disc = smoothstep(cos(0.03), cos(0.02), dot(d, uSun));
          c += vec3(9.0, 6.5, 4.0) * disc;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

function terrainMaterial(shared, { rock, snowLine = 1e6, mistTop, mistBottom }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uMistTop: { value: mistTop }, uMistBottom: { value: mistBottom }, uSnowLine: { value: snowLine } },
    vertexShader: /* glsl */ `varying vec3 vWorld; varying vec3 vN;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = mat3(m) * normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `varying vec3 vWorld; varying vec3 vN;
      uniform float uMistTop; uniform float uMistBottom; uniform float uSnowLine;
      ${SKY_GLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 V = vWorld - cameraPosition;
        float dist = length(V);
        vec3 d = V / dist;

        vec3 albedo = ${c3(rock)};
        float snow = smoothstep(uSnowLine, uSnowLine + 10.0, vWorld.y) * smoothstep(0.35, 0.7, n.y);
        albedo = mix(albedo, ${c3('#f6efe8')}, snow);

        float diff = max(dot(n, ${`vec3(${KEY_DIR.x.toFixed(4)},${KEY_DIR.y.toFixed(4)},${KEY_DIR.z.toFixed(4)})`}), 0.0);
        vec3 sunColor = mix(${c3('#a85a78')} * 0.45, ${c3('#ffb878')} * 1.5, uDawn);
        vec3 ambient = mix(${c3('#3a3a68')}, ${c3('#7f8cc8')}, n.y * 0.5 + 0.5) * mix(0.55, 0.8, uDawn);
        vec3 col = albedo * (ambient + sunColor * diff);

        // Aerial perspective, then valley mist pooling at the foot of each ridge.
        vec3 hazeDir = normalize(vec3(d.x, max(d.y, 0.0) * 0.5 + 0.02, d.z));
        vec3 haze = skyBase(hazeDir);
        col = mix(col, haze, 1.0 - exp(-dist * 0.0023));
        float pool = smoothstep(uMistTop, uMistBottom, vWorld.y);
        col = mix(col, haze * 1.04, pool * 0.94);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function ridgeSampler(noise, layer) {
  return (x, z) => {
    const nx = (x + layer.offset) / layer.scale;
    const nz = z / layer.scale;
    const center = layer.depth * 0.22 * noise.noise(nx * 0.45, 7.3 + layer.i);
    const zc = z - center;
    const profile = Math.exp(-((zc / (layer.depth * 0.3)) ** 2));
    const large = 0.5 + 0.5 * noise.noise(nx * 0.6, layer.i * 3.1);
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < 6; o++) {
      const r = 1 - Math.abs(noise.noise(nx * f + o * 11.7, nz * f + o * 5.3));
      sum += a * r * r;
      norm += a;
      a *= 0.5;
      f *= 2.03;
    }
    return layer.base + layer.h * profile * (0.3 + 0.7 * large) * (0.25 + 0.75 * (sum / norm));
  };
}

function buildRidge(noise, layer, shared) {
  const width = Math.abs(layer.z) * 1.7 + 80;
  const geometry = new THREE.PlaneGeometry(width, layer.depth, 640, 90);
  geometry.rotateX(-Math.PI / 2);
  const sample = ridgeSampler(noise, layer);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, sample(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, terrainMaterial(shared, layer));
  mesh.position.set(8, 0, layer.z);
  return { mesh, sample };
}

function pineGeometry() {
  const parts = [
    [0.42, 0.62, 0.3],
    [0.33, 0.52, 0.62],
    [0.22, 0.42, 0.9],
  ].map(([radius, height, y]) => new THREE.ConeGeometry(radius, height, 7).translate(0, y, 0));
  parts.push(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5).translate(0, 0.12, 0));
  return mergeGeometries(parts);
}

function buildPines(layer, sample, shared, count, minScale, maxScale) {
  const mesh = new THREE.InstancedMesh(pineGeometry(), terrainMaterial(shared, { ...layer, rock: layer.pine }), count);
  const dummy = new THREE.Object3D();
  const halfWidth = Math.abs(layer.z) * 0.85 + 30;
  let placed = 0;
  for (let tries = 0; tries < count * 8 && placed < count; tries++) {
    const x = (Math.random() * 2 - 1) * halfWidth;
    const z = (Math.random() - 0.35) * layer.depth * 0.34;
    const y = sample(x, z);
    if (y < layer.mistTop - 6) continue;
    const s = lerp(minScale, maxScale, Math.random());
    dummy.position.set(x + 8, y - s * 0.05, z + layer.z);
    dummy.scale.set(s, s * lerp(0.9, 1.25, Math.random()), s);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.count = placed;
  mesh.frustumCulled = false;
  return mesh;
}

function buildMist(shared, { z, bottom, top, density, scale, speed, seed }) {
  const width = Math.abs(z) * 1.9 + 90;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, top - bottom),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...shared, uDensity: { value: density }, uScale: { value: scale }, uSpeed: { value: speed }, uSeed: { value: seed } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vWorld;
        uniform float uDensity; uniform float uScale; uniform float uSpeed; uniform float uSeed;
        ${SKY_GLSL}
        ${NOISE_GLSL}
        void main() {
          vec2 p = vec2(vWorld.x, vWorld.y * 2.2) / uScale + vec2(uTime * uSpeed, uSeed);
          float warp = fbm(p * 0.6 + vec2(uSeed * 1.7, uTime * uSpeed * 0.4));
          float n = fbm(p + warp * 1.2);
          float k = 1.0 - vUv.y;
          float a = smoothstep(0.32, 0.78, n + k * 0.85 - 0.3) * smoothstep(0.0, 0.35, k);

          vec3 V = normalize(vWorld - cameraPosition);
          vec3 c = skyBase(normalize(vec3(V.x, 0.03, V.z))) * 1.06;
          // Forward scatter: mist burns gold in the direction of the sun.
          c += ${c3('#ffbf80')} * pow(max(dot(V, uSun), 0.0), 20.0) * 0.28 * uDawn;
          gl_FragColor = vec4(c, a * uDensity);
        }`,
    }),
  );
  mesh.position.set(8, (top + bottom) / 2, z);
  return mesh;
}

function buildEnvelope(shared) {
  const R = 3.7;
  const lowerH = 5.2;
  const upperH = 3.5;
  const throat = 0.62;
  const gores = 24;
  const columns = gores * 12;
  const rings = 110;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= rings; j++) {
    const s = j / rings;
    const split = 0.62;
    let r, y;
    if (s < split) {
      const k = s / split;
      y = k * lowerH;
      r = throat + (R - throat) * Math.sin((k * Math.PI) / 2) ** 0.85;
    } else {
      const a = (((s - split) / (1 - split)) * Math.PI) / 2;
      y = lowerH + upperH * Math.sin(a);
      r = R * Math.cos(a);
    }
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const phi = u * Math.PI * 2;
      // Fabric bulges between load tapes, strongest around the belly.
      const bulge = 1 + 0.035 * Math.abs(Math.sin((phi * gores) / 2)) ** 0.6 * Math.sin(Math.PI * Math.min(1, s * 1.02));
      positions.push(Math.cos(phi) * r * bulge, y, Math.sin(phi) * r * bulge);
      uvs.push(u, s);
    }
  }
  const stride = columns + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Weld normals across the u=0/u=1 seam so no vertical crease shows.
  const normal = geometry.attributes.normal;
  for (let j = 0; j <= rings; j++) {
    const a = j * stride;
    const b = a + columns;
    const v = new THREE.Vector3(
      normal.getX(a) + normal.getX(b),
      normal.getY(a) + normal.getY(b),
      normal.getZ(a) + normal.getZ(b),
    ).normalize();
    normal.setXYZ(a, v.x, v.y, v.z);
    normal.setXYZ(b, v.x, v.y, v.z);
  }

  const uBurn = { value: 0 };
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uBurn },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vN = mat3(modelMatrix) * normal;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
      uniform float uBurn;
      ${SKY_GLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 V = vWorld - cameraPosition;
        float dist = length(V);
        vec3 d = V / dist;
        if (dot(n, d) > 0.0) n = -n;

        float gore = vUv.x * ${gores.toFixed(1)};
        float id = mod(floor(gore), 3.0);
        float f = fract(gore);
        float v = vUv.y;

        vec3 crimson = ${c3('#c3202e')};
        vec3 cream = ${c3('#f6e7c8')};
        vec3 amber = ${c3('#f09a1e')};
        vec3 navy = ${c3('#1b2e66')};
        vec3 albedo = id < 0.5 ? crimson : (id < 1.5 ? cream : amber);

        // A zigzag belly band, a solid crown and a dark skirt: the classic balloon read.
        float tri = abs(f - 0.5) * 2.0;
        float zig = 0.64 + (tri - 0.5) * 0.06;
        float band = smoothstep(0.075, 0.069, abs(v - zig));
        float trim = smoothstep(0.092, 0.086, abs(v - zig));
        albedo = mix(albedo, ${c3('#ffd77a')}, trim);
        albedo = mix(albedo, navy, band);
        albedo = mix(albedo, crimson, smoothstep(0.905, 0.91, v));
        albedo = mix(albedo, navy, smoothstep(0.17, 0.165, v));

        float seam = smoothstep(0.0, 0.035, min(f, 1.0 - f));
        albedo *= mix(0.5, 1.0, seam);

        vec3 key = vec3(${KEY_DIR.x.toFixed(4)},${KEY_DIR.y.toFixed(4)},${KEY_DIR.z.toFixed(4)});
        float wrap = max(dot(n, key) * 0.75 + 0.25, 0.0);
        vec3 sunColor = mix(${c3('#b06a88')} * 0.5, ${c3('#ffd2a0')} * 2.0, uDawn);
        vec3 ambient = mix(${c3('#3c3a66')}, ${c3('#9aa6d8')}, n.y * 0.5 + 0.5) * mix(0.75, 1.1, uDawn);
        vec3 col = albedo * (ambient + sunColor * wrap);

        // Fabric glows when the sun sits behind it, and from inside when the burner fires.
        float back = pow(max(dot(d, uSun), 0.0), 5.0);
        col += albedo * ${c3('#ffb070')} * back * 0.7 * uDawn;
        col += albedo * ${c3('#ff9a3c')} * (0.08 + uBurn * 3.4) * exp(-v * 3.0);
        float rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
        col += ${c3('#ffc896')} * rim * 0.28 * uDawn;

        vec3 haze = skyBase(normalize(vec3(d.x, 0.04, d.z)));
        col = mix(col, haze, 1.0 - exp(-dist * 0.0029));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { mesh: new THREE.Mesh(geometry, material), uBurn };
}

function wickerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#7a5228';
  ctx.fillRect(0, 0, 256, 256);
  const step = 16;
  for (let y = 0; y < 256; y += step) {
    for (let x = 0; x < 256; x += step) {
      const over = (x / step + y / step) % 2 === 0;
      const shade = 150 + Math.random() * 45;
      ctx.fillStyle = `rgb(${shade}, ${shade * 0.72}, ${shade * 0.42})`;
      if (over) ctx.fillRect(x + 1, y + 3, step - 2, step - 6);
      else ctx.fillRect(x + 3, y + 1, step - 6, step - 2);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function rope(from, to, radius, material) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

function buildBalloon(shared) {
  const group = new THREE.Group();
  const { mesh: envelope, uBurn } = buildEnvelope(shared);
  group.add(envelope);

  const basketY = -2.75;
  const size = 0.82;
  const wickerMap = wickerTexture();
  wickerMap.wrapS = wickerMap.wrapT = THREE.RepeatWrapping;
  wickerMap.repeat.set(2.5, 2);
  const wicker = new THREE.MeshStandardMaterial({
    map: wickerMap,
    roughness: 0.95,
    emissive: '#ffffff',
    emissiveMap: wickerMap,
    emissiveIntensity: 0.16,
  });
  const leather = new THREE.MeshStandardMaterial({ color: '#3f2614', roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#8c8c94', roughness: 0.45, metalness: 0.6 });
  const line = new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.9 });

  const basket = new THREE.Mesh(new THREE.BoxGeometry(size * 2, 1.15, size * 2), wicker);
  basket.position.y = basketY;
  group.add(basket);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(size * 2.1, 0.13, size * 2.1), leather);
  rim.position.y = basketY + 0.6;
  group.add(rim);

  const frameY = -1.25;
  const frameR = 0.55;
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sx, sz] of corners) {
    // Basket corner up to the burner frame, frame up to the throat of the envelope.
    group.add(rope([sx * size, basketY + 0.6, sz * size], [sx * frameR, frameY, sz * frameR], 0.028, line));
    group.add(rope([sx * frameR, frameY, sz * frameR], [sx * 0.42, 0.02, sz * 0.42], 0.022, line));
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(frameR * 2, 0.07, frameR * 2), steel);
  frame.position.y = frameY;
  group.add(frame);
  const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 12), steel);
  burner.position.y = frameY + 0.18;
  group.add(burner);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1, 16, 8, true).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uBurn },
      vertexShader: /* glsl */ `varying float vH;
        void main() { vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying float vH; uniform float uBurn;
        void main() {
          vec3 c = mix(vec3(5.0, 3.6, 1.8), vec3(3.0, 0.8, 0.12), smoothstep(0.0, 0.85, vH));
          gl_FragColor = vec4(c * uBurn, (1.0 - vH) * uBurn);
        }`,
    }),
  );
  flame.position.y = frameY + 0.32;
  group.add(flame);

  const glow = new THREE.PointLight('#ff9a48', 0, 12, 1.6);
  glow.position.y = frameY + 0.3;
  group.add(glow);

  return { group, uBurn, flame, glow };
}

export default async function create({ renderer, width, height, config }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const shared = {
    uSun: { value: new THREE.Vector3(0, 0, -1) },
    uDawn: { value: 0 },
    uTime: { value: 0 },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, width / height, 1, 4500);

  const sky = buildSky(shared);
  sky.renderOrder = -1;
  scene.add(sky);

  const noise = new SimplexNoise();
  const wrapNoise = { noise: (x, y) => noise.noise(x, y) };

  const layers = [
    { i: 0, z: -780, depth: 260, base: -5, h: 112, scale: 300, offset: 40, rock: '#6a6f96', snowLine: 44, mistTop: 16, mistBottom: -4 },
    { i: 1, z: -540, depth: 190, base: -18, h: 72, scale: 190, offset: -120, rock: '#4c5684', snowLine: 34, mistTop: 4, mistBottom: -14 },
    { i: 2, z: -360, depth: 130, base: -26, h: 54, scale: 120, offset: 300, rock: '#3b4a72', mistTop: -4, mistBottom: -22 },
    { i: 3, z: -225, depth: 90, base: -30, h: 44, scale: 80, offset: -60, rock: '#2f4164', mistTop: -9, mistBottom: -27 },
    { i: 4, z: -135, depth: 62, base: -30, h: 40, scale: 52, offset: 150, rock: '#26395a', pine: '#1c3550', mistTop: -10, mistBottom: -26 },
    { i: 5, z: -78, depth: 46, base: -24, h: 36, scale: 34, offset: -35, rock: '#1d2c44', pine: '#14283c', mistTop: -9, mistBottom: -22 },
  ];
  const ridges = layers.map((layer) => {
    const ridge = buildRidge(wrapNoise, layer, shared);
    scene.add(ridge.mesh);
    return ridge;
  });
  scene.add(buildPines(layers[4], ridges[4].sample, shared, 900, 2.4, 3.8));
  scene.add(buildPines(layers[5], ridges[5].sample, shared, 420, 2.6, 4.8));

  const mists = [
    { z: -640, bottom: -30, top: 34, density: 0.8, scale: 120, speed: 0.1, seed: 1.3 },
    { z: -440, bottom: -40, top: 22, density: 0.85, scale: 90, speed: 0.14, seed: 4.1 },
    { z: -285, bottom: -40, top: 10, density: 0.88, scale: 60, speed: 0.2, seed: 7.7 },
    { z: -175, bottom: -40, top: 4, density: 0.85, scale: 38, speed: 0.3, seed: 2.9 },
    { z: -103, bottom: -35, top: 2, density: 0.8, scale: 24, speed: 0.42, seed: 9.2 },
    { z: -38, bottom: -20, top: 5, density: 0.12, scale: 14, speed: 0.6, seed: 5.5 },
  ];
  for (const spec of mists) scene.add(buildMist(shared, spec));

  const { group: balloon, uBurn, flame, glow } = buildBalloon(shared);
  balloon.position.z = -45;
  scene.add(balloon);

  const sunLight = new THREE.DirectionalLight('#ffd2a0', 0);
  sunLight.position.copy(KEY_DIR).multiplyScalar(100);
  scene.add(sunLight);
  const hemi = new THREE.HemisphereLight('#9aa6d8', '#3a2c40', 0.6);
  scene.add(hemi);

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));

  // Light shafts: march each pixel toward the sun and gather what is brighter than the sky.
  const rays = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSunUv: { value: new THREE.Vector2(0.7, 0.5) },
      uStrength: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv;
      uniform sampler2D tDiffuse; uniform vec2 uSunUv; uniform float uStrength;
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        vec2 stepUv = (uSunUv - vUv) / 48.0 * 0.9;
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec2 p = vUv + stepUv * jitter;
        vec3 sum = vec3(0.0);
        float w = 1.0;
        for (int i = 0; i < 48; i++) {
          sum += min(max(texture2D(tDiffuse, p).rgb - 2.6, 0.0), vec3(4.0)) * w;
          w *= 0.975;
          p += stepUv;
        }
        gl_FragColor = vec4(base.rgb + sum / 48.0 * uStrength * vec3(1.0, 0.78, 0.55), base.a);
      }`,
  });
  composer.addPass(rays);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.14, 0.55, 1.4));
  composer.addPass(new OutputPass());

  // Vignette plus fine grain, which also keeps the long sky gradients from banding.
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uFrame: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uFrame;
      float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 e = vUv - 0.5;
        // Gentle S-curve and saturation lift, so the haze stays rich rather than milky.
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.55);
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(luma), c, 1.16);
        c *= 1.0 - dot(e, e) * 0.55;
        c += (h(gl_FragCoord.xy + uFrame * 17.0) - 0.5) * 0.018;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(grade);

  const sunWorld = new THREE.Vector3();

  return {
    scene,
    camera,
    update(t, { frame }) {
      const dawn = segment(t, 0.3, 6.6, ease.inOutQuad);
      const rise = t / config.duration;
      const elevation = lerp(-0.05, 0.115, segment(t, 0, 8, ease.linear));

      shared.uDawn.value = dawn;
      shared.uTime.value = t;
      const sun = shared.uSun.value;
      sun.set(Math.sin(SUN_AZIMUTH) * Math.cos(elevation), Math.sin(elevation), -Math.cos(SUN_AZIMUTH) * Math.cos(elevation));

      // Two burner bursts: the first lights the silhouette, the second punctuates the ending.
      const burst = (a, b) => smoothstep(a, a + 0.18, t) * (1 - smoothstep(b - 0.3, b, t));
      const flicker = 0.84 + 0.16 * Math.sin(t * 41) * Math.sin(t * 27 + 1.3);
      const burn = Math.max(burst(0.7, 2.3), burst(5.4, 6.7) * 0.8) * flicker;
      uBurn.value = burn;
      flame.scale.set(1 + burn * 0.25, Math.max(burn * 1.7, 0.001), 1 + burn * 0.25);
      glow.intensity = burn * 22;

      // Steady drift; the camera trucks more slowly and then settles.
      const cx = lerp(0, 14, segment(t, 0, 8, ease.inOutQuad));
      const cy = lerp(19.5, 21.5, segment(t, 0, 8, ease.inOutQuad));
      balloon.position.x = lerp(-10.5, 12, rise);
      balloon.position.y = lerp(17.5, 20.8, rise) + Math.sin(t * 0.8) * 0.12;
      balloon.rotation.y = 0.4 + t * 0.07;
      balloon.rotation.z = Math.sin(t * 0.6 + 0.4) * 0.012;

      camera.fov = lerp(33, 31, segment(t, 0, 8, ease.inOutQuad));
      camera.updateProjectionMatrix();
      camera.position.set(cx, cy, 0);
      camera.lookAt(cx, cy + lerp(2.0, 4.5, segment(t, 0, 8, ease.inOutQuad)), -100);
      camera.updateMatrixWorld();
      sky.position.copy(camera.position);

      sunLight.intensity = lerp(0.25, 2.6, dawn);
      sunLight.color.set('#b06a88').lerp(new THREE.Color('#ffd2a0'), dawn);
      hemi.intensity = lerp(0.45, 1.0, dawn);

      sunWorld.copy(camera.position).addScaledVector(sun, 1500).project(camera);
      rays.uniforms.uSunUv.value.set(sunWorld.x * 0.5 + 0.5, sunWorld.y * 0.5 + 0.5);
      rays.uniforms.uStrength.value = lerp(0.1, 0.55, dawn);
      grade.uniforms.uFrame.value = frame;
    },
    render() {
      composer.render();
    },
  };
}
