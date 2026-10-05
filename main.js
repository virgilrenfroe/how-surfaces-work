import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const errEl = document.getElementById('err');
function showErr(msg) {
  errEl.style.display = 'block';
  errEl.textContent = String(msg);
}
window.addEventListener('error', (e) => showErr(e.message || e.error || e));
window.addEventListener('unhandledrejection', (e) => showErr(e.reason));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.innerWidth < 700;
const pixelCap = () => {
  const dpr = window.devicePixelRatio || 1;
  if (isNarrow()) return Math.min(dpr, 1.5);
  return Math.min(dpr, 2);
};

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(pixelCap());
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x0c0a08, 1);
renderer.domElement.style.pointerEvents = 'none';

// Shared env from RoomEnvironment (no external HDR)
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

// Shared geometries for fair comparison
const knotGeo = new THREE.TorusKnotGeometry(0.72, 0.24, 180, 32);
const sphereGeo = new THREE.SphereGeometry(0.55, 48, 32);

/** Procedural MatCap textures drawn on canvas */
function makeMatcapTexture(kind) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.38, size * 0.32, size * 0.05, size * 0.5, size * 0.55, size * 0.55);

  if (kind === 'chrome') {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, '#dfe8f5');
    g.addColorStop(0.42, '#6a7588');
    g.addColorStop(0.62, '#1a1e28');
    g.addColorStop(0.78, '#9aa8bc');
    g.addColorStop(1, '#0a0c12');
  } else if (kind === 'satin') {
    g.addColorStop(0, '#f2f0ea');
    g.addColorStop(0.25, '#c8c2b6');
    g.addColorStop(0.55, '#7a756c');
    g.addColorStop(0.8, '#3a3834');
    g.addColorStop(1, '#1c1b19');
  } else {
    // clay
    g.addColorStop(0, '#f0c9a8');
    g.addColorStop(0.35, '#c47a52');
    g.addColorStop(0.7, '#7a3f28');
    g.addColorStop(1, '#2a1810');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // soft rim vignette
  const rim = ctx.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size * 0.5);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  if (kind === 'chrome') {
    // specular streak
    ctx.globalCompositeOperation = 'screen';
    const streak = ctx.createLinearGradient(0, size * 0.2, size, size * 0.55);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    streak.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const matcaps = {
  chrome: makeMatcapTexture('chrome'),
  satin: makeMatcapTexture('satin'),
  clay: makeMatcapTexture('clay'),
};

const scenes = [];

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x14110e);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0.55, opts.camZ ?? 3.4);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 6;
  controls.target.set(0, 0.05, 0);
  controls.update();

  scene.userData = {
    element,
    camera,
    controls,
    update: null,
    meshes: {},
  };
  scenes.push(scene);
  return scene;
}

function addFloor(scene, y = -1.05) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({
      color: 0x1a1714,
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.35,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = false;
  scene.add(floor);
  return floor;
}

function addKeyLight(scene, color = 0xffe6d0, intensity = 2.4) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.4, 3.2, 1.6);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xb8d4ff, 0x2a1a10, 0.55);
  scene.add(fill);
  return key;
}

// —— Specimens ——
const matcapScene = makeScene(document.querySelector('[data-scene="matcap"]'), { bg: 0x12100e });
{
  const mat = new THREE.MeshMatcapMaterial({ matcap: matcaps.chrome });
  const knot = new THREE.Mesh(knotGeo, mat);
  const sphere = new THREE.Mesh(sphereGeo, mat);
  sphere.position.set(1.45, -0.15, 0.2);
  knot.position.set(-0.35, 0.1, 0);
  matcapScene.add(knot, sphere);
  matcapScene.userData.meshes = { knot, sphere, mat };
  addFloor(matcapScene);
  // MatCap ignores lights; add a dim helper so floor isn't flat black only
  addKeyLight(matcapScene, 0xffffff, 0.35);
  matcapScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      knot.rotation.y += dt * 0.25;
      sphere.rotation.y -= dt * 0.2;
    }
  };
}

const pbrScene = makeScene(document.querySelector('[data-scene="pbr"]'), { bg: 0x100e0c });
{
  pbrScene.environment = envMap;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8dee8,
    metalness: 1,
    roughness: 0.05,
    envMapIntensity: 1.15,
  });
  const knot = new THREE.Mesh(knotGeo, mat);
  const sphere = new THREE.Mesh(sphereGeo, mat);
  sphere.position.set(1.45, -0.15, 0.2);
  knot.position.set(-0.35, 0.1, 0);
  pbrScene.add(knot, sphere);
  addFloor(pbrScene);
  const key = addKeyLight(pbrScene);
  pbrScene.userData.meshes = { knot, sphere, mat, key };
  pbrScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      knot.rotation.y += dt * 0.22;
      sphere.rotation.y -= dt * 0.18;
      key.position.x = Math.cos(t * 0.35) * 2.6;
      key.position.z = Math.sin(t * 0.35) * 2.0;
    }
  };
}

const physicalScene = makeScene(document.querySelector('[data-scene="physical"]'), { bg: 0x0e0d12, camZ: 3.8 });
{
  physicalScene.environment = envMap;
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0xc4182a,
    metalness: 0.15,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.0,
  });
  const brushMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8c0cc,
    metalness: 1,
    roughness: 0.32,
    anisotropy: 0.85,
    anisotropyRotation: 0.35,
    envMapIntensity: 1.1,
  });
  const paintKnot = new THREE.Mesh(knotGeo, paintMat);
  paintKnot.position.set(-0.95, 0.15, 0);
  paintKnot.scale.setScalar(0.92);
  const brushKnot = new THREE.Mesh(knotGeo, brushMat);
  brushKnot.position.set(0.95, 0.15, 0);
  brushKnot.scale.setScalar(0.92);
  const paintSphere = new THREE.Mesh(sphereGeo, paintMat);
  paintSphere.position.set(-0.95, -1.0, 0.15);
  paintSphere.scale.setScalar(0.55);
  const brushSphere = new THREE.Mesh(sphereGeo, brushMat);
  brushSphere.position.set(0.95, -1.0, 0.15);
  brushSphere.scale.setScalar(0.55);
  physicalScene.add(paintKnot, brushKnot, paintSphere, brushSphere);
  addFloor(physicalScene, -1.35);
  const key = addKeyLight(physicalScene, 0xfff0e0, 2.2);
  physicalScene.userData.meshes = { paintMat, brushMat, paintKnot, brushKnot, key };
  physicalScene.userData.focus = 'paint';
  physicalScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      paintKnot.rotation.y += dt * 0.28;
      brushKnot.rotation.y -= dt * 0.24;
      key.position.x = Math.cos(t * 0.4) * 2.5;
      key.position.z = Math.sin(t * 0.4) * 1.8;
    }
  };
}

// Centerpiece: MatCap vs PBR with shared orbiting light marker
const cmpMatcapScene = makeScene(document.querySelector('[data-scene="compare-matcap"]'), { bg: 0x15120f, camZ: 3.1 });
{
  const mat = new THREE.MeshMatcapMaterial({ matcap: matcaps.chrome });
  const knot = new THREE.Mesh(knotGeo, mat);
  cmpMatcapScene.add(knot);
  addFloor(cmpMatcapScene);
  addKeyLight(cmpMatcapScene, 0xffffff, 0.25);
  // Visible “light” proxy that moves — MatCap won't respond
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc66 })
  );
  cmpMatcapScene.add(bulb);
  cmpMatcapScene.userData.meshes = { knot, bulb, mat };
  cmpMatcapScene.userData.update = (t, dt, shared) => {
    if (!reducedMotion) knot.rotation.y += dt * 0.2;
    const ang = shared.lightAngle;
    bulb.position.set(Math.cos(ang) * 2.1, 1.4 + Math.sin(ang * 0.5) * 0.25, Math.sin(ang) * 2.1);
  };
}

const cmpPbrScene = makeScene(document.querySelector('[data-scene="compare-pbr"]'), { bg: 0x15120f, camZ: 3.1 });
{
  cmpPbrScene.environment = envMap;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8dee8,
    metalness: 1,
    roughness: 0.08,
    envMapIntensity: 1.2,
  });
  const knot = new THREE.Mesh(knotGeo, mat);
  cmpPbrScene.add(knot);
  addFloor(cmpPbrScene);
  const key = addKeyLight(cmpPbrScene, 0xffe0b0, 3.0);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc66 })
  );
  cmpPbrScene.add(bulb);
  cmpPbrScene.userData.meshes = { knot, mat, key, bulb };
  cmpPbrScene.userData.update = (t, dt, shared) => {
    if (!reducedMotion) knot.rotation.y += dt * 0.2;
    const ang = shared.lightAngle;
    const x = Math.cos(ang) * 2.1;
    const z = Math.sin(ang) * 2.1;
    const y = 1.4 + Math.sin(ang * 0.5) * 0.25;
    bulb.position.set(x, y, z);
    key.position.set(x, y, z);
  };
}

// —— UI wiring ——
document.querySelectorAll('[data-matcap]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.matcap;
    matcapScene.userData.meshes.mat.matcap = matcaps[kind];
    matcapScene.userData.meshes.mat.needsUpdate = true;
    document.querySelectorAll('[data-matcap]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

const pbrMat = pbrScene.userData.meshes.mat;
const roughEl = document.getElementById('pbr-rough');
const metalEl = document.getElementById('pbr-metal');
const roughOut = document.getElementById('pbr-rough-out');
const metalOut = document.getElementById('pbr-metal-out');

function syncPbrOutputs() {
  roughOut.textContent = Number(pbrMat.roughness).toFixed(2);
  metalOut.textContent = Number(pbrMat.metalness).toFixed(2);
  roughEl.value = pbrMat.roughness;
  metalEl.value = pbrMat.metalness;
}
roughEl.addEventListener('input', () => {
  pbrMat.roughness = Number(roughEl.value);
  syncPbrOutputs();
});
metalEl.addEventListener('input', () => {
  pbrMat.metalness = Number(metalEl.value);
  syncPbrOutputs();
});

document.querySelectorAll('[data-pbr]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.pbr;
    if (preset === 'chrome') {
      pbrMat.color.set(0xd8dee8);
      pbrMat.metalness = 1;
      pbrMat.roughness = 0.05;
    } else if (preset === 'satin') {
      pbrMat.color.set(0xc5c0b5);
      pbrMat.metalness = 1;
      pbrMat.roughness = 0.4;
    } else {
      pbrMat.color.set(0x3a7cff);
      pbrMat.metalness = 0;
      pbrMat.roughness = 0.28;
    }
    syncPbrOutputs();
    document.querySelectorAll('[data-pbr]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

const coatEl = document.getElementById('phys-coat');
const anisoEl = document.getElementById('phys-aniso');
const coatOut = document.getElementById('phys-coat-out');
const anisoOut = document.getElementById('phys-aniso-out');
const { paintMat, brushMat } = physicalScene.userData.meshes;

coatEl.addEventListener('input', () => {
  paintMat.clearcoat = Number(coatEl.value);
  coatOut.textContent = Number(coatEl.value).toFixed(2);
});
anisoEl.addEventListener('input', () => {
  brushMat.anisotropy = Number(anisoEl.value);
  anisoOut.textContent = Number(anisoEl.value).toFixed(2);
});

document.querySelectorAll('[data-phys]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const focus = btn.dataset.phys;
    physicalScene.userData.focus = focus;
    const { paintKnot, brushKnot } = physicalScene.userData.meshes;
    if (focus === 'paint') {
      paintKnot.scale.setScalar(1.05);
      brushKnot.scale.setScalar(0.78);
      physicalScene.userData.controls.target.set(-0.6, 0.1, 0);
    } else {
      brushKnot.scale.setScalar(1.05);
      paintKnot.scale.setScalar(0.78);
      physicalScene.userData.controls.target.set(0.6, 0.1, 0);
    }
    physicalScene.userData.controls.update();
    document.querySelectorAll('[data-phys]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

let orbitLight = true;
const orbitEl = document.getElementById('cmp-orbit');
const orbitOut = document.getElementById('cmp-orbit-out');
orbitEl.addEventListener('input', () => {
  orbitLight = Number(orbitEl.value) === 1;
  orbitOut.textContent = orbitLight ? 'ON' : 'OFF';
});

// —— Render loop (single context, scissor per element) ——
let visible = !document.hidden;
document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  if (visible) {
    last = performance.now();
    renderer.setAnimationLoop(animate);
  } else {
    renderer.setAnimationLoop(null);
  }
});

function updateSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = pixelCap();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
  }
}

window.addEventListener('resize', () => {
  updateSize();
});

const shared = { lightAngle: 0 };
let last = performance.now();

function animate(now) {
  if (!visible) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  updateSize();
  // fixed canvas: no scrollY transform (rects are viewport-relative)

  if (orbitLight && !reducedMotion) {
    shared.lightAngle += dt * 0.85;
  }

  renderer.setScissorTest(false);
  renderer.setClearColor(0x0c0a08, 1);
  renderer.clear();
  renderer.setScissorTest(true);

  for (const scene of scenes) {
    const element = scene.userData.element;
    const rect = element.getBoundingClientRect();
    const canvasH = renderer.domElement.clientHeight;
    const canvasW = renderer.domElement.clientWidth;

    if (
      rect.bottom < 0 ||
      rect.top > canvasH ||
      rect.right < 0 ||
      rect.left > canvasW ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      continue;
    }

    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const left = rect.left;
    const bottom = canvasH - rect.bottom;

    const camera = scene.userData.camera;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (scene.userData.update) scene.userData.update(now * 0.001, dt, shared);
    scene.userData.controls.update();

    renderer.setViewport(left, bottom, width, height);
    renderer.setScissor(left, bottom, width, height);
    renderer.render(scene, camera);
  }
}

updateSize();
renderer.setAnimationLoop(animate);

// Expose for verification scripts
window.__HSW = {
  renderer,
  canvas,
  scenes,
  webglContexts: () => document.querySelectorAll('canvas').length,
};
