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
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x040a0c, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

/* —— Hero v3: dots on alpha + soft lens —— */
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

function makeCheckerTex(size = 512, cells = 10) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2fbff' : '#1a3a48';
      ctx.fillRect(x * cell, y * cell, cell + 1, cell + 1);
    }
  }
  // typed-grid letters for warp readability
  ctx.fillStyle = '#0a2030';
  ctx.font = `bold ${Math.floor(cell * 0.45)}px JetBrains Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyphs = 'ABCDEFGHJKLMNP';
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = '#0a3040';
        ctx.fillText(glyphs[(x + y * 3) % glyphs.length], (x + 0.5) * cell, (y + 0.55) * cell);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const gridTex = makeCheckerTex();
const knotGeo = new THREE.TorusKnotGeometry(0.72, 0.24, 180, 32);
const scenes = [];

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x0a1214);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.set(0, 0.4, opts.camZ ?? 3.4);
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

function addKeyLight(scene, color = 0xe8fffb, intensity = 2.4) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.4, 3.2, 1.6);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xd8fff8, 0x102028, 0.75);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x2ee6d6, 1.1);
  rim.position.set(-2.4, 1.2, -1.8);
  scene.add(rim);
  return key;
}

function glassMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xffffff,
    metalness: 0,
    roughness: opts.roughness ?? 0.05,
    transmission: opts.transmission ?? 1,
    thickness: opts.thickness ?? 1.0,
    ior: opts.ior ?? 1.5,
    transparent: true,
    opacity: 1,
    envMapIntensity: opts.envMapIntensity ?? 1.0,
    specularIntensity: 1,
    clearcoat: opts.clearcoat ?? 0.35,
    clearcoatRoughness: 0.1,
    attenuationColor: opts.attenuationColor ?? new THREE.Color(0xc8fff8),
    attenuationDistance: opts.attenuationDistance ?? 2.5,
    dispersion: opts.dispersion ?? 0,
  });
}

function makeGemGeo() {
  // Faceted octahedron-ish gem
  const geo = new THREE.OctahedronGeometry(0.85, 0);
  geo.scale(1, 1.15, 1);
  return geo;
}

function makePrismGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.1, -0.65);
  shape.lineTo(1.1, -0.65);
  shape.lineTo(0, 0.95);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false });
  geo.translate(0, 0, -0.7);
  geo.computeVertexNormals();
  return geo;
}

function makeLensGeo(bulge = 0.35) {
  // Flattened sphere → thicker equator = more magnification path
  const geo = new THREE.SphereGeometry(1.05, 64, 48);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.z *= bulge;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// —— Hero ——
const heroEl = document.querySelector('[data-scene="hero"]');
if (!heroEl) throw new Error('Missing hero view');
const heroPost = makeHeroPost('#2ee6d6');
const heroScene = makeScene(heroEl, { bg: 0x040a0c, camZ: 3.15 });
{
  heroScene.background = null;
  heroScene.environment = envMap;
  const mat = glassMat({ ior: 1.5, thickness: 1.4, roughness: 0.04, color: 0xd8fffa });
  const knot = new THREE.Mesh(knotGeo, mat);
  knot.scale.setScalar(1.55);
  heroScene.add(knot);
  const hemi = new THREE.HemisphereLight(0xd8fff8, 0x102028, 0.55);
  heroScene.add(hemi);
  const key = new THREE.DirectionalLight(0xe8fffb, 2.5);
  key.position.set(2.5, 2.2, 1.4);
  heroScene.add(key);
  const rim = new THREE.DirectionalLight(0x2ee6d6, 1.2);
  rim.position.set(-2.2, 0.6, -1.8);
  heroScene.add(rim);
  heroScene.userData.meshes = { knot, mat, key };
  heroScene.userData.heroPost = heroPost;
  heroScene.userData.controls.enableZoom = false;
  heroScene.userData.controls.enableRotate = false;
  heroScene.userData.controls.enabled = false;
  knotGeo.computeBoundingSphere();
  const heroFitRadius = knotGeo.boundingSphere.radius * knot.scale.x;
  heroScene.userData.update = (t, dt) => {
    const cam = heroScene.userData.camera;
    const R = heroFitRadius;
    const vf = (cam.fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * cam.aspect);
    const d = (R * 1.06) / Math.sin(Math.min(vf, hf));
    cam.position.set(0, 0.12, d);
    heroScene.userData.controls.target.set(0, 0, 0);
    if (!reducedMotion) {
      knot.rotation.y += dt * 0.28;
      knot.rotation.x = Math.sin(t * 0.35) * 0.15;
      key.position.x = Math.cos(t * 0.4) * 2.6;
      key.position.z = Math.sin(t * 0.4) * 1.8;
    }
  };
}

function addGridBackdrop(scene, z = -2.2, scale = 6.5) {
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(scale, scale),
    new THREE.MeshStandardMaterial({
      map: gridTex,
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.2,
    })
  );
  grid.position.z = z;
  scene.add(grid);
  return grid;
}

// —— Specimen 01: IOR sphere over grid ——
const iorScene = makeScene(document.querySelector('[data-scene="ior"]'), { bg: 0x0a1418, camZ: 3.6 });
{
  iorScene.environment = envMap;
  const grid = addGridBackdrop(iorScene, -1.85, 7.2);
  const mat = glassMat({ ior: 1.5, thickness: 1.6, roughness: 0.04 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.95, 64, 48), mat);
  sphere.position.set(0, 0.05, 0.35);
  iorScene.add(sphere);
  // thin slab too for extra warp cue
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.6, 0.22),
    glassMat({ ior: 1.5, thickness: 0.55, roughness: 0.06, color: 0xe8fffc })
  );
  slab.position.set(0, 0.05, -0.55);
  iorScene.add(slab);
  addKeyLight(iorScene);
  const backLight = new THREE.DirectionalLight(0xffffff, 1.4);
  backLight.position.set(0, 1.5, -3);
  iorScene.add(backLight);
  iorScene.userData.meshes = { mat, slabMat: slab.material, sphere, slab, grid };
  iorScene.userData.controls.enableZoom = false;
  iorScene.userData.controls.enableRotate = false;
  iorScene.userData.controls.enabled = false;
  iorScene.userData.camera.position.set(0, 0.35, 3.5);
  iorScene.userData.controls.target.set(0, 0.05, 0);
  iorScene.userData.applyIor = (n) => {
    mat.ior = n;
    slab.material.ior = n;
    // Near air: almost no bend — drop thickness feel slightly
    mat.thickness = THREE.MathUtils.lerp(0.4, 2.0, THREE.MathUtils.clamp((n - 1) / 1.4, 0, 1));
    slab.material.thickness = THREE.MathUtils.lerp(0.15, 0.8, THREE.MathUtils.clamp((n - 1) / 1.4, 0, 1));
  };
  iorScene.userData.update = (t, dt) => {
    if (!reducedMotion) sphere.rotation.y += dt * 0.15;
  };
}

// —— Specimen 02: Lens thickness ——
const lensScene = makeScene(document.querySelector('[data-scene="lens"]'), { bg: 0x0a1418, camZ: 3.4 });
{
  lensScene.environment = envMap;
  const grid = addGridBackdrop(lensScene, -2.0, 7);
  const mat = glassMat({ ior: 1.5, thickness: 0.8, roughness: 0.04 });
  let lensMesh = new THREE.Mesh(makeLensGeo(1.0), mat);
  lensMesh.position.set(0, 0.05, 0.2);
  lensScene.add(lensMesh);
  addKeyLight(lensScene);
  lensScene.userData.meshes = { mat, lensMesh, grid };
  lensScene.userData.controls.enableZoom = false;
  lensScene.userData.controls.enableRotate = false;
  lensScene.userData.controls.enabled = false;
  lensScene.userData.camera.position.set(0, 0.25, 3.3);
  lensScene.userData.applyLens = (thick, ior) => {
    mat.thickness = thick;
    mat.ior = ior;
    // Thicker path + stronger Z bulge → more magnification of the grid
    const bulge = THREE.MathUtils.lerp(0.22, 0.95, THREE.MathUtils.clamp((thick - 0.15) / 2.25, 0, 1));
    lensMesh.scale.set(1, 1, bulge);
  };
  lensScene.userData.update = () => {};
}

// —— Specimen 03: Prism + dispersion ——
const prismScene = makeScene(document.querySelector('[data-scene="prism"]'), { bg: 0x0a1216, camZ: 3.8 });
{
  prismScene.environment = envMap;
  const grid = addGridBackdrop(prismScene, -2.4, 8);
  grid.position.y = 0.2;
  const mat = glassMat({
    ior: 1.55,
    thickness: 1.8,
    roughness: 0.03,
    dispersion: 0,
    color: 0xffffff,
    attenuationColor: new THREE.Color(0xe8fff8),
  });
  const prism = new THREE.Mesh(makePrismGeo(), mat);
  prism.rotation.y = -0.35;
  prism.rotation.x = 0.12;
  prism.position.set(0, 0.15, 0.1);
  prismScene.add(prism);
  // Soft white “beam” cue behind prism
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 4.5),
    new THREE.MeshBasicMaterial({ color: 0xfff8e8, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  beam.position.set(-2.2, 0.4, -0.2);
  beam.rotation.z = -0.4;
  prismScene.add(beam);
  addKeyLight(prismScene, 0xfff5e8, 2.6);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3, 2, 1);
  prismScene.add(sun);
  prismScene.userData.meshes = { mat, prism, beam, grid };
  prismScene.userData.controls.minDistance = 2.2;
  prismScene.userData.controls.maxDistance = 7;
  prismScene.userData.camera.position.set(1.6, 0.9, 3.6);
  prismScene.userData.controls.target.set(0, 0.15, 0);
  prismScene.userData.applyDisp = (on) => {
    // Three.js MeshPhysicalMaterial.dispersion — subtle chromatic fringe
    mat.dispersion = on ? 0.55 : 0;
  };
  prismScene.userData.applyIor = (n) => { mat.ior = n; };
  prismScene.userData.update = (t, dt) => {
    if (!reducedMotion) prism.rotation.y = -0.35 + Math.sin(t * 0.25) * 0.08;
  };
}

// —— Specimen 04: Gem TIR glass vs diamond ——
const gemScene = makeScene(document.querySelector('[data-scene="gem"]'), { bg: 0x080e12, camZ: 3.2 });
{
  gemScene.environment = envMap;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x121a20, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.5 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.95;
  gemScene.add(floor);
  const mat = glassMat({
    ior: 2.4,
    thickness: 2.2,
    roughness: 0.02,
    transmission: 1,
    clearcoat: 0.8,
    attenuationColor: new THREE.Color(0xe8f4ff),
    attenuationDistance: 1.2,
    envMapIntensity: 1.35,
  });
  const gem = new THREE.Mesh(makeGemGeo(), mat);
  gem.position.y = 0.1;
  gemScene.add(gem);
  // Colored cards so internal bounce reads
  const cardA = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.8),
    new THREE.MeshBasicMaterial({ color: 0xff8060, side: THREE.DoubleSide })
  );
  cardA.position.set(-2.4, 0.9, 0.3);
  cardA.rotation.y = Math.PI / 2.5;
  gemScene.add(cardA);
  const cardB = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.8),
    new THREE.MeshBasicMaterial({ color: 0x60d0ff, side: THREE.DoubleSide })
  );
  cardB.position.set(2.4, 0.9, 0.3);
  cardB.rotation.y = -Math.PI / 2.5;
  gemScene.add(cardB);
  addKeyLight(gemScene, 0xfff8f0, 2.8);
  const spot = new THREE.SpotLight(0xffffff, 40, 12, 0.35, 0.4);
  spot.position.set(0, 4.5, 2);
  spot.target.position.set(0, 0, 0);
  gemScene.add(spot, spot.target);
  gemScene.userData.meshes = { mat, gem };
  gemScene.userData.applyGem = (kind) => {
    if (kind === 'diamond') {
      mat.ior = 2.4;
      mat.thickness = 2.4;
      mat.envMapIntensity = 1.45;
      mat.attenuationDistance = 1.0;
      mat.clearcoat = 1;
    } else {
      mat.ior = 1.5;
      mat.thickness = 1.2;
      mat.envMapIntensity = 0.85;
      mat.attenuationDistance = 3.0;
      mat.clearcoat = 0.3;
    }
  };
  gemScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      gem.rotation.y += dt * 0.45;
      gem.rotation.x = Math.sin(t * 0.4) * 0.15;
    }
  };
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

function nameForIor(n) {
  if (Math.abs(n - 1) < 0.03) return 'Air';
  if (Math.abs(n - 1.33) < 0.04) return 'Water';
  if (Math.abs(n - 1.5) < 0.05) return 'Glass';
  if (Math.abs(n - 2.4) < 0.06) return 'Diamond';
  return 'Custom';
}

// —— UI: IOR ——
const iorAmtEl = document.getElementById('ior-amt');
const iorAmtOut = document.getElementById('ior-amt-out');
const iorLabel = document.getElementById('ior-label');
function syncIor() {
  const n = Number(iorAmtEl.value);
  iorAmtOut.textContent = n.toFixed(2);
  iorScene.userData.applyIor(n);
  if (iorLabel) iorLabel.textContent = `Material: ${nameForIor(n)} · n ≈ ${n.toFixed(2)}`;
  document.querySelectorAll('[data-ior]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.ior) - n) < 0.02));
  });
}
iorAmtEl.addEventListener('input', syncIor);
iorAmtEl.addEventListener('change', syncIor);
document.querySelectorAll('[data-ior]').forEach((btn) => {
  btn.addEventListener('click', () => {
    iorAmtEl.value = btn.dataset.ior;
    syncIor();
  });
});
syncIor();

// —— UI: Lens ——
const lensThickEl = document.getElementById('lens-thick');
const lensIorEl = document.getElementById('lens-ior');
const lensThickOut = document.getElementById('lens-thick-out');
const lensIorOut = document.getElementById('lens-ior-out');
function syncLens() {
  const thick = Number(lensThickEl.value);
  const ior = Number(lensIorEl.value);
  lensThickOut.textContent = thick.toFixed(2);
  lensIorOut.textContent = ior.toFixed(2);
  lensScene.userData.applyLens(thick, ior);
}
lensThickEl.addEventListener('input', syncLens);
lensThickEl.addEventListener('change', syncLens);
lensIorEl.addEventListener('input', syncLens);
lensIorEl.addEventListener('change', syncLens);
syncLens();

// —— UI: Prism ——
const prismIorEl = document.getElementById('prism-ior');
const prismIorOut = document.getElementById('prism-ior-out');
function syncPrism() {
  const n = Number(prismIorEl.value);
  prismIorOut.textContent = n.toFixed(2);
  prismScene.userData.applyIor(n);
}
prismIorEl.addEventListener('input', syncPrism);
prismIorEl.addEventListener('change', syncPrism);
document.querySelectorAll('[data-disp]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const on = btn.dataset.disp === 'on';
    prismScene.userData.applyDisp(on);
    document.querySelectorAll('[data-disp]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
  });
});
syncPrism();

// —— UI: Gem ——
document.querySelectorAll('[data-gem]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gemScene.userData.applyGem(btn.dataset.gem);
    document.querySelectorAll('[data-gem]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
  });
});
gemScene.userData.applyGem('diamond');

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
  renderer.setClearColor(0x040a0c, 1);
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
      renderer.setClearColor(0x040a0c, 1);
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
  iorScene,
  lensScene,
  prismScene,
  gemScene,
};

updateSize();
renderer.setAnimationLoop(animate);
