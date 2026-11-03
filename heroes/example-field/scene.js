// A drifting field of soft points that lean away from the cursor.
import * as THREE from 'three';

export const config = { stillAt: 6 };

const COUNT = 700;
const PALETTES = {
  dark: ['#b58cff', '#5fd7ee'],
  light: ['#6d3bd8', '#0a84b0'],
};

export default function create({ width, height, pixelRatio, theme }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 50);
  camera.position.z = 10;

  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3() },
    uPixelRatio: { value: pixelRatio },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float seed;
      uniform float uTime;
      uniform vec3 uPointer;
      uniform float uPixelRatio;
      varying float vSeed;
      void main() {
        vSeed = seed;
        vec3 p = position;
        // Sines keep every point bounded however long the page stays open.
        p.x += sin(uTime * 0.13 + seed * 40.0) * 0.7;
        p.y += cos(uTime * 0.17 + seed * 25.0) * 0.5;
        vec2 away = p.xy - uPointer.xy;
        p.xy += normalize(away + 0.001) * exp(-dot(away, away) * 0.25) * uPointer.z * 0.9;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + seed * 5.0) * uPixelRatio * (10.0 / -view.z);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float glow = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(mix(uColorA, uColorB, vSeed), glow * 0.75);
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Points(geometry, material));

  const setTheme = (next) => {
    const [a, b] = PALETTES[next];
    uniforms.uColorA.value.set(a);
    uniforms.uColorB.value.set(b);
  };
  setTheme(theme);

  return {
    scene,
    camera,
    setTheme,
    update(t, { pointer }) {
      uniforms.uTime.value = t;
      const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      uniforms.uPointer.value.set(pointer.x * reach * camera.aspect, pointer.y * reach, pointer.active);
    },
    resize(nextWidth, nextHeight, nextPixelRatio) {
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      uniforms.uPixelRatio.value = nextPixelRatio;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
