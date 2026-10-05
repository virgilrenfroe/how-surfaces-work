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
} catch (_) {
  /* older Safari */
}
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

/* —— Hero stylized post (one canvas, scissor + small RT) —— */
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
    uReveal: { value: 0.38 },
    uCell: { value: 5.5 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(HERO_RT_SIZE, HERO_RT_SIZE) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
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
      uniform float uReveal;
      uniform float uCell;
      uniform float uTime;
      uniform vec2 uRes;
      varying vec2 vUv;

      float glyph(vec2 p, float level) {
        // Simple density glyphs via bars/dots (ASCII-adjacent, not a font atlas)
        float d = 1.0;
        if (level < 0.12) return 0.0;
        if (level < 0.28) {
          d = step(0.42, abs(p.x)) * step(abs(p.y), 0.12); // :
        } else if (level < 0.45) {
          d = 1.0 - smoothstep(0.18, 0.28, length(p)); // .
        } else if (level < 0.62) {
          d = step(abs(p.x), 0.1) + step(abs(p.y), 0.1); // +
          d = clamp(d, 0.0, 1.0);
        } else if (level < 0.8) {
          d = step(abs(p.x), 0.12) + step(abs(p.y), 0.32) * step(abs(p.x), 0.32); // #
          d = clamp(d, 0.0, 1.0);
        } else {
          d = 1.0 - smoothstep(0.34, 0.42, max(abs(p.x), abs(p.y))); // block
        }
        return clamp(d, 0.0, 1.0);
      }

      void main() {
        vec4 src = texture2D(tDiffuse, vUv);
        float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
        // Lift darks so terracotta / dark metals still print glyphs
        lum = clamp(pow(lum, 0.62) * 1.55 + 0.08, 0.0, 1.0);
        vec2 pix = vUv * uRes;
        vec2 cell = floor(pix / uCell);
        vec2 local = fract(pix / uCell) - 0.5;
        float g = glyph(local, lum);
        // Halftone underlay — denser fill like a data portrait
        float rad = mix(0.08, 0.48, pow(lum, 0.75));
        float dots = 1.0 - smoothstep(rad, rad + 0.05, length(local));
        float mark = max(g * 0.95, dots * 0.75);
        vec3 stylized = uAccent * (0.05 + mark * (0.55 + lum * 1.55));
        stylized += uAccent * 0.06 * sin(cell.x * 0.7 + cell.y * 1.1 + uTime * 0.6);
        // Soft vignette keeps energy on the form
        float vig = smoothstep(1.15, 0.35, length(vUv - 0.5) * 1.35);
        stylized *= 0.55 + 0.55 * vig;

        // Soft vertical reveal sweep (true PBR to the right of the line)
        float edge = 0.02;
        float reveal = smoothstep(uReveal - edge, uReveal + edge, vUv.x);
        // Thin scan line at the reveal edge
        float scan = smoothstep(0.0, 0.01, abs(vUv.x - uReveal)) * smoothstep(0.035, 0.0, abs(vUv.x - uReveal));
        vec3 col = mix(stylized, src.rgb, reveal);
        col += uAccent * scan * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  postScene.add(quad);
  return {
    rt,
    postScene,
    postCam,
    uniforms,
    reveal: 0.38,
    pointerX: 0.55,
    dragging: false,
  };
}

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

// Hero specimen — chrome knot + stylized reveal (same canvas)
const heroEl = document.querySelector('[data-scene="hero"]');
if (!heroEl) throw new Error('Missing hero view [data-scene=hero]');
const heroPost = makeHeroPost('#ff5a1f');
const heroScene = makeScene(heroEl, { bg: 0x050505, camZ: 3.15 });
{
  heroScene.background = new THREE.Color(0x050505);
  heroScene.environment = envMap;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8eef6,
    metalness: 1,
    roughness: 0.06,
    envMapIntensity: 1.35,
  });
  const knot = new THREE.Mesh(knotGeo, mat);
  knot.scale.setScalar(1.55);
  heroScene.add(knot);
  const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x2a1a10, 0.45);
  heroScene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6d0, 2.4);
  key.position.set(2.5, 2.2, 1.4);
  heroScene.add(key);
  const rim = new THREE.DirectionalLight(0x88c0ff, 0.8);
  rim.position.set(-2.2, 0.6, -1.8);
  heroScene.add(rim);
  heroScene.userData.meshes = { knot, mat, key };
  heroScene.userData.heroPost = heroPost;
  heroScene.userData.controls.enableZoom = false;
  heroScene.userData.controls.enableRotate = false;
  heroScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      knot.rotation.y += dt * 0.28;
      knot.rotation.x = Math.sin(t * 0.35) * 0.15;
      key.position.x = Math.cos(t * 0.4) * 2.6;
      key.position.z = Math.sin(t * 0.4) * 1.8;
    }
  };
}

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


// Hero reveal pointer + auto sweep
{
  const el = heroEl;
  const post = heroPost;
  const setFromClientX = (clientX) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    post.pointerX = Math.min(0.95, Math.max(0.05, (clientX - r.left) / r.width));
    post.reveal = post.pointerX;
  };
  el.addEventListener('pointerdown', (e) => {
    post.dragging = true;
    el.setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  });
  el.addEventListener('pointermove', (e) => {
    if (post.dragging || e.buttons) setFromClientX(e.clientX);
    else if (!reducedMotion) {
      // gentle follow when hovering
      const r = el.getBoundingClientRect();
      if (r.width > 0 && e.clientY >= r.top && e.clientY <= r.bottom) {
        const target = (e.clientX - r.left) / r.width;
        post.reveal += (target - post.reveal) * 0.12;
      }
    }
  });
  el.addEventListener('pointerup', () => { post.dragging = false; });
  el.addEventListener('pointerleave', () => { post.dragging = false; });
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
function onRoughInput() {
  pbrMat.roughness = Number(roughEl.value);
  syncPbrOutputs();
}
function onMetalInput() {
  pbrMat.metalness = Number(metalEl.value);
  syncPbrOutputs();
}
roughEl.addEventListener('input', onRoughInput);
roughEl.addEventListener('change', onRoughInput);
metalEl.addEventListener('input', onMetalInput);
metalEl.addEventListener('change', onMetalInput);

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

function onCoatInput() {
  paintMat.clearcoat = Number(coatEl.value);
  coatOut.textContent = Number(coatEl.value).toFixed(2);
}
function onAnisoInput() {
  brushMat.anisotropy = Number(anisoEl.value);
  anisoOut.textContent = Number(anisoEl.value).toFixed(2);
}
coatEl.addEventListener('input', onCoatInput);
coatEl.addEventListener('change', onCoatInput);
anisoEl.addEventListener('input', onAnisoInput);
anisoEl.addEventListener('change', onAnisoInput);

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
function syncOrbitLight() {
  orbitLight = Number(orbitEl.value) === 1;
  orbitOut.textContent = orbitLight ? 'ON' : 'OFF';
  orbitEl.setAttribute('aria-checked', orbitLight ? 'true' : 'false');
}
orbitEl.addEventListener('input', syncOrbitLight);
orbitEl.addEventListener('change', syncOrbitLight);
syncOrbitLight();

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
// frame counter for QA (incremented inside animate)


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

let frameCount = 0;
function animate(now) {
  if (!visible) return;
  frameCount += 1;
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

    const post = scene.userData.heroPost;
    if (post) {
      // Auto sweep when idle
      if (!post.dragging && !reducedMotion) {
        post.reveal = 0.5 + Math.sin(now * 0.00045) * 0.28;
      } else if (reducedMotion && !post.dragging) {
        post.reveal = 0.42;
      }
      const aspect = Math.max(0.5, width / height);
      const rtW = HERO_RT_SIZE;
      const rtH = Math.max(96, Math.round(HERO_RT_SIZE / aspect));
      if (post.rt.width !== rtW || post.rt.height !== rtH) {
        post.rt.setSize(rtW, rtH);
        post.uniforms.uRes.value.set(rtW, rtH);
      }
      // Render true PBR into small RT (ignore scissor for RT)
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, rtW, rtH);
      const prevTone = renderer.toneMappingExposure;
      renderer.setRenderTarget(post.rt);
      renderer.clear();
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      // Stylized pass into hero scissor region
      renderer.setScissorTest(true);
      renderer.setViewport(left, bottom, width, height);
      renderer.setScissor(left, bottom, width, height);
      post.uniforms.uReveal.value = post.reveal;
      post.uniforms.uTime.value = now * 0.001;
      post.uniforms.uCell.value = Math.max(4.2, Math.min(9, width / 95));
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

// Expose for verification scripts
window.__HSW = {
  renderer,
  canvas,
  scenes,
  shared,
  get frameCount() { return frameCount; },
  get reducedMotion() { return reducedMotion; },
  get orbitLight() { return orbitLight; },
  webglContexts: () => document.querySelectorAll('canvas').length,
  heroPost,
};

updateSize();
renderer.setAnimationLoop(animate);
