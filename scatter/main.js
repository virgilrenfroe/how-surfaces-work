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
renderer.setClearColor(0x0c0806, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

/* —— Hero v3 —— */
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
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return {
    rt, postScene, postCam, uniforms,
    lens: { x: 0.62, y: 0.48 },
    target: { x: 0.62, y: 0.48 },
    lastPointer: -1e9,
    dragging: false,
  };
}

function makeWaxGeo() {
  const geo = new THREE.BoxGeometry(1.15, 1.45, 0.85, 1, 1, 1);
  // Soften corners slightly via sphere-ish scale on a rounded feel — use sphere for hero
  return geo;
}

function makeSoftBlob() {
  const geo = new THREE.SphereGeometry(0.9, 64, 48);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    v.y *= 0.78;
    v.x *= 1.12;
    const fold = Math.sin(n.x * 3.2 + n.z * 2.1) * 0.04;
    v.addScaledVector(n, fold);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const scenes = [];

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x14100e);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.set(0, 0.45, opts.camZ ?? 3.5);
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

function addKeyLight(scene, color = 0xffe8d8, intensity = 2.2) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.2, 3.0, 1.8);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xffe8d4, 0x2a1810, 0.65);
  scene.add(fill);
  return key;
}

/** Translucent SSS-ish material via transmission + attenuation */
function sssMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xf2c8a0,
    metalness: 0,
    roughness: opts.roughness ?? 0.42,
    transmission: opts.transmission ?? 0.72,
    thickness: opts.thickness ?? 1.4,
    ior: opts.ior ?? 1.4,
    transparent: true,
    opacity: 1,
    attenuationColor: opts.attenuationColor ?? new THREE.Color(0xe87840),
    attenuationDistance: opts.attenuationDistance ?? 0.55,
    envMapIntensity: opts.envMapIntensity ?? 0.45,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
  });
}

function opaqueMat(color = 0xf2c8a0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.02,
    envMapIntensity: 0.35,
  });
}

// —— Hero ——
const heroEl = document.querySelector('[data-scene="hero"]');
if (!heroEl) throw new Error('Missing hero');
const heroPost = makeHeroPost('#ff8f6b');
const heroScene = makeScene(heroEl, { bg: 0x0c0806, camZ: 3.1 });
{
  heroScene.background = null;
  heroScene.environment = envMap;
  const mat = sssMat({
    color: 0xf0b888,
    attenuationColor: new THREE.Color(0xff7040),
    attenuationDistance: 0.7,
    thickness: 1.8,
    transmission: 0.78,
    roughness: 0.38,
  });
  const blob = new THREE.Mesh(makeSoftBlob(), mat);
  blob.scale.setScalar(1.35);
  heroScene.add(blob);
  const hemi = new THREE.HemisphereLight(0xffe8d4, 0x2a1810, 0.5);
  heroScene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6d0, 2.2);
  key.position.set(2.4, 2.0, 1.4);
  heroScene.add(key);
  const back = new THREE.DirectionalLight(0xff9060, 3.2);
  back.position.set(-1.2, 0.4, -2.8);
  heroScene.add(back);
  heroScene.userData.meshes = { blob, mat, key, back };
  heroScene.userData.heroPost = heroPost;
  heroScene.userData.controls.enableZoom = false;
  heroScene.userData.controls.enableRotate = false;
  heroScene.userData.controls.enabled = false;
  blob.geometry.computeBoundingSphere();
  const heroFitRadius = blob.geometry.boundingSphere.radius * blob.scale.x;
  heroScene.userData.update = (t, dt) => {
    const cam = heroScene.userData.camera;
    const R = heroFitRadius;
    const vf = (cam.fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * cam.aspect);
    const d = (R * 1.08) / Math.sin(Math.min(vf, hf));
    cam.position.set(0, 0.1, d);
    heroScene.userData.controls.target.set(0, 0, 0);
    if (!reducedMotion) {
      blob.rotation.y += dt * 0.25;
      blob.rotation.x = Math.sin(t * 0.32) * 0.12;
      back.intensity = 2.8 + Math.sin(t * 0.8) * 0.4;
    }
  };
}

// —— Specimen 01: Wax vs opaque ——
const waxScene = makeScene(document.querySelector('[data-scene="wax"]'), { bg: 0x120e0c, camZ: 4.0 });
{
  waxScene.environment = envMap;
  const color = 0xe8b888;
  const wax = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.5, 0.9),
    sssMat({
      color,
      attenuationColor: new THREE.Color(0xe06030),
      attenuationDistance: 0.55,
      thickness: 1.6,
      transmission: 0.75,
      roughness: 0.4,
    })
  );
  wax.position.set(-0.95, 0.1, 0);
  const plastic = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.5, 0.9),
    opaqueMat(color)
  );
  plastic.position.set(0.95, 0.1, 0);
  waxScene.add(wax, plastic);

  // Labels as simple floating plates
  const mkLabel = (x, hue) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.18),
      new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.85 })
    );
    m.position.set(x, -0.95, 0.5);
    waxScene.add(m);
  };
  mkLabel(-0.95, 0xff8f6b);
  mkLabel(0.95, 0x665850);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  waxScene.add(floor);

  addKeyLight(waxScene, 0xffe8d8, 1.6);
  const back = new THREE.DirectionalLight(0xffa060, 2.4);
  back.position.set(0, 0.6, -3.2);
  waxScene.add(back);
  // Extra fill behind wax only
  const backSpot = new THREE.SpotLight(0xffc090, 35, 10, 0.55, 0.35);
  backSpot.position.set(-0.95, 1.2, -2.6);
  backSpot.target.position.set(-0.95, 0.2, 0);
  waxScene.add(backSpot, backSpot.target);

  waxScene.userData.meshes = { wax, plastic, waxMat: wax.material, back, backSpot };
  waxScene.userData.controls.enableZoom = false;
  waxScene.userData.controls.enableRotate = false;
  waxScene.userData.controls.enabled = false;
  waxScene.userData.camera.position.set(0, 0.55, 4.0);
  waxScene.userData.update = () => {
    const cam = waxScene.userData.camera;
    const a = cam.aspect || 1;
    // Landscape phone views are very wide; pull back so both blocks stay in frame.
    cam.position.z = a > 2.4 ? 5.4 : a > 1.6 ? 4.6 : 4.0;
  };
  waxScene.userData.applyScatter = (dist, backAmt) => {
    // Larger attenuationDistance → light travels farther → stronger glow
    wax.material.attenuationDistance = dist;
    wax.material.thickness = THREE.MathUtils.lerp(0.8, 2.2, THREE.MathUtils.clamp(dist / 2.4, 0, 1));
    wax.material.transmission = THREE.MathUtils.lerp(0.35, 0.88, THREE.MathUtils.clamp(dist / 2.0, 0, 1));
    back.intensity = backAmt;
    backSpot.intensity = 12 + backAmt * 12;
  };
  waxScene.userData.update = (t) => {
    if (!reducedMotion) {
      back.position.x = Math.sin(t * 0.3) * 0.4;
    }
  };
}

// —— Specimen 02: Thin torus + thick ball ——
const thinScene = makeScene(document.querySelector('[data-scene="thin"]'), { bg: 0x120e0c, camZ: 3.8 });
{
  thinScene.environment = envMap;
  const baseColor = 0xf0b090;
  const matRing = sssMat({
    color: baseColor,
    attenuationColor: new THREE.Color(0xff6038),
    attenuationDistance: 0.7,
    thickness: 0.55,
    transmission: 0.82,
    roughness: 0.36,
  });
  const matBall = sssMat({
    color: baseColor,
    attenuationColor: new THREE.Color(0xff6038),
    attenuationDistance: 0.7,
    thickness: 2.2,
    transmission: 0.65,
    roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 32, 64), matRing);
  ring.rotation.x = Math.PI / 2.4;
  ring.position.set(-1.05, 0.15, 0);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.72, 48, 32), matBall);
  ball.position.set(1.05, 0.15, 0);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.0, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.92 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  thinScene.add(floor);

  addKeyLight(thinScene, 0xffe8d8, 1.5);
  const back = new THREE.DirectionalLight(0xff9060, 3.0);
  back.position.set(0, 0.5, -3.0);
  thinScene.add(back);

  const group = new THREE.Group();
  group.add(ring, ball);
  thinScene.add(group);

  thinScene.userData.meshes = { ring, ball, matRing, matBall, back, group };
  thinScene.userData.controls.enableZoom = false;
  thinScene.userData.controls.enableRotate = false;
  thinScene.userData.controls.enabled = false;
  thinScene.userData.applyThin = (scale, scatter) => {
    group.scale.setScalar(scale);
    matRing.attenuationDistance = scatter;
    matBall.attenuationDistance = scatter;
    // Thin ring keeps lower thickness path; ball stays thick
    matRing.thickness = 0.45 * scale;
    matBall.thickness = 2.0 * scale;
    matRing.transmission = THREE.MathUtils.lerp(0.55, 0.9, THREE.MathUtils.clamp(scatter / 1.8, 0, 1));
    matBall.transmission = THREE.MathUtils.lerp(0.4, 0.75, THREE.MathUtils.clamp(scatter / 1.8, 0, 1));
  };
  thinScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      ring.rotation.z += dt * 0.2;
      ball.rotation.y += dt * 0.25;
    }
  };
}

// —— Specimen 03: Warm tint ——
const tintScene = makeScene(document.querySelector('[data-scene="tint"]'), { bg: 0x120e0c, camZ: 3.4 });
{
  tintScene.environment = envMap;
  const mat = sssMat({
    color: 0xf5d0b8,
    attenuationColor: new THREE.Color(0xff7048),
    attenuationDistance: 0.9,
    thickness: 1.8,
    transmission: 0.8,
    roughness: 0.38,
  });
  const form = new THREE.Mesh(makeSoftBlob(), mat);
  form.scale.set(1.15, 0.95, 1.05);
  form.position.y = 0.1;
  tintScene.add(form);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  tintScene.add(floor);

  addKeyLight(tintScene, 0xfff0e4, 1.4);
  const back = new THREE.DirectionalLight(0xffffff, 2.8);
  back.position.set(-0.5, 0.8, -2.8);
  tintScene.add(back);
  const back2 = new THREE.PointLight(0xffa070, 12, 8);
  back2.position.set(0.3, 0.2, -1.8);
  tintScene.add(back2);

  tintScene.userData.meshes = { form, mat, back, back2 };
  tintScene.userData.controls.enableZoom = false;
  tintScene.userData.controls.enableRotate = false;
  tintScene.userData.controls.enabled = false;
  tintScene.userData.applyTint = (warm, scatter) => {
    // warm 0 = near-white attenuation, 1 = deep warm red-orange
    const cool = new THREE.Color(0xf8f0e8);
    const hot = new THREE.Color(0xff4820);
    mat.attenuationColor.copy(cool).lerp(hot, warm);
    mat.color.setRGB(
      THREE.MathUtils.lerp(0.95, 0.92, warm),
      THREE.MathUtils.lerp(0.88, 0.68, warm),
      THREE.MathUtils.lerp(0.82, 0.52, warm)
    );
    mat.attenuationDistance = scatter;
    mat.transmission = THREE.MathUtils.lerp(0.5, 0.88, THREE.MathUtils.clamp(scatter / 2.0, 0, 1));
    back2.color.copy(mat.attenuationColor);
  };
  tintScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      form.rotation.y += dt * 0.22;
      form.rotation.x = Math.sin(t * 0.35) * 0.1;
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

// —— UI ——
const waxScatterEl = document.getElementById('wax-scatter');
const waxBackEl = document.getElementById('wax-back');
const waxScatterOut = document.getElementById('wax-scatter-out');
const waxBackOut = document.getElementById('wax-back-out');
function syncWax() {
  const s = Number(waxScatterEl.value);
  const b = Number(waxBackEl.value);
  waxScatterOut.textContent = s.toFixed(2);
  waxBackOut.textContent = b.toFixed(2);
  waxScene.userData.applyScatter(s, b);
}
waxScatterEl.addEventListener('input', syncWax);
waxScatterEl.addEventListener('change', syncWax);
waxBackEl.addEventListener('input', syncWax);
waxBackEl.addEventListener('change', syncWax);
syncWax();

const thinScaleEl = document.getElementById('thin-scale');
const thinScatterEl = document.getElementById('thin-scatter');
const thinScaleOut = document.getElementById('thin-scale-out');
const thinScatterOut = document.getElementById('thin-scatter-out');
function syncThin() {
  const sc = Number(thinScaleEl.value);
  const s = Number(thinScatterEl.value);
  thinScaleOut.textContent = sc.toFixed(2);
  thinScatterOut.textContent = s.toFixed(2);
  thinScene.userData.applyThin(sc, s);
}
thinScaleEl.addEventListener('input', syncThin);
thinScaleEl.addEventListener('change', syncThin);
thinScatterEl.addEventListener('input', syncThin);
thinScatterEl.addEventListener('change', syncThin);
syncThin();

const tintWarmEl = document.getElementById('tint-warm');
const tintScatterEl = document.getElementById('tint-scatter');
const tintWarmOut = document.getElementById('tint-warm-out');
const tintScatterOut = document.getElementById('tint-scatter-out');
function syncTint() {
  const w = Number(tintWarmEl.value);
  const s = Number(tintScatterEl.value);
  tintWarmOut.textContent = w.toFixed(2);
  tintScatterOut.textContent = s.toFixed(2);
  tintScene.userData.applyTint(w, s);
}
tintWarmEl.addEventListener('input', syncTint);
tintWarmEl.addEventListener('change', syncTint);
tintScatterEl.addEventListener('input', syncTint);
tintScatterEl.addEventListener('change', syncTint);
syncTint();

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
  renderer.setClearColor(0x0c0806, 1);
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
      renderer.setClearColor(0x0c0806, 1);
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
  waxScene,
  thinScene,
  tintScene,
};

updateSize();
renderer.setAnimationLoop(animate);
