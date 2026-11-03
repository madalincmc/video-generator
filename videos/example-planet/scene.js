// 0-3s planet rises out of darkness, 3-6s moons sweep past as camera pushes in, 6-8s title resolves
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { ease, lerp, segment, textPlane } from 'kit';

export const config = { duration: 8, fps: 30, width: 1920, height: 1080, seed: 7 };

function buildPlanet() {
  const noise = new SimplexNoise();
  const geometry = new THREE.IcosahedronGeometry(2, 24).toNonIndexed();
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  const palette = {
    deep: new THREE.Color('#123a6b'),
    shallow: new THREE.Color('#1f8a9e'),
    sand: new THREE.Color('#e3b778'),
    land: new THREE.Color('#d9663b'),
    peak: new THREE.Color('#fff1dc'),
  };

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    const n = noise.noise3d(v.x * 1.4, v.y * 1.4, v.z * 1.4) + 0.5 * noise.noise3d(v.x * 3.1, v.y * 3.1, v.z * 3.1);
    const elevation = Math.max(n, 0);
    v.multiplyScalar(2 + elevation * 0.28);
    position.setXYZ(i, v.x, v.y, v.z);
  }

  // Color per triangle from its average height, for a faceted low-poly look.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const height = (a.length() + b.length() + c.length()) / 3 - 2;
    let color;
    if (height <= 0.001) {
      const depth = noise.noise3d(a.x * 0.7, a.y * 0.7, a.z * 0.7);
      color = depth > -0.25 ? palette.shallow : palette.deep;
    }
    else if (height < 0.05) color = palette.sand;
    else if (height < 0.24) color = palette.land;
    else color = palette.peak;
    for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }));
}

function buildStars() {
  const count = 3000;
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(40 + Math.random() * 40).toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#cfe0ff', size: 0.14, transparent: true }));
}

export default async function create({ renderer, width, height }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05060f');
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);

  const planet = buildPlanet();
  scene.add(planet);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.42, 64, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { strength: { value: 0 } },
      vertexShader: `varying vec3 vNormal;
        void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float strength; varying vec3 vNormal;
        void main() { float rim = pow(clamp(0.72 + vNormal.z, 0.0, 1.0), 3.0); gl_FragColor = vec4(vec3(1.0, 0.55, 0.3) * rim * strength, rim); }`,
    }),
  );
  scene.add(atmosphere);

  const stars = buildStars();
  scene.add(stars);

  const moons = [
    { radius: 3.4, size: 0.2, speed: 0.9, phase: 0.5, tilt: 0.35, color: '#ffd9a0' },
    { radius: 4.3, size: 0.13, speed: -0.65, phase: 2.4, tilt: -0.5, color: '#9fd8ff' },
    { radius: 5.1, size: 0.09, speed: 0.5, phase: 4.4, tilt: 0.15, color: '#ff9f80' },
  ].map((spec) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(spec.size, 1),
      new THREE.MeshStandardMaterial({ color: spec.color, flatShading: true, emissive: spec.color, emissiveIntensity: 0.5 }),
    );
    const pivot = new THREE.Group();
    pivot.rotation.x = spec.tilt;
    pivot.add(mesh);
    scene.add(pivot);
    return { ...spec, mesh };
  });

  const sun = new THREE.DirectionalLight('#fff0d8', 0);
  sun.position.set(-6, 3, 5);
  scene.add(sun);
  const fill = new THREE.HemisphereLight('#4a6bd6', '#1a0c20', 0);
  scene.add(fill);

  const title = textPlane('NEW WORLDS', { height: 0.62, color: '#fff4e4', weight: 300 });
  title.material.opacity = 0;
  scene.add(title);

  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.45, 0.6, 0.82));
  composer.addPass(new OutputPass());

  return {
    scene,
    camera,
    update(t) {
      const reveal = segment(t, 0, 3, ease.outCubic);
      const push = segment(t, 0, 8, ease.inOutQuad);
      const titleIn = segment(t, 5.8, 7.2, ease.outCubic);

      sun.intensity = lerp(0, 3.4, reveal);
      fill.intensity = lerp(0, 0.5, reveal);
      atmosphere.material.uniforms.strength.value = reveal;
      stars.material.opacity = reveal;

      planet.rotation.y = t * 0.16;
      planet.position.y = lerp(-1.6, titleIn * 0.7, reveal);
      atmosphere.position.copy(planet.position);

      for (const moon of moons) {
        const angle = moon.phase + t * moon.speed;
        moon.mesh.position.set(Math.cos(angle) * moon.radius, 0, Math.sin(angle) * moon.radius);
        moon.mesh.parent.position.copy(planet.position);
        moon.mesh.rotation.y = t;
      }

      const orbit = lerp(-0.45, 0.2, push);
      const distance = lerp(13, 9.2, push);
      camera.position.set(Math.sin(orbit) * distance, lerp(1.4, 0.3, push), Math.cos(orbit) * distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      // Pinned in view space so the title stays square-on while the camera orbits.
      title.material.opacity = titleIn;
      title.position.copy(camera.localToWorld(new THREE.Vector3(0, -1.3 - (1 - titleIn) * 0.15, -5)));
      title.quaternion.copy(camera.quaternion);
    },
    render() {
      composer.render();
    },
  };
}
