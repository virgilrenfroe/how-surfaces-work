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
renderer.toneMappingExposure = 1.15;
renderer.setClearColor(0x080a10, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

const ACCENT = '#9eb7ff';

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

function makeBrushedNormalMap() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Horizontal brush grooves: perturb Y more than X
      const groove = Math.sin(y * 0.55) * 0.35 + Math.sin(y * 1.7 + x * 0.02) * 0.12;
      const nx = 0.5;
      const ny = 0.5 + groove * 0.5;
      const nz = 1.0;
      data[i] = Math.floor(nx * 255);
      data[i + 1] = Math.floor(THREE.MathUtils.clamp(ny, 0, 1) * 255);
      data[i + 2] = Math.floor(nz * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function withTangents(geo) {
  if (!geo.attributes.tangent) {
    try { geo.computeTangents(); } catch (_) { /* indexed required */ }
  }
  return geo;
}

function brushMetalMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xb8c4d4,
    metalness: opts.metalness ?? 1,
    roughness: opts.roughness ?? 0.28,
    anisotropy: opts.anisotropy ?? 0.85,
    anisotropyRotation: opts.anisotropyRotation ?? 0.35,
    envMapIntensity: opts.envMapIntensity ?? 1.15,
    normalMap: opts.normalMap ?? null,
    normalScale: opts.normalScale ?? new THREE.Vector2(0.35, 0.35),
  });
}

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x080a10);
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

function addKeyLight(scene, color = 0xfff4e8, intensity = 2.4) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.2, 2.4, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8b8ff, 0.45);
  fill.position.set(-2.0, 0.8, -1.2);
  scene.add(fill);
  const amb = new THREE.AmbientLight(0x1a2030, 0.35);
  scene.add(amb);
  return key;
}

const brushNormal = makeBrushedNormalMap();
brushNormal.repeat.set(6, 6);

// —— Hero ——
const heroScene = makeScene(document.querySelector('[data-scene="hero"]'), { bg: 0x000000, camZ: 3.2 });
{
  heroScene.background = null;
  heroScene.environment = envMap;
  const geo = withTangents(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 96));
  geo.rotateX(Math.PI / 2);
  const mat = brushMetalMat({
    anisotropy: 0.95,
    anisotropyRotation: 0.4,
    roughness: 0.22,
    normalMap: brushNormal.clone(),
  });
  mat.normalMap.repeat.set(8, 8);
  const disc = new THREE.Mesh(geo, mat);
  disc.rotation.x = -0.55;
  disc.rotation.z = 0.25;
  heroScene.add(disc);
  const key = addKeyLight(heroScene, 0xfff0dd, 3.2);
  key.position.set(1.8, 2.6, 2.4);
  const rim = new THREE.DirectionalLight(0x9eb7ff, 1.4);
  rim.position.set(-2.5, 0.5, -2);
  heroScene.add(rim);
  heroScene.userData.heroPost = makeHeroPost(ACCENT);
  heroScene.userData.controls.enabled = false;
  heroScene.userData.update = (t) => {
    if (!reducedMotion) {
      disc.rotation.z = 0.25 + Math.sin(t * 0.35) * 0.08;
      mat.anisotropyRotation = 0.4 + Math.sin(t * 0.22) * 0.15;
    }
  };
  // Pointer lens on hero
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

// —— Specimen 01: Brushed disc ——
const brushScene = makeScene(document.querySelector('[data-scene="brush"]'), { bg: 0x0c1018, camZ: 3.5 });
{
  brushScene.environment = envMap;
  const geo = withTangents(new THREE.CylinderGeometry(1.35, 1.35, 0.14, 128));
  geo.rotateX(Math.PI / 2);
  const mat = brushMetalMat({
    anisotropy: 0.85,
    anisotropyRotation: (35 * Math.PI) / 180,
    roughness: 0.26,
    normalMap: brushNormal.clone(),
  });
  mat.normalMap.repeat.set(10, 10);
  const disc = new THREE.Mesh(geo, mat);
  disc.rotation.x = -0.72;
  brushScene.add(disc);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  brushScene.add(floor);

  const key = addKeyLight(brushScene, 0xfff2e4, 3.6);
  key.position.set(2.4, 3.2, 1.2);
  const spot = new THREE.SpotLight(0xffffff, 55, 14, 0.35, 0.4);
  spot.position.set(-0.2, 3.8, 2.2);
  spot.target.position.set(0, 0, 0);
  brushScene.add(spot, spot.target);

  brushScene.userData.meshes = { disc, mat, key, spot };
  brushScene.userData.controls.enableRotate = true;
  brushScene.userData.controls.enableZoom = false;
  brushScene.userData.apply = (aniso, deg) => {
    mat.anisotropy = aniso;
    mat.anisotropyRotation = (deg * Math.PI) / 180;
  };
}

// —— Specimen 02: Compare ——
const cmpScene = makeScene(document.querySelector('[data-scene="compare"]'), { bg: 0x0c1018, camZ: 4.0 });
{
  cmpScene.environment = envMap;
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8dee8,
    metalness: 1,
    roughness: 0.12,
    anisotropy: 0,
    envMapIntensity: 1.2,
  });
  const discMat = brushMetalMat({
    anisotropy: 0.9,
    anisotropyRotation: 0.2,
    roughness: 0.28,
    normalMap: brushNormal.clone(),
  });
  discMat.normalMap.repeat.set(8, 8);

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.72, 64, 48), chromeMat);
  sphere.position.set(-1.15, 0.15, 0);
  const discGeo = withTangents(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 96));
  discGeo.rotateX(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.set(1.15, 0.15, 0);
  disc.rotation.x = -0.55;
  cmpScene.add(sphere, disc);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 48),
    new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  cmpScene.add(floor);

  const key = addKeyLight(cmpScene, 0xfff0e0, 3.0);
  cmpScene.userData.meshes = { sphere, disc, chromeMat, discMat, key };
  cmpScene.userData.controls.enabled = false;
  cmpScene.userData.lightAngle = 40;
  cmpScene.userData.apply = (aniso, orbitDeg) => {
    discMat.anisotropy = aniso;
    cmpScene.userData.lightAngle = orbitDeg;
    const rad = (orbitDeg * Math.PI) / 180;
    key.position.set(Math.cos(rad) * 2.8, 2.4, Math.sin(rad) * 2.2);
  };
  cmpScene.userData.update = () => {
    const rad = (cmpScene.userData.lightAngle * Math.PI) / 180;
    key.position.set(Math.cos(rad) * 2.8, 2.4, Math.sin(rad) * 2.2);
  };
}

// —— Specimen 03: Satin ——
const satinScene = makeScene(document.querySelector('[data-scene="satin"]'), { bg: 0x0c1018, camZ: 3.4 });
{
  satinScene.environment = envMap;
  const geo = withTangents(new THREE.PlaneGeometry(2.6, 1.5, 1, 1));
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a3550,
    metalness: 0.05,
    roughness: 0.45,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0x9eb7ff),
    anisotropy: 0.7,
    anisotropyRotation: Math.PI / 2,
    envMapIntensity: 0.7,
  });
  const strip = new THREE.Mesh(geo, mat);
  strip.rotation.x = -0.55;
  satinScene.add(strip);

  // Soft fold companion
  const fold = new THREE.Mesh(
    withTangents(new THREE.CylinderGeometry(0.35, 0.4, 1.8, 48, 1, true)),
    mat.clone()
  );
  fold.rotation.z = Math.PI / 2;
  fold.position.set(0, -0.15, -0.55);
  fold.material.side = THREE.DoubleSide;
  satinScene.add(fold);

  addKeyLight(satinScene, 0xe8eeff, 2.6);
  const key2 = new THREE.DirectionalLight(0xffffff, 1.8);
  key2.position.set(0.5, 2.8, 2.5);
  satinScene.add(key2);

  satinScene.userData.meshes = { strip, fold, mat, foldMat: fold.material };
  satinScene.userData.controls.enableZoom = false;
  satinScene.userData.apply = (aniso, deg) => {
    const rot = (deg * Math.PI) / 180;
    mat.anisotropy = aniso;
    mat.anisotropyRotation = rot;
    fold.material.anisotropy = aniso;
    fold.material.anisotropyRotation = rot;
  };
}

// —— Specimen 04: Hair cards ——
const hairScene = makeScene(document.querySelector('[data-scene="hair"]'), { bg: 0x0c1018, camZ: 3.2 });
{
  hairScene.environment = envMap;
  const group = new THREE.Group();
  const mats = [];
  for (let i = 0; i < 7; i++) {
    const geo = withTangents(new THREE.PlaneGeometry(0.22, 2.2, 1, 8));
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setHSL(0.08, 0.45, 0.18 + i * 0.03),
      metalness: 0.15,
      roughness: 0.38,
      sheen: 0.85,
      sheenColor: new THREE.Color(0xe8c8a0),
      sheenRoughness: 0.28,
      anisotropy: 0.95,
      anisotropyRotation: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.85,
    });
    const card = new THREE.Mesh(geo, mat);
    card.position.x = (i - 3) * 0.28;
    card.rotation.y = (i - 3) * 0.06;
    card.rotation.x = -0.12;
    group.add(card);
    mats.push(mat);
  }
  hairScene.add(group);
  addKeyLight(hairScene, 0xffe8d0, 2.8);
  const rim = new THREE.DirectionalLight(0x9eb7ff, 1.2);
  rim.position.set(-2, 1.5, -2);
  hairScene.add(rim);

  hairScene.userData.meshes = { group, mats };
  hairScene.userData.controls.enableZoom = false;
  hairScene.userData.apply = (aniso, deg) => {
    const rot = (deg * Math.PI) / 180;
    for (const m of mats) {
      m.anisotropy = aniso;
      m.anisotropyRotation = rot;
    }
  };
  hairScene.userData.update = (t) => {
    if (!reducedMotion) group.rotation.y = Math.sin(t * 0.25) * 0.12;
  };
}

const scenes = [heroScene, brushScene, cmpScene, satinScene, hairScene];

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

bindRange('brush-aniso', 'brush-aniso-out', (v) => v.toFixed(2), () => {
  brushScene.userData.apply(Number(document.getElementById('brush-aniso').value), Number(document.getElementById('brush-rot').value));
});
bindRange('brush-rot', 'brush-rot-out', (v) => `${Math.round(v)}°`, () => {
  brushScene.userData.apply(Number(document.getElementById('brush-aniso').value), Number(document.getElementById('brush-rot').value));
});

bindRange('cmp-aniso', 'cmp-aniso-out', (v) => v.toFixed(2), () => {
  cmpScene.userData.apply(Number(document.getElementById('cmp-aniso').value), Number(document.getElementById('cmp-orbit').value));
});
const cmpOrbitEl = bindRange('cmp-orbit', 'cmp-orbit-out', (v) => `${Math.round(v)}°`, () => {
  cmpScene.userData.apply(Number(document.getElementById('cmp-aniso').value), Number(document.getElementById('cmp-orbit').value));
});
// Shared light slider owns camera orbit feel — keep OrbitControls off
cmpScene.userData.controls.enabled = false;
cmpOrbitEl.addEventListener('pointerdown', () => { cmpScene.userData.controls.enabled = false; });

bindRange('satin-aniso', 'satin-aniso-out', (v) => v.toFixed(2), () => {
  satinScene.userData.apply(Number(document.getElementById('satin-aniso').value), Number(document.getElementById('satin-rot').value));
});
bindRange('satin-rot', 'satin-rot-out', (v) => `${Math.round(v)}°`, () => {
  satinScene.userData.apply(Number(document.getElementById('satin-aniso').value), Number(document.getElementById('satin-rot').value));
});

bindRange('hair-aniso', 'hair-aniso-out', (v) => v.toFixed(2), () => {
  hairScene.userData.apply(Number(document.getElementById('hair-aniso').value), Number(document.getElementById('hair-rot').value));
});
bindRange('hair-rot', 'hair-rot-out', (v) => `${Math.round(v)}°`, () => {
  hairScene.userData.apply(Number(document.getElementById('hair-aniso').value), Number(document.getElementById('hair-rot').value));
});

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
  renderer.setClearColor(0x080a10, 1);
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
    brush: () => ({
      aniso: Number(document.getElementById('brush-aniso').value),
      rot: Number(document.getElementById('brush-rot').value),
    }),
  },
};
