// A dot-matrix ocean rolling across the lower right of the hero, rising gently around the cursor.
import * as THREE from 'three';

export const config = { stillAt: 6 };

const COLUMNS = 400;
const ROWS = 180;
const SPAN_X = 56;
const NEAR_Z = 8;
const FAR_Z = -18;

// Every speed in the shader is a whole multiple of 2*pi / LOOP_SECONDS, so time can wrap at
// LOOP_SECONDS with no visible jump and shader precision stays the same however long the page is open.
const LOOP_SECONDS = 1200;

const LOOKS = {
  dark: { colors: ['#ab7cff', '#3adaf2', '#ff5aab'], opacity: 0.95 },
  light: { colors: ['#7d3df3', '#008fbe', '#e21287'], opacity: 1 },
};

export default function create({ width, height, pixelRatio, theme }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 80);
  camera.position.set(0, 3.4, 11);
  camera.rotation.x = THREE.MathUtils.degToRad(-12);

  // Far rows come first so nearer dots blend over them without sorting.
  const positions = new Float32Array(COLUMNS * ROWS * 3);
  for (let row = 0, i = 0; row < ROWS; row++) {
    const z = FAR_Z + ((NEAR_Z - FAR_Z) * row) / (ROWS - 1);
    for (let column = 0; column < COLUMNS; column++, i += 3) {
      positions[i] = ((column / (COLUMNS - 1)) - 0.5) * SPAN_X;
      positions[i + 2] = z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3() },
    uPixelRatio: { value: pixelRatio },
    uAspect: { value: width / height },
    uFade: { value: new THREE.Vector4() },
    uOpacity: { value: 1 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uColorC: { value: new THREE.Color() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      #define OMEGA ${((2 * Math.PI) / LOOP_SECONDS).toFixed(8)}
      #define TAU 6.2831853
      uniform float uTime;
      uniform vec3 uPointer;
      uniform float uPixelRatio;
      uniform float uAspect;
      uniform vec4 uFade; // x from, x to, y from, y to, in clip space
      uniform float uOpacity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float t = uTime * OMEGA;

        // Long swells rolling left to right, with smaller chop riding on top.
        float swell = sin(p.x * 0.3 + p.z * 0.14 - t * 40.0);
        float roll = sin(p.x * 0.62 - p.z * 0.26 - t * 62.0);
        float chop = sin(p.x * 0.95 + p.z * 0.7 - t * 80.0) * sin(p.z * 0.85 - p.x * 0.3 + t * 38.0);
        float wave = swell * 0.68 + roll * 0.36 + chop * 0.14;
        p.y = wave;

        vec4 view = modelViewMatrix * vec4(p, 1.0);
        vec4 clip = projectionMatrix * view;
        vec2 ndc = clip.xy / clip.w;

        float mask = smoothstep(uFade.x, uFade.y, ndc.x) * smoothstep(uFade.z, uFade.w, ndc.y);
        mask *= smoothstep(${FAR_Z.toFixed(1)}, ${(FAR_Z + 11).toFixed(1)}, position.z);
        if (mask < 0.004) {
          // Off the visible wave: skip the fragments entirely.
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          vAlpha = 0.0;
          vColor = vec3(0.0);
          return;
        }

        // Rise around the cursor, with a soft ring moving outwards.
        vec2 toPointer = (ndc - uPointer.xy) * vec2(uAspect, 1.0);
        float r = length(toPointer);
        float near = exp(-r * r * 5.0) * uPointer.z;
        view.y += near * (0.75 + 0.25 * cos(r * 18.0 - t * 380.0));
        gl_Position = projectionMatrix * view;

        // Crests read as larger and brighter, which gives the surface its shape.
        float crest = clamp(wave * 0.38 + 0.5 + near * 0.35, 0.0, 1.0);
        float depth = 11.0 / -view.z;
        gl_PointSize = clamp((2.0 + crest * 1.6) * depth, 1.2, 5.0) * uPixelRatio;
        vAlpha = mask * uOpacity * (0.72 + 0.28 * crest);

        // Three colours spaced around a circle, blended by a slowly drifting phase.
        float phase = p.x * 0.11 + position.z * 0.16 + 1.2 * sin(position.z * 0.13 - p.x * 0.07 + t * 17.0) - t * 12.0;
        vec3 w = 0.5 + 0.5 * cos(phase - vec3(0.0, TAU / 3.0, 2.0 * TAU / 3.0));
        w *= w;
        vColor = (uColorA * w.x + uColorB * w.y + uColorC * w.z) / (w.x + w.y + w.z);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = vAlpha * smoothstep(0.5, 0.32, d);
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
  });

  const points = new THREE.Points(geometry, material);
  points.rotation.y = -0.28;
  points.frustumCulled = false;
  scene.add(points);

  // Wide heroes keep the wave right of the headline. On phones text fills the width, so the wave
  // settles into a quieter band along the bottom instead.
  const fit = (aspect) => {
    const narrow = THREE.MathUtils.smoothstep(aspect, 0.8, 1.3);
    uniforms.uAspect.value = aspect;
    uniforms.uFade.value.set(
      THREE.MathUtils.lerp(-1.6, -0.2, narrow),
      THREE.MathUtils.lerp(-0.3, 0.3, narrow),
      THREE.MathUtils.lerp(-0.1, 0.4, narrow),
      THREE.MathUtils.lerp(-0.6, 0.0, narrow),
    );
  };
  fit(width / height);

  const setTheme = (next) => {
    const { colors, opacity } = LOOKS[next];
    uniforms.uColorA.value.set(colors[0]);
    uniforms.uColorB.value.set(colors[1]);
    uniforms.uColorC.value.set(colors[2]);
    uniforms.uOpacity.value = opacity;
  };
  setTheme(theme);

  return {
    scene,
    camera,
    setTheme,
    update(t, { pointer }) {
      uniforms.uTime.value = t % LOOP_SECONDS;
      uniforms.uPointer.value.set(pointer.x, pointer.y, pointer.active);
    },
    resize(nextWidth, nextHeight, nextPixelRatio) {
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      uniforms.uPixelRatio.value = nextPixelRatio;
      fit(camera.aspect);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
