// Soft glowing orbs drifting slowly on the right side, leaning away from the cursor.
import * as THREE from 'three';

export const config = { stillAt: 6 };

const PALETTES = {
  dark: { violet: '#ab7cff', cyan: '#3adaf2', blending: THREE.AdditiveBlending, strength: 1.6 },
  // Deepened so the glow still reads against a light page, where additive blending would vanish.
  light: { violet: '#8250f0', cyan: '#0fa8cc', blending: THREE.NormalBlending, strength: 1.05 },
};

// Hand placed, back to front. u runs across the canvas from centre (0) to right edge (1), v from
// bottom (-1) to top (1), so the cluster stays on the right whatever the page's shape.
// [u, v, radius, cyan amount, alpha]
const ORBS = [
  [0.62, 0.3, 0.85, 0, 0.2],
  [0.86, -0.35, 0.8, 1, 0.18],
  [0.42, -0.15, 0.6, 0, 0.12],
  [1.0, 0.55, 0.65, 1, 0.15],

  [0.7, -0.1, 0.4, 1, 0.26],
  [0.52, 0.5, 0.3, 1, 0.18],
  [0.92, 0.12, 0.36, 0, 0.3],
  [0.6, -0.62, 0.3, 0, 0.22],
  [0.8, 0.62, 0.26, 0, 0.24],
  [0.38, 0.2, 0.2, 1, 0.14],

  [0.74, 0.28, 0.12, 1, 0.55],
  [0.58, 0.02, 0.1, 0, 0.5],
  [0.88, -0.22, 0.13, 0, 0.55],
  [0.68, -0.42, 0.09, 1, 0.5],
  [0.97, -0.62, 0.11, 1, 0.45],
  [0.46, -0.4, 0.08, 1, 0.34],
  [0.84, 0.84, 0.09, 1, 0.4],
];

// Phone heroes have text across most of the width, so the orbs get smaller and quieter there.
const PHONE_ASPECT = 0.8;
const DESKTOP_ASPECT = 1.5;

export default function create({ width, height, theme }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;

  const anchors = new Float32Array(ORBS.length * 2);
  const shapes = new Float32Array(ORBS.length * 4);
  ORBS.forEach(([u, v, radius, cyan, alpha], i) => {
    anchors.set([u, v], i * 2);
    shapes.set([radius, cyan, alpha, (i * 0.618034) % 1], i * 4);
  });

  const quad = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchors, 2));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 4));
  geometry.instanceCount = ORBS.length;

  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3() },
    uAspect: { value: 1 },
    uScale: { value: 1 },
    uFade: { value: 1 },
    uViolet: { value: new THREE.Color() },
    uCyan: { value: new THREE.Color() },
    uStrength: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      attribute vec2 aAnchor;
      attribute vec4 aShape;
      uniform float uTime;
      uniform vec3 uPointer;
      uniform float uAspect;
      uniform float uScale;
      uniform float uFade;
      uniform float uStrength;
      varying vec2 vQuad;
      varying float vCyan;
      varying float vAlpha;
      void main() {
        float radius = aShape.x;
        float seed = aShape.w;
        float phase = seed * 6.2832;
        // Smaller orbs read as nearer, so they travel and lean a little further.
        float near = 1.0 - min(radius / 0.9, 1.0);

        // Sines keep every orb bounded however long the page stays open.
        float reach = (0.1 + near * 0.12) * uScale;
        vec2 c = vec2(aAnchor.x * uAspect, aAnchor.y);
        c.x += reach * (sin(uTime * (0.11 + seed * 0.07) + phase) + 0.5 * sin(uTime * 0.043 + phase * 3.0));
        c.y += reach * (cos(uTime * (0.09 + seed * 0.06) + phase * 2.0) + 0.5 * cos(uTime * 0.037 + phase * 5.0));

        // Pushed away near the cursor, with no sudden change at any distance from it.
        vec2 away = c - uPointer.xy;
        c += away * exp(-dot(away, away) * 1.6) * uPointer.z * (0.35 + near * 0.4);
        c -= uPointer.xy * uPointer.z * (0.02 + near * 0.04);

        float breath = 1.0 + 0.06 * sin(uTime * 0.2 + phase * 4.0);
        vec2 world = c + position.xy * radius * uScale * breath;

        vQuad = position.xy;
        vCyan = aShape.y;
        vAlpha = aShape.z * uFade * uStrength * (0.85 + 0.15 * sin(uTime * 0.15 + phase * 7.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uViolet;
      uniform vec3 uCyan;
      varying vec2 vQuad;
      varying float vCyan;
      varying float vAlpha;
      void main() {
        float f = max(1.0 - dot(vQuad, vQuad), 0.0);
        float a = f * f * vAlpha;
        // A little fixed noise stops wide, faint gradients from showing bands.
        float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        a = max(a + (noise - 0.5) * min(a * 50.0, 1.0) / 255.0, 0.0);
        gl_FragColor = vec4(mix(uViolet, uCyan, vCyan), a);
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // the quads are only placed in the vertex shader
  scene.add(mesh);

  const setSize = (nextWidth, nextHeight) => {
    const aspect = nextWidth / nextHeight;
    camera.left = -aspect;
    camera.right = aspect;
    camera.updateProjectionMatrix();
    const desktop = THREE.MathUtils.smoothstep(aspect, PHONE_ASPECT, DESKTOP_ASPECT);
    uniforms.uAspect.value = aspect;
    uniforms.uScale.value = THREE.MathUtils.lerp(0.72, 1, desktop);
    uniforms.uFade.value = THREE.MathUtils.lerp(0.65, 1, desktop);
  };
  setSize(width, height);

  const setTheme = (next) => {
    const palette = PALETTES[next];
    uniforms.uViolet.value.set(palette.violet);
    uniforms.uCyan.value.set(palette.cyan);
    uniforms.uStrength.value = palette.strength;
    material.blending = palette.blending;
  };
  setTheme(theme);

  return {
    scene,
    camera,
    setTheme,
    update(t, { pointer }) {
      uniforms.uTime.value = t;
      uniforms.uPointer.value.set(pointer.x * uniforms.uAspect.value, pointer.y, pointer.active);
    },
    resize(nextWidth, nextHeight) {
      setSize(nextWidth, nextHeight);
    },
    dispose() {
      quad.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
