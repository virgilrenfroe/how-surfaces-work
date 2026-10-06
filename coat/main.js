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
renderer.setClearColor(0x10080c, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

const ACCENT = '#ff3b5c';

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

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x10080c);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0, opts.camY ?? 0.35, opts.camZ ?? 3.6);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
  controls.target.set(0, 0.1, 0);
  scene.userData.element = element;
  scene.userData.camera = camera;
  scene.userData.controls = controls;
  return scene;
}

function addKeyLight(scene, color = 0xfff0e8, intensity = 2.6) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.4, 2.8, 1.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xff8098, 0.4);
  fill.position.set(-2.2, 0.6, -1.0);
  scene.add(fill);
  const amb = new THREE.AmbientLight(0x2a1520, 0.35);
  scene.add(amb);
  return key;
}

function carPaintMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xc4182a,
    metalness: opts.metalness ?? 0.18,
    roughness: opts.roughness ?? 0.42,
    clearcoat: opts.clearcoat ?? 1,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.08,
    envMapIntensity: opts.envMapIntensity ?? 1.05,
  });
}

function withTangents(geo) {
  if (!geo.attributes.tangent) {
    try { geo.computeTangents(); } catch (_) {}
  }
  return geo;
}

// —— Hero ——
const heroScene = makeScene(document.querySelector('[data-scene="hero"]'), { bg: 0x000000, camZ: 3.85 });
{
  heroScene.background = null;
  heroScene.environment = envMap;
  const mat = carPaintMat({ clearcoat: 1, clearcoatRoughness: 0.05, roughness: 0.38 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.88, 64, 48), mat);
  heroScene.add(sphere);
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.38, 0.12, 120, 18),
    carPaintMat({ color: 0x8a1020, clearcoat: 1, clearcoatRoughness: 0.04, roughness: 0.35 })
  );
  knot.position.set(0.62, -0.45, 0.3);
  knot.scale.setScalar(0.55);
  heroScene.add(knot);
  const key = addKeyLight(heroScene, 0xfff4ea, 3.4);
  key.position.set(2.0, 3.0, 2.2);
  const rim = new THREE.DirectionalLight(0xff3b5c, 0.9);
  rim.position.set(-2.5, 1.0, -2);
  heroScene.add(rim);
  heroScene.userData.heroPost = makeHeroPost(ACCENT);
  heroScene.userData.controls.enabled = false;
  heroScene.userData.update = (t) => {
    const cam = heroScene.userData.camera;
    const a = cam.aspect || 1;
    // Landscape phone views are very wide and short — move closer so the hero stays readable.
    // Portrait / desk: pull back so mask outside-bg stays clean.
    cam.position.z = a > 2.2 ? 3.05 : a > 1.35 ? 3.45 : 3.75;
    if (!reducedMotion) {
      sphere.rotation.y = t * 0.28;
      knot.rotation.x = t * 0.35;
      knot.rotation.y = t * 0.22;
    }
  };
  const el = heroScene.userData.element;
  const post = heroScene.userData.heroPost;
  const setLens = (clientX, clientY) => {
    const r = el.getBoundingClientRect();
    post.target.x = THREE.MathUtils.clamp((clientX - r.left) / r.width, 0.08, 0.92);
    post.target.y = THREE.MathUtils.clamp(1 - (clientY - r.top) / r.height, 0.08, 0.92);
    post.lastPointer = performance.now();
  };
  el.addEventListener('pointerdown', (e) => { post.dragging = true; el.setPointerCapture?.(e.pointerId); setLens(e.clientX, e.clientY); });
  el.addEventListener('pointermove', (e) => { if (post.dragging || e.pressure > 0) setLens(e.clientX, e.clientY); });
  el.addEventListener('pointerup', () => { post.dragging = false; });
  el.addEventListener('pointercancel', () => { post.dragging = false; });
}

// —— Specimen 01: Clearcoat ——
const coatScene = makeScene(document.querySelector('[data-scene="coat"]'), { bg: 0x140a10, camZ: 3.4 });
{
  coatScene.environment = envMap;
  const mat = carPaintMat({ clearcoat: 1, clearcoatRoughness: 0.08, roughness: 0.42 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.15, 64, 48), mat);
  coatScene.add(sphere);
  // Curved panel behind for more readable coat sparkle
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.6, 1, 1),
    carPaintMat({ color: 0x9a1528, clearcoat: 1, clearcoatRoughness: 0.1, roughness: 0.5 })
  );
  panel.position.set(0, -0.15, -1.35);
  panel.rotation.y = 0.15;
  coatScene.add(panel);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x120810, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  coatScene.add(floor);

  const key = addKeyLight(coatScene, 0xfff2e8, 3.8);
  key.position.set(2.6, 3.4, 1.4);
  const spot = new THREE.SpotLight(0xffffff, 60, 14, 0.32, 0.35);
  spot.position.set(-0.4, 4.0, 2.4);
  spot.target.position.set(0, 0.2, 0);
  coatScene.add(spot, spot.target);

  coatScene.userData.meshes = { sphere, panel, mat, panelMat: panel.material, key, spot };
  coatScene.userData.controls.enableZoom = false;
  coatScene.userData.apply = (coat, coatR, baseR) => {
    mat.clearcoat = coat;
    mat.clearcoatRoughness = coatR;
    mat.roughness = baseR;
    panel.material.clearcoat = coat;
    panel.material.clearcoatRoughness = coatR;
    panel.material.roughness = Math.min(0.9, baseR + 0.08);
  };
}

// —— Specimen 02: Compare ——
const cmpScene = makeScene(document.querySelector('[data-scene="compare"]'), { bg: 0x140a10, camZ: 4.0 });
{
  cmpScene.environment = envMap;
  const baseColor = 0xc4182a;
  const baseRough = 0.48;
  const matte = carPaintMat({
    color: baseColor,
    roughness: baseRough,
    clearcoat: 0,
    clearcoatRoughness: 0.2,
    metalness: 0.15,
  });
  const lacquer = carPaintMat({
    color: baseColor,
    roughness: baseRough,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    metalness: 0.15,
  });
  const left = new THREE.Mesh(new THREE.SphereGeometry(0.85, 64, 48), matte);
  left.position.set(-1.15, 0.1, 0);
  const right = new THREE.Mesh(new THREE.SphereGeometry(0.85, 64, 48), lacquer);
  right.position.set(1.15, 0.1, 0);
  cmpScene.add(left, right);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x120810, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.9;
  cmpScene.add(floor);

  const key = addKeyLight(cmpScene, 0xfff0e0, 3.2);
  cmpScene.userData.meshes = { left, right, matte, lacquer, key };
  cmpScene.userData.controls.enabled = false;
  cmpScene.userData.lightAngle = 45;
  cmpScene.userData.apply = (coat, orbitDeg) => {
    lacquer.clearcoat = coat;
    cmpScene.userData.lightAngle = orbitDeg;
    const rad = (orbitDeg * Math.PI) / 180;
    key.position.set(Math.cos(rad) * 2.8, 2.6, Math.sin(rad) * 2.2);
  };
  cmpScene.userData.update = () => {
    const rad = (cmpScene.userData.lightAngle * Math.PI) / 180;
    key.position.set(Math.cos(rad) * 2.8, 2.6, Math.sin(rad) * 2.2);
  };
}

// —— Specimen 03: Metallic vs dielectric bases ——
const basesScene = makeScene(document.querySelector('[data-scene="bases"]'), { bg: 0x140a10, camZ: 3.8 });
{
  basesScene.environment = envMap;
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0xb02030,
    metalness: 0.85,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    anisotropy: 0.55,
    anisotropyRotation: 0.4,
    envMapIntensity: 1.15,
  });
  const diel = carPaintMat({
    color: 0xc4182a,
    metalness: 0.12,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });

  const geoM = withTangents(new THREE.SphereGeometry(0.8, 64, 48));
  const left = new THREE.Mesh(geoM, metal);
  left.position.set(-1.15, 0.1, 0);
  const right = new THREE.Mesh(new THREE.SphereGeometry(0.8, 64, 48), diel);
  right.position.set(1.15, 0.1, 0);
  basesScene.add(left, right);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x120810, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  basesScene.add(floor);

  addKeyLight(basesScene, 0xfff0e0, 3.0);
  const key2 = new THREE.DirectionalLight(0xffffff, 1.6);
  key2.position.set(0.2, 3.2, 2.6);
  basesScene.add(key2);

  basesScene.userData.meshes = { left, right, metal, diel };
  basesScene.userData.controls.enableZoom = false;
  basesScene.userData.apply = (coat, coatR) => {
    metal.clearcoat = coat;
    metal.clearcoatRoughness = coatR;
    diel.clearcoat = coat;
    diel.clearcoatRoughness = coatR;
  };
  basesScene.userData.update = (t) => {
    if (!reducedMotion) {
      left.rotation.y = t * 0.2;
      right.rotation.y = -t * 0.18;
    }
  };
}

const scenes = [heroScene, coatScene, cmpScene, basesScene];

function bindRange(id, outId, fmt, onChange) {
  const el = document.getElementById(id);
  const out = document.getElementById(outId);
  const sync = () => {
    const v = Number(el.value);
    out.textContent = fmt(v);
    onChange(v);
  };
  el.addEventListener('input', sync);
  el.addEventListener('change', sync);
  sync();
  return el;
}

function syncCoat() {
  coatScene.userData.apply(
    Number(document.getElementById('coat-amt').value),
    Number(document.getElementById('coat-rough').value),
    Number(document.getElementById('base-rough').value)
  );
}
bindRange('coat-amt', 'coat-amt-out', (v) => v.toFixed(2), syncCoat);
bindRange('coat-rough', 'coat-rough-out', (v) => v.toFixed(2), syncCoat);
bindRange('base-rough', 'base-rough-out', (v) => v.toFixed(2), syncCoat);

function syncCmp() {
  cmpScene.userData.apply(
    Number(document.getElementById('cmp-coat').value),
    Number(document.getElementById('cmp-orbit').value)
  );
}
bindRange('cmp-coat', 'cmp-coat-out', (v) => v.toFixed(2), syncCmp);
bindRange('cmp-orbit', 'cmp-orbit-out', (v) => `${Math.round(v)}°`, syncCmp);

function syncBases() {
  basesScene.userData.apply(
    Number(document.getElementById('bases-coat').value),
    Number(document.getElementById('bases-rough').value)
  );
}
bindRange('bases-coat', 'bases-coat-out', (v) => v.toFixed(2), syncBases);
bindRange('bases-rough', 'bases-rough-out', (v) => v.toFixed(2), syncBases);

function updateSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = pixelCap();
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
}

let visible = !document.hidden;
document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  if (visible) last = performance.now();
});
window.addEventListener('resize', () => { updateSize(); });

let last = performance.now();
let frameCount = 0;

function animate(now) {
  if (!visible) {
    requestAnimationFrame(animate);
    return;
  }
  frameCount += 1;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateSize();

  renderer.setScissorTest(false);
  renderer.setClearColor(0x10080c, 1);
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
      post.lens.x += (post.target.x - post.lens.x) * 0.08;
      post.lens.y += (post.target.y - post.lens.y) * 0.08;
      post.uniforms.uLens.value.set(post.lens.x, post.lens.y);
      post.uniforms.uScreen.value.set(width, height);
      post.uniforms.uTime.value = tnow;

      const aspect = width / height;
      const rtW = HERO_RT_SIZE;
      const rtH = Math.max(64, Math.round(HERO_RT_SIZE / aspect));
      if (post.rt.height !== rtH) post.rt.setSize(rtW, rtH);
      post.uniforms.uRes.value.set(rtW, rtH);

      renderer.setRenderTarget(post.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      renderer.setViewport(left, bottom, width, height);
      renderer.setScissor(left, bottom, width, height);
      const prevTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.render(post.postScene, post.postCam);
      renderer.toneMapping = prevTM;
    } else {
      renderer.render(scene, camera);
    }
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.__HSW = {
  renderer,
  scenes,
  get frameCount() { return frameCount; },
  webglContexts() {
    const gl = renderer.getContext();
    return gl ? 1 : 0;
  },
  heroPost: heroScene.userData.heroPost,
  state: {
    coat: () => ({
      amt: Number(document.getElementById('coat-amt').value),
      rough: Number(document.getElementById('coat-rough').value),
    }),
  },
};
