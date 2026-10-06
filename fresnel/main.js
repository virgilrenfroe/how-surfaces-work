import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const errEl = document.getElementById('err');
function showErr(msg) {
  console.error(msg);
  errEl.style.display = 'block';
  errEl.textContent = 'The 3D views could not start. Reload the page, or try another browser.';
}
window.addEventListener('error', (e) => showErr(e.message || e.error || e));
window.addEventListener('unhandledrejection', (e) => showErr(e.reason));

let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
try {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    reducedMotion = e.matches;
  });
} catch (_) {}

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
renderer.toneMappingExposure = 1.12;
renderer.setClearColor(0x05070c, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

/* —— Hero: dots only on the object + soft lens reveal (series v3) —— */
const HERO_RT_SIZE = 320;
function makeHeroPost(accentHex) {
  const accent = new THREE.Color(accentHex);
  const rt = new THREE.WebGLRenderTarget(HERO_RT_SIZE, HERO_RT_SIZE, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    tDiffuse: { value: rt.texture },
    uAccent: { value: new THREE.Vector3(accent.r, accent.g, accent.b) },
    uLens: { value: new THREE.Vector2(0.62, 0.48) },
    uLensR: { value: 0.2 },
    uCell: { value: 9.0 },
    uScreen: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(HERO_RT_SIZE, HERO_RT_SIZE) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec3 uAccent;
      uniform vec2 uLens;
      uniform float uLensR;
      uniform float uCell;
      uniform vec2 uScreen;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        vec2 pix = vUv * uScreen;
        vec2 cellId = floor(pix / uCell);
        vec2 cUv = (cellId + 0.5) * uCell / uScreen;
        vec4 cs = texture2D(tDiffuse, cUv);
        float cover = smoothstep(0.15, 0.6, cs.a);
        float lum = dot(cs.rgb / max(cs.a, 0.001), vec3(0.299, 0.587, 0.114));
        lum = clamp(pow(lum, 0.65) * 1.3 + 0.04, 0.0, 1.0);
        vec2 local = fract(pix / uCell) - 0.5;
        float rad = mix(0.08, 0.56, lum) * cover;
        float aa = 1.2 / uCell;
        float dotm = 1.0 - smoothstep(rad - aa, rad + aa, length(local));
        dotm *= step(0.001, rad);
        vec3 dotCol = uAccent * (0.5 + 0.8 * lum);

        vec4 src = texture2D(tDiffuse, vUv);
        float minDim = min(uScreen.x, uScreen.y);
        float dl = length((vUv - uLens) * uScreen) / (uLensR * minDim);
        float lens = 1.0 - smoothstep(0.55, 1.0, dl);
        float ring = smoothstep(0.86, 0.97, dl) * (1.0 - smoothstep(0.97, 1.08, dl));
        ring *= smoothstep(0.05, 0.5, src.a) * 0.55;

        vec3 pre = mix(dotCol * dotm, src.rgb, lens) + uAccent * ring;
        float a = clamp(mix(dotm, src.a, lens) + ring, 0.0, 1.0);
        if (a < 0.01) discard;
        gl_FragColor = vec4(pre / a, a);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  postScene.add(quad);
  return {
    rt, postScene, postCam, uniforms,
    lens: { x: 0.62, y: 0.48 },
    target: { x: 0.62, y: 0.48 },
    lastPointer: -1e9,
    dragging: false,
  };
}

const knotGeo = new THREE.TorusKnotGeometry(0.72, 0.24, 180, 32);
const sphereGeo = new THREE.SphereGeometry(0.62, 64, 48);
const planeGeo = new THREE.PlaneGeometry(6.5, 6.5, 1, 1);

const scenes = [];

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x0c1018);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.set(0, 0.55, opts.camZ ?? 3.4);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 8;
  controls.target.set(0, 0.05, 0);
  controls.update();
  scene.userData = { element, camera, controls, update: null, meshes: {} };
  scenes.push(scene);
  return scene;
}

function addKeyLight(scene, color = 0xe8f4ff, intensity = 2.4) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.4, 3.2, 1.6);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xd8e8ff, 0x1a2030, 0.75);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x6ec8ff, 1.15);
  rim.position.set(-2.4, 1.2, -1.8);
  scene.add(rim);
  return key;
}

function addFloor(scene, y = -1.05, color = 0x121820) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 48),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.35,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  scene.add(floor);
  return floor;
}

/* Checker / depth under water so grazing mirror is obvious */
function makePoolFloorTex() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a3048';
  ctx.fillRect(0, 0, size, size);
  const n = 8;
  const cell = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = '#2a5070';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      } else {
        ctx.fillStyle = '#143048';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  // soft depth vignette
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.65);
  g.addColorStop(0, 'rgba(40, 120, 160, 0.15)');
  g.addColorStop(1, 'rgba(4, 12, 24, 0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

const poolTex = makePoolFloorTex();

// —— Hero ——
const heroEl = document.querySelector('[data-scene="hero"]');
if (!heroEl) throw new Error('Missing hero view [data-scene=hero]');
const heroPost = makeHeroPost('#6ec8ff');
const heroScene = makeScene(heroEl, { bg: 0x05070c, camZ: 3.15 });
{
  heroScene.background = null;
  heroScene.environment = envMap;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xc8a060,
    metalness: 1,
    roughness: 0.18,
    envMapIntensity: 1.35,
  });
  const knot = new THREE.Mesh(knotGeo, mat);
  knot.scale.setScalar(1.55);
  heroScene.add(knot);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xd8ecff,
      metalness: 0,
      roughness: 0.05,
      transmission: 0.92,
      thickness: 0.55,
      ior: 1.5,
      envMapIntensity: 1.2,
      transparent: true,
    })
  );
  glass.position.set(1.15, -0.15, 0.35);
  heroScene.add(glass);
  const hemi = new THREE.HemisphereLight(0xd8e8ff, 0x1a2030, 0.55);
  heroScene.add(hemi);
  const key = new THREE.DirectionalLight(0xe8f4ff, 2.6);
  key.position.set(2.5, 2.2, 1.4);
  heroScene.add(key);
  const rim = new THREE.DirectionalLight(0x6ec8ff, 1.25);
  rim.position.set(-2.2, 0.6, -1.8);
  heroScene.add(rim);
  heroScene.userData.meshes = { knot, mat, key, glass };
  heroScene.userData.heroPost = heroPost;
  heroScene.userData.controls.enableZoom = false;
  heroScene.userData.controls.enableRotate = false;
  heroScene.userData.controls.enabled = false;
  knotGeo.computeBoundingSphere();
  const heroFitRadius = knotGeo.boundingSphere.radius * knot.scale.x;
  heroScene.userData.controls.maxDistance = 20;
  heroScene.userData.update = (t, dt) => {
    {
      const cam = heroScene.userData.camera;
      const R = heroFitRadius;
      const vf = (cam.fov * Math.PI) / 360;
      const hf = Math.atan(Math.tan(vf) * cam.aspect);
      const d = (R * 1.06) / Math.sin(Math.min(vf, hf));
      cam.position.set(0, 0.12, d);
      heroScene.userData.controls.target.set(0, 0, 0);
    }
    if (!reducedMotion) {
      knot.rotation.y += dt * 0.28;
      knot.rotation.x = Math.sin(t * 0.35) * 0.15;
      glass.rotation.y -= dt * 0.4;
      key.position.x = Math.cos(t * 0.4) * 2.6;
      key.position.z = Math.sin(t * 0.4) * 1.8;
    }
  };
}

// —— Specimen 01: Water plane + view angle ——
const waterScene = makeScene(document.querySelector('[data-scene="water"]'), { bg: 0x0a121c, camZ: 4.2 });
{
  waterScene.environment = envMap;
  waterScene.fog = new THREE.Fog(0x0a121c, 6, 18);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({
      map: poolTex,
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.3,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  waterScene.add(floor);

  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8dcec,
    metalness: 0,
    roughness: 0.02,
    transmission: 0.82,
    thickness: 0.28,
    ior: 1.333,
    transparent: true,
    opacity: 1,
    envMapIntensity: 2.4,
    specularIntensity: 1,
  });
  const water = new THREE.Mesh(planeGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  waterScene.add(water);

  // floating markers so reflections read clearly
  const buoyGeo = new THREE.SphereGeometry(0.18, 24, 16);
  const buoys = [];
  const buoyColors = [0xff6b4a, 0xffd166, 0x6ec8ff, 0x9ef0c8];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(
      buoyGeo,
      new THREE.MeshStandardMaterial({ color: buoyColors[i], roughness: 0.45, metalness: 0.1 })
    );
    const a = (i / 4) * Math.PI * 2;
    b.position.set(Math.cos(a) * 1.35, 0.18, Math.sin(a) * 1.35);
    waterScene.add(b);
    buoys.push(b);
  }

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x152838, side: THREE.BackSide })
  );
  waterScene.add(skyDome);
  // Bright horizon strip — makes grazing mirror obvious vs looking down
  const horizon = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 6),
    new THREE.MeshBasicMaterial({ color: 0xc8e8ff, side: THREE.DoubleSide })
  );
  horizon.position.set(0, 2.2, -12);
  waterScene.add(horizon);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff2d0, side: THREE.DoubleSide })
  );
  sunDisc.position.set(4.5, 3.2, -11.5);
  waterScene.add(sunDisc);

  const key = addKeyLight(waterScene, 0xe8f4ff, 2.8);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 2);
  waterScene.add(sun);

  waterScene.userData.meshes = { water, waterMat, key, buoys };
  waterScene.userData.controls.enableZoom = false;
  waterScene.userData.controls.enableRotate = false;
  waterScene.userData.controls.enabled = false;
  waterScene.userData.waterAngle = 0.35;
  waterScene.userData.update = (t, dt) => {
    const u = waterScene.userData.waterAngle; // 0 = look down, 1 = grazing
    const elev = THREE.MathUtils.lerp(1.55, 0.12, u);
    const dist = THREE.MathUtils.lerp(3.4, 5.2, u);
    const cam = waterScene.userData.camera;
    cam.position.set(0, elev, dist);
    cam.lookAt(0, 0.02, 0);
    waterScene.userData.controls.target.set(0, 0.02, 0);
    if (!reducedMotion) {
      for (let i = 0; i < buoys.length; i++) {
        buoys[i].position.y = 0.16 + Math.sin(t * 1.4 + i) * 0.04;
      }
    }
  };
}

// —— Specimen 02: Metal vs dielectric row ——
const metalsScene = makeScene(document.querySelector('[data-scene="metals"]'), { bg: 0x0e1218, camZ: 5.2 });
{
  metalsScene.environment = envMap;
  const specs = [
    { name: 'plastic', color: 0xc45a3a, metal: false, rough: 0.35 },
    { name: 'glass', color: 0xd8ecff, metal: false, rough: 0.05, glass: true },
    { name: 'gold', color: 0xd4a84b, metal: true, rough: 0.18 },
    { name: 'copper', color: 0xb87333, metal: true, rough: 0.22 },
    { name: 'aluminum', color: 0xc8d0d8, metal: true, rough: 0.28 },
  ];
  const mats = [];
  const meshes = [];
  const spacing = 1.25;
  const startX = -((specs.length - 1) * spacing) / 2;
  specs.forEach((s, i) => {
    let mat;
    if (s.glass) {
      mat = new THREE.MeshPhysicalMaterial({
        color: s.color,
        metalness: 0,
        roughness: s.rough,
        transmission: 0.9,
        thickness: 0.6,
        ior: 1.5,
        transparent: true,
        envMapIntensity: 1.3,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: s.color,
        metalness: s.metal ? 1 : 0,
        roughness: s.rough,
        envMapIntensity: s.metal ? 1.4 : 0.7,
      });
    }
    const m = new THREE.Mesh(sphereGeo, mat);
    m.position.set(startX + i * spacing, 0.15, 0);
    metalsScene.add(m);
    mats.push(mat);
    meshes.push(m);
    // keep original metal intent
    mat.userData.base = {
      color: s.color,
      metal: s.metal,
      rough: s.rough,
      glass: !!s.glass,
      name: s.name,
    };
  });
  addFloor(metalsScene, -0.55, 0x141a22);
  const key = addKeyLight(metalsScene, 0xe8f4ff, 2.6);
  metalsScene.userData.meshes = { mats, meshes, key, specs };
  metalsScene.userData.metalMode = 'metal';
  metalsScene.userData.controls.minDistance = 3;
  metalsScene.userData.controls.maxDistance = 9;
  metalsScene.userData.camera.position.set(0, 0.75, 4.6);
  metalsScene.userData.controls.target.set(0, 0.15, 0);
  metalsScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      for (const m of meshes) m.rotation.y += dt * 0.35;
    }
  };

  function applyMetalMode(mode) {
    metalsScene.userData.metalMode = mode;
    for (const mat of mats) {
      const b = mat.userData.base;
      if (b.glass) continue; // glass stays dielectric
      if (mode === 'metal') {
        mat.metalness = b.metal ? 1 : 0;
        mat.color.set(b.color);
        mat.envMapIntensity = b.metal ? 1.4 : 0.7;
        mat.roughness = b.rough;
      } else {
        // Force non-glass to dielectric: keep hue, kill mirror tint, raise roughness
        mat.metalness = 0;
        mat.color.set(b.color);
        mat.envMapIntensity = 0.35;
        mat.roughness = b.metal ? 0.72 : Math.max(0.35, b.rough);
      }
    }
  }
  metalsScene.userData.applyMetalMode = applyMetalMode;
}

// —— Specimen 03: F0 + Schlick ——
const f0Scene = makeScene(document.querySelector('[data-scene="f0"]'), { bg: 0x0c1018, camZ: 3.4 });
{
  f0Scene.environment = envMap;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8eef5,
    metalness: 0,
    roughness: 0.12,
    envMapIntensity: 1.15,
  });
  // Use metalness blend to approximate F0 lift: at F0~0.04 dielectric,
  // at high F0 push metalness + keep near-white (or slight warm) specular face.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 64, 48), mat);
  mesh.position.y = 0.2;
  f0Scene.add(mesh);
  addFloor(f0Scene, -0.85, 0x121820);
  const key = addKeyLight(f0Scene, 0xe8f4ff, 2.5);
  const graze = new THREE.DirectionalLight(0xffffff, 2.4);
  graze.position.set(-3.2, 0.4, 0.5);
  f0Scene.add(graze);
  f0Scene.userData.meshes = { mat, mesh, key, graze };
  f0Scene.userData.f0 = 0.04;
  f0Scene.userData.controls.enableZoom = false;
  f0Scene.userData.controls.enableRotate = false;
  f0Scene.userData.controls.enabled = false;
  f0Scene.userData.update = (t, dt) => {
    const cam = f0Scene.userData.camera;
    const ang = t * 0.25;
    if (!reducedMotion) {
      cam.position.set(Math.cos(ang) * 3.2, 0.85, Math.sin(ang) * 3.2);
      cam.lookAt(0, 0.2, 0);
      f0Scene.userData.controls.target.set(0, 0.2, 0);
      mesh.rotation.y += dt * 0.2;
    } else {
      cam.position.set(2.4, 0.9, 2.6);
      cam.lookAt(0, 0.2, 0);
    }
  };

  function applyF0(f0, rough) {
    f0Scene.userData.f0 = f0;
    mat.roughness = rough;
    // Map F0 to metalness: dielectrics ~0.02–0.08 stay metalness 0;
    // higher values ramp metalness so the face brightens (Schlick F0 feel).
    const m = THREE.MathUtils.clamp((f0 - 0.04) / 0.96, 0, 1);
    mat.metalness = m;
    // Keep albedo near white; slight warm tint as F0 rises toward gold-like
    const warm = THREE.MathUtils.clamp((f0 - 0.2) / 0.8, 0, 1);
    mat.color.setRGB(
      THREE.MathUtils.lerp(0.92, 0.85, warm),
      THREE.MathUtils.lerp(0.94, 0.72, warm),
      THREE.MathUtils.lerp(0.96, 0.35, warm)
    );
    mat.envMapIntensity = THREE.MathUtils.lerp(0.85, 1.55, m);
  }
  f0Scene.userData.applyF0 = applyF0;
}

// Hero lens pointer
{
  const el = heroEl;
  const post = heroPost;
  el.style.touchAction = 'pan-y';
  const setTarget = (e) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    post.target.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    post.target.y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    post.lastPointer = performance.now();
  };
  el.addEventListener('pointerdown', (e) => { post.dragging = true; setTarget(e); });
  el.addEventListener('pointermove', setTarget);
  el.addEventListener('pointerup', () => { post.dragging = false; });
  el.addEventListener('pointercancel', () => { post.dragging = false; });
  el.addEventListener('pointerleave', () => { post.dragging = false; post.lastPointer = performance.now() - 1200; });
}

// —— UI: Water ——
const waterMat = waterScene.userData.meshes.waterMat;
const waterAngleEl = document.getElementById('water-angle');
const waterRoughEl = document.getElementById('water-rough');
const waterAngleOut = document.getElementById('water-angle-out');
const waterRoughOut = document.getElementById('water-rough-out');

function syncWater() {
  waterScene.userData.waterAngle = Number(waterAngleEl.value);
  waterMat.roughness = Number(waterRoughEl.value);
  waterAngleOut.textContent = Number(waterAngleEl.value).toFixed(2);
  waterRoughOut.textContent = Number(waterRoughEl.value).toFixed(2);
}
function onWaterAngle() { syncWater(); }
function onWaterRough() { syncWater(); }
waterAngleEl.addEventListener('input', onWaterAngle);
waterAngleEl.addEventListener('change', onWaterAngle);
waterRoughEl.addEventListener('input', onWaterRough);
waterRoughEl.addEventListener('change', onWaterRough);
syncWater();

// —— UI: Metals ——
document.querySelectorAll('[data-metal-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.metalMode;
    metalsScene.userData.applyMetalMode(mode);
    document.querySelectorAll('[data-metal-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
  });
});

// —— UI: F0 + Schlick SVG ——
const f0AmtEl = document.getElementById('f0-amt');
const f0RoughEl = document.getElementById('f0-rough');
const f0AmtOut = document.getElementById('f0-amt-out');
const f0RoughOut = document.getElementById('f0-rough-out');
const schlickPath = document.getElementById('schlick-path');
const schlickDot = document.getElementById('schlick-dot');

function schlick(f0, cosTheta) {
  const x = 1 - cosTheta;
  return f0 + (1 - f0) * x * x * x * x * x;
}

function drawSchlick(f0) {
  if (!schlickPath) return;
  const x0 = 36;
  const y0 = 100;
  const w = 264;
  const h = 88;
  const pts = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 = head-on, 1 = grazing
    const cosTheta = Math.cos((t * Math.PI) / 2);
    const r = schlick(f0, cosTheta);
    const x = x0 + t * w;
    const y = y0 - r * h;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  schlickPath.setAttribute('d', pts.join(' '));
  // Dot at ~60° to show mid-curve lift
  const midT = 0.67;
  const midCos = Math.cos((midT * Math.PI) / 2);
  const midR = schlick(f0, midCos);
  schlickDot.setAttribute('cx', (x0 + midT * w).toFixed(2));
  schlickDot.setAttribute('cy', (y0 - midR * h).toFixed(2));
}

function syncF0() {
  const f0 = Number(f0AmtEl.value);
  const rough = Number(f0RoughEl.value);
  f0AmtOut.textContent = f0.toFixed(2);
  f0RoughOut.textContent = rough.toFixed(2);
  f0Scene.userData.applyF0(f0, rough);
  drawSchlick(f0);
}
f0AmtEl.addEventListener('input', syncF0);
f0AmtEl.addEventListener('change', syncF0);
f0RoughEl.addEventListener('input', syncF0);
f0RoughEl.addEventListener('change', syncF0);
syncF0();

// —— Render loop ——
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
window.addEventListener('resize', () => { updateSize(); });

let last = performance.now();
let frameCount = 0;

function animate(now) {
  if (!visible) return;
  frameCount += 1;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateSize();

  renderer.setScissorTest(false);
  renderer.setClearColor(0x05070c, 1);
  renderer.clear();
  renderer.setScissorTest(true);

  for (const scene of scenes) {
    const element = scene.userData.element;
    const rect = element.getBoundingClientRect();
    const canvasH = renderer.domElement.clientHeight;
    const canvasW = renderer.domElement.clientWidth;
    if (
      rect.bottom < 0 || rect.top > canvasH ||
      rect.right < 0 || rect.left > canvasW ||
      rect.width === 0 || rect.height === 0
    ) continue;

    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const left = rect.left;
    const bottom = canvasH - rect.bottom;
    const camera = scene.userData.camera;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (scene.userData.update) scene.userData.update(now * 0.001, dt);
    scene.userData.controls.update();

    renderer.setViewport(left, bottom, width, height);
    renderer.setScissor(left, bottom, width, height);

    const post = scene.userData.heroPost;
    if (post) {
      const tnow = now * 0.001;
      const idle = !post.dragging && performance.now() - post.lastPointer > 1800;
      if (idle && reducedMotion) { post.target.x = 0.62; post.target.y = 0.48; }
      else if (idle) {
        post.target.x = 0.5 + 0.24 * Math.sin(tnow * 0.33);
        post.target.y = 0.5 + 0.16 * Math.sin(tnow * 0.51 + 1.0);
      }
      const k = reducedMotion ? 1 : 0.12;
      post.lens.x += (post.target.x - post.lens.x) * k;
      post.lens.y += (post.target.y - post.lens.y) * k;
      const aspect = Math.max(0.5, width / height);
      const pr = renderer.getPixelRatio();
      const rtW = Math.round(Math.min(720, Math.max(240, width * pr * 0.5)));
      const rtH = Math.max(96, Math.round(rtW / aspect));
      if (post.rt.width !== rtW || post.rt.height !== rtH) {
        post.rt.setSize(rtW, rtH);
        post.uniforms.uRes.value.set(rtW, rtH);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, rtW, rtH);
      const prevTone = renderer.toneMappingExposure;
      renderer.setRenderTarget(post.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x05070c, 1);
      renderer.setScissorTest(true);
      renderer.setViewport(left, bottom, width, height);
      renderer.setScissor(left, bottom, width, height);
      post.uniforms.uLens.value.set(post.lens.x, post.lens.y);
      post.uniforms.uScreen.value.set(width * pr, height * pr);
      post.uniforms.uTime.value = tnow;
      post.uniforms.uCell.value = Math.max(6, Math.min(11, width / 105)) * pr;
      const prevTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = false;
      renderer.render(post.postScene, post.postCam);
      renderer.autoClear = true;
      renderer.toneMapping = prevTM;
      renderer.toneMappingExposure = prevTone;
    } else {
      renderer.render(scene, camera);
    }
  }
}

window.__HSW = {
  renderer, canvas, scenes,
  get frameCount() { return frameCount; },
  get reducedMotion() { return reducedMotion; },
  webglContexts: () => document.querySelectorAll('canvas').length,
  heroPost,
  waterScene,
  metalsScene,
  f0Scene,
};

updateSize();
renderer.setAnimationLoop(animate);
