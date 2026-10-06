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
renderer.setClearColor(0x0a0810, 1);
renderer.domElement.style.pointerEvents = 'none';

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose?.();
pmrem.dispose();

/* —— Hero: dots only on the object + soft lens reveal (Why Zero craft / series fix) —— */
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

/** Soft cushion via deformed sphere — Monogrid tactile weight */
function makeCushionGeo() {
  const geo = new THREE.SphereGeometry(0.85, 64, 48);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    v.y *= 0.55;
    v.x *= 1.15;
    v.z *= 1.15;
    const fold = Math.sin(n.x * 4.2 + n.z * 2.1) * 0.045
      + Math.sin(n.y * 6.0 + n.x * 3.0) * 0.03;
    v.addScaledVector(n, fold);
    const top = Math.max(0, n.y);
    v.y -= top * top * 0.18;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Thickness map for thin-film variation (cyan→magenta→gold bands) */
function makeThicknessMap() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n =
        0.55 * Math.sin(u * Math.PI * 3.2 + v * 1.7) +
        0.3 * Math.sin(u * 8.1 - v * 5.4) +
        0.15 * Math.sin((u + v) * 14.0);
      const t = Math.min(1, Math.max(0, 0.5 + 0.5 * n));
      const i = (y * size + x) * 4;
      const g = Math.floor(t * 255);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const thicknessMap = makeThicknessMap();
const knotGeo = new THREE.TorusKnotGeometry(0.72, 0.24, 180, 32);
const sphereGeo = new THREE.SphereGeometry(0.72, 64, 48);
const cushionGeo = makeCushionGeo();
const roundedBoxGeo = new THREE.SphereGeometry(0.7, 48, 32);

const scenes = [];

function makeScene(element, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x121018);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0.55, opts.camZ ?? 3.4);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 6;
  controls.target.set(0, 0.05, 0);
  controls.update();
  scene.userData = { element, camera, controls, update: null, meshes: {} };
  scenes.push(scene);
  return scene;
}

function addFloor(scene, y = -1.05, color = 0x1a1612) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0.04,
      envMapIntensity: 0.4,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  scene.add(floor);
  return floor;
}

function addKeyLight(scene, color = 0xffe6d0, intensity = 2.4) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(2.4, 3.2, 1.6);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xffe8d4, 0x2a1828, 0.7);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x88c0ff, 1.0);
  rim.position.set(-2.4, 1.2, -1.8);
  scene.add(rim);
  return key;
}

/* —— Why Zero–inspired shimmer dissolve between presets —— */
const dissolves = [];
function startDissolve(mat, applyTarget, duration = 0.75) {
  const from = {
    color: mat.color.clone(),
    sheenColor: mat.sheenColor?.clone?.() || null,
    attenuationColor: mat.attenuationColor?.clone?.() || null,
    sheen: mat.sheen,
    sheenRoughness: mat.sheenRoughness,
    roughness: mat.roughness,
    metalness: mat.metalness,
    iridescence: mat.iridescence,
    iridescenceIOR: mat.iridescenceIOR,
    iridescenceThicknessRange: mat.iridescenceThicknessRange
      ? [...mat.iridescenceThicknessRange]
      : null,
    transmission: mat.transmission,
    thickness: mat.thickness,
    attenuationDistance: mat.attenuationDistance,
    envMapIntensity: mat.envMapIntensity,
    clearcoat: mat.clearcoat,
  };
  applyTarget(mat); // set "to" values on mat, then we restore from and lerp
  const to = {
    color: mat.color.clone(),
    sheenColor: mat.sheenColor?.clone?.() || null,
    attenuationColor: mat.attenuationColor?.clone?.() || null,
    sheen: mat.sheen,
    sheenRoughness: mat.sheenRoughness,
    roughness: mat.roughness,
    metalness: mat.metalness,
    iridescence: mat.iridescence,
    iridescenceIOR: mat.iridescenceIOR,
    iridescenceThicknessRange: mat.iridescenceThicknessRange
      ? [...mat.iridescenceThicknessRange]
      : null,
    transmission: mat.transmission,
    thickness: mat.thickness,
    attenuationDistance: mat.attenuationDistance,
    envMapIntensity: mat.envMapIntensity,
    clearcoat: mat.clearcoat,
  };
  // restore from
  mat.color.copy(from.color);
  if (from.sheenColor && mat.sheenColor) mat.sheenColor.copy(from.sheenColor);
  if (from.attenuationColor && mat.attenuationColor) mat.attenuationColor.copy(from.attenuationColor);
  mat.sheen = from.sheen;
  mat.sheenRoughness = from.sheenRoughness;
  mat.roughness = from.roughness;
  mat.metalness = from.metalness;
  mat.iridescence = from.iridescence;
  mat.iridescenceIOR = from.iridescenceIOR;
  if (from.iridescenceThicknessRange) mat.iridescenceThicknessRange = [...from.iridescenceThicknessRange];
  mat.transmission = from.transmission;
  mat.thickness = from.thickness;
  mat.attenuationDistance = from.attenuationDistance;
  mat.envMapIntensity = from.envMapIntensity;
  mat.clearcoat = from.clearcoat;

  dissolves.push({ mat, from, to, t: 0, duration, emissiveBoost: 0 });
}

function tickDissolves(dt) {
  for (let i = dissolves.length - 1; i >= 0; i--) {
    const d = dissolves[i];
    d.t += dt / d.duration;
    const u = Math.min(1, d.t);
    // noise-edged ease (Why Zero burn front feel)
    const edge = Math.min(1, Math.max(0, u * 1.35 - 0.1 * Math.sin(u * 18)));
    const mat = d.mat;
    mat.color.lerpColors(d.from.color, d.to.color, edge);
    if (d.from.sheenColor && d.to.sheenColor && mat.sheenColor) {
      mat.sheenColor.lerpColors(d.from.sheenColor, d.to.sheenColor, edge);
    }
    if (d.from.attenuationColor && d.to.attenuationColor && mat.attenuationColor) {
      mat.attenuationColor.lerpColors(d.from.attenuationColor, d.to.attenuationColor, edge);
    }
    const mix = (a, b) => a + (b - a) * edge;
    mat.sheen = mix(d.from.sheen, d.to.sheen);
    mat.sheenRoughness = mix(d.from.sheenRoughness, d.to.sheenRoughness);
    mat.roughness = mix(d.from.roughness, d.to.roughness);
    mat.metalness = mix(d.from.metalness, d.to.metalness);
    mat.iridescence = mix(d.from.iridescence, d.to.iridescence);
    mat.iridescenceIOR = mix(d.from.iridescenceIOR, d.to.iridescenceIOR);
    if (d.from.iridescenceThicknessRange && d.to.iridescenceThicknessRange) {
      mat.iridescenceThicknessRange = [
        mix(d.from.iridescenceThicknessRange[0], d.to.iridescenceThicknessRange[0]),
        mix(d.from.iridescenceThicknessRange[1], d.to.iridescenceThicknessRange[1]),
      ];
    }
    mat.transmission = mix(d.from.transmission, d.to.transmission);
    mat.thickness = mix(d.from.thickness, d.to.thickness);
    mat.attenuationDistance = mix(d.from.attenuationDistance, d.to.attenuationDistance);
    mat.envMapIntensity = mix(d.from.envMapIntensity, d.to.envMapIntensity);
    mat.clearcoat = mix(d.from.clearcoat ?? 0, d.to.clearcoat ?? 0);
    // ember rim flash
    const flash = Math.sin(edge * Math.PI) * 0.55;
    if (mat.emissive) mat.emissive.setRGB(flash * 0.55, flash * 0.25, flash * 0.7);
    if (u >= 1) {
      if (mat.emissive) mat.emissive.setRGB(0, 0, 0);
      dissolves.splice(i, 1);
    }
  }
}

// —— Hero ——
const heroEl = document.querySelector('[data-scene="hero"]');
if (!heroEl) throw new Error('Missing hero view [data-scene=hero]');
const heroPost = makeHeroPost('#b388ff');
const heroScene = makeScene(heroEl, { bg: 0x050505, camZ: 3.15 });
{
  heroScene.background = null; // RT alpha = object mask
  heroScene.environment = envMap;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a1840,
    metalness: 0,
    roughness: 0.72,
    sheen: 1,
    sheenRoughness: 0.28,
    sheenColor: new THREE.Color(0xe8b4ff),
    envMapIntensity: 0.55,
  });
  const knot = new THREE.Mesh(knotGeo, mat);
  knot.scale.setScalar(1.55);
  heroScene.add(knot);
  const hemi = new THREE.HemisphereLight(0xffe8d4, 0x2a1828, 0.55);
  heroScene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6d0, 2.6);
  key.position.set(2.5, 2.2, 1.4);
  heroScene.add(key);
  const rim = new THREE.DirectionalLight(0x5ce1e6, 1.1);
  rim.position.set(-2.2, 0.6, -1.8);
  heroScene.add(rim);
  heroScene.userData.meshes = { knot, mat, key };
  heroScene.userData.heroPost = heroPost;
  heroScene.userData.controls.enableZoom = false;
  heroScene.userData.controls.enableRotate = false;
  heroScene.userData.controls.enabled = false;
  knotGeo.computeBoundingSphere();
  const heroFitRadius = knotGeo.boundingSphere.radius * knot.scale.x;
  heroScene.userData.controls.maxDistance = 20;
  heroScene.userData.update = (t, dt) => {
    // Fit the whole object inside the hero box at any aspect (no hard crop).
    // Without this the knot fills the RT, dots cover the whole hero rect, and
    // the knot's topological holes read as an "inverted" mask.
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
      key.position.x = Math.cos(t * 0.4) * 2.6;
      key.position.z = Math.sin(t * 0.4) * 1.8;
    }
  };
}

// —— Specimen 01: Sheen + drag-to-tilt (tiltoootilt weight) ——
const sheenScene = makeScene(document.querySelector('[data-scene="sheen"]'), { bg: 0x141018, camZ: 3.5 });
{
  sheenScene.environment = envMap;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x3a1a58,
    metalness: 0,
    roughness: 0.78,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xffd8f8),
    envMapIntensity: 0.5,
    emissive: new THREE.Color(0x000000),
  });
  const cushion = new THREE.Mesh(cushionGeo, mat);
  cushion.position.set(0, 0.15, 0);
  const ball = new THREE.Mesh(sphereGeo, mat);
  ball.position.set(1.35, -0.05, 0.15);
  ball.scale.setScalar(0.55);
  sheenScene.add(cushion, ball);
  addFloor(sheenScene, -1.0, 0x1c1614);
  const key = addKeyLight(sheenScene, 0xfff0e8, 2.8);
  const graze = new THREE.DirectionalLight(0xffffff, 3.2);
  graze.position.set(-3.4, 0.25, 0.35);
  sheenScene.add(graze);

  // Physical weight: drag tilts with spring return
  const tilt = { x: 0, z: 0, vx: 0, vz: 0, dragging: false, lastX: 0, lastY: 0 };
  const el = sheenScene.userData.element;
  el.addEventListener('pointerdown', (e) => {
    tilt.dragging = true;
    tilt.lastX = e.clientX;
    tilt.lastY = e.clientY;
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!tilt.dragging) return;
    const dx = e.clientX - tilt.lastX;
    const dy = e.clientY - tilt.lastY;
    tilt.lastX = e.clientX;
    tilt.lastY = e.clientY;
    // massy response — slow drift (tiltoootilt)
    tilt.vx += dx * 0.0018;
    tilt.vz += dy * 0.0018;
  });
  el.addEventListener('pointerup', () => { tilt.dragging = false; });
  el.addEventListener('pointercancel', () => { tilt.dragging = false; });

  sheenScene.userData.meshes = { mat, cushion, ball, key, graze, tilt };
  sheenScene.userData.update = (t, dt) => {
    // spring-damper on tilt
    const k = 2.4;
    const damp = 3.6;
    tilt.vx += (-k * tilt.x - damp * tilt.vx) * dt;
    tilt.vz += (-k * tilt.z - damp * tilt.vz) * dt;
    tilt.x += tilt.vx * dt;
    tilt.z += tilt.vz * dt;
    tilt.x = Math.max(-0.85, Math.min(0.85, tilt.x));
    tilt.z = Math.max(-0.55, Math.min(0.55, tilt.z));
    cushion.rotation.x = tilt.z;
    cushion.rotation.z = -tilt.x;
    if (!reducedMotion && !tilt.dragging) {
      cushion.rotation.y += dt * 0.12;
      ball.rotation.y -= dt * 0.22;
      key.position.x = Math.cos(t * 0.32) * 2.8;
      key.position.z = Math.sin(t * 0.32) * 2.0;
      graze.position.x = Math.cos(t * 0.25 + 1.2) * -3.0;
      graze.position.z = Math.sin(t * 0.25 + 1.2) * 1.5;
    }
  };
}

// —— Specimen 02: Iridescence (bright, multi-hue, thickness map) ——
// Bright studio env just for iridescence (film color needs something to bounce)
const iriPmrem = new THREE.PMREMGenerator(renderer);
const iriRoom = new THREE.Scene();
{
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xdde6f5, side: THREE.BackSide })
  );
  iriRoom.add(box);
  const panels = [
    [0xff66cc, [-4, 2, 0]],
    [0x44eeff, [4, 2, 0]],
    [0xffcc44, [0, 3, -4]],
    [0xffffff, [0, 4, 4]],
  ];
  for (const [hex, pos] of panels) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide })
    );
    p.position.set(...pos);
    p.lookAt(0, 0, 0);
    iriRoom.add(p);
  }
}
const iriEnv = iriPmrem.fromScene(iriRoom, 0.02).texture;
iriPmrem.dispose();

const iriScene = makeScene(document.querySelector('[data-scene="iridescence"]'), { bg: 0x2e3648, camZ: 3.15 });
{
  iriScene.environment = iriEnv;
  iriScene.background = new THREE.Color(0x2e3648);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x6a7388,
    metalness: 0.45,
    roughness: 0.18,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [90, 700],
    iridescenceThicknessMap: thicknessMap,
    envMapIntensity: 2.8,
    clearcoat: 0.55,
    clearcoatRoughness: 0.08,
    emissive: new THREE.Color(0x000000),
  });
  const bubble = new THREE.Mesh(sphereGeo, mat);
  bubble.scale.setScalar(1.2);
  const shell = new THREE.Mesh(knotGeo, mat);
  shell.position.set(1.45, -0.05, 0);
  shell.scale.setScalar(0.45);
  iriScene.add(bubble, shell);
  addFloor(iriScene, -1.15, 0x3a4254);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.6, 3.4, 1.8);
  iriScene.add(key);
  const cool = new THREE.DirectionalLight(0x66f0ff, 3.8);
  cool.position.set(-3.0, 1.8, 2.2);
  iriScene.add(cool);
  const magenta = new THREE.DirectionalLight(0xff66cc, 3.4);
  magenta.position.set(1.5, 0.6, -2.8);
  iriScene.add(magenta);
  const gold = new THREE.DirectionalLight(0xffcc55, 3.2);
  gold.position.set(-1.2, 2.4, -1.6);
  iriScene.add(gold);
  const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x304050, 1.1);
  iriScene.add(hemi);
  iriScene.userData.meshes = { mat, bubble, shell, key, cool, magenta, gold };
  iriScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      bubble.rotation.y += dt * 0.48;
      bubble.rotation.x = Math.sin(t * 0.5) * 0.4;
      shell.rotation.y -= dt * 0.52;
      key.position.x = Math.cos(t * 0.6) * 2.9;
      key.position.z = Math.sin(t * 0.6) * 2.3;
      cool.position.x = Math.cos(t * 0.45 + 1) * -2.8;
      magenta.position.z = Math.sin(t * 0.4 + 2) * -2.6;
      gold.position.x = Math.sin(t * 0.35) * 2.0;
    }
  };
}

// —— Specimen 03: Wax (Monogrid soft warmth) ——
const waxScene = makeScene(document.querySelector('[data-scene="wax"]'), { bg: 0x16120e, camZ: 3.4 });
{
  waxScene.environment = envMap;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf2d9a8,
    metalness: 0,
    roughness: 0.42,
    transmission: 0.65,
    thickness: 1.5,
    attenuationColor: new THREE.Color(0xe8a040),
    attenuationDistance: 0.8,
    ior: 1.4,
    envMapIntensity: 0.55,
    transparent: true,
    emissive: new THREE.Color(0x000000),
  });
  const blob = new THREE.Mesh(roundedBoxGeo, mat);
  blob.scale.set(1.05, 0.85, 1.05);
  const pebble = new THREE.Mesh(sphereGeo, mat);
  pebble.position.set(1.35, -0.15, 0.1);
  pebble.scale.setScalar(0.5);
  waxScene.add(blob, pebble);
  addFloor(waxScene, -1.05, 0x1c1610);
  const key = addKeyLight(waxScene, 0xfff2d8, 2.6);
  const back = new THREE.DirectionalLight(0xffcc88, 3.0);
  back.position.set(-1.5, 1.2, -2.8);
  waxScene.add(back);
  waxScene.userData.meshes = { mat, blob, pebble, key, back };
  waxScene.userData.update = (t, dt) => {
    if (!reducedMotion) {
      blob.rotation.y += dt * 0.2;
      pebble.rotation.y -= dt * 0.25;
      key.position.x = Math.cos(t * 0.3) * 2.4;
      key.position.z = Math.sin(t * 0.3) * 1.8;
    }
  };
}

// —— Centerpiece ——
function makeCmpScene(name, kind) {
  const bg = kind === 'iri' ? 0x2e3648 : 0x14121a;
  const scene = makeScene(document.querySelector(`[data-scene="${name}"]`), { bg, camZ: 2.9 });
  scene.environment = envMap;
  let mat;
  if (kind === 'sheen') {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0x2e1848,
      metalness: 0,
      roughness: 0.75,
      sheen: 1,
      sheenRoughness: 0.3,
      sheenColor: new THREE.Color(0xffd0f5),
      envMapIntensity: 0.5,
    });
  } else if (kind === 'iri') {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0x6a7388,
      metalness: 0.45,
      roughness: 0.16,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [90, 700],
      iridescenceThicknessMap: thicknessMap,
      envMapIntensity: 2.8,
      clearcoat: 0.55,
      clearcoatRoughness: 0.08,
    });
    scene.environment = iriEnv;
  } else {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0xc5c0b5,
      metalness: 0.05,
      roughness: 0.38,
      envMapIntensity: 0.85,
    });
  }
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.scale.setScalar(1.05);
  scene.add(mesh);
  addFloor(scene, -1.05, kind === 'iri' ? 0x22262e : 0x1a1614);
  const key = addKeyLight(scene, 0xfff0e0, kind === 'iri' ? 3.2 : 2.5);
  const graze = new THREE.DirectionalLight(0xffffff, kind === 'sheen' ? 3.0 : kind === 'iri' ? 2.0 : 1.2);
  graze.position.set(-2.8, 0.5, 0.4);
  scene.add(graze);
  if (kind === 'iri') {
    const cool = new THREE.DirectionalLight(0x88eeff, 1.8);
    cool.position.set(-2.0, 1.4, 2.0);
    scene.add(cool);
  }
  scene.userData.meshes = { mat, mesh, key, graze };
  scene.userData.kind = kind;
  // Angle slider owns the camera — leave OrbitControls off so damping
  // cannot fight shared.viewAngle (especially on short iPhone landscape).
  scene.userData.controls.enableZoom = false;
  scene.userData.controls.enableRotate = false;
  scene.userData.controls.enabled = false;
  scene.userData.update = (t, dt, shared) => {
    const ang = shared.viewAngle;
    const cam = scene.userData.camera;
    const r = 2.85;
    const elev = 0.35 + Math.sin(ang) * 0.45;
    cam.position.set(Math.cos(ang) * r, elev, Math.sin(ang) * r);
    cam.lookAt(0, 0.05, 0);
    scene.userData.controls.target.set(0, 0.05, 0);
    if (!reducedMotion) mesh.rotation.y += dt * 0.12;
    key.position.set(Math.cos(ang + 0.8) * 2.4, 2.2, Math.sin(ang + 0.8) * 2.0);
    graze.position.set(Math.cos(ang + Math.PI) * 2.8, 0.45, Math.sin(ang + Math.PI) * 1.6);
  };
  return scene;
}

makeCmpScene('cmp-sheen', 'sheen');
makeCmpScene('cmp-iri', 'iri');
makeCmpScene('cmp-satin', 'satin');

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

// —— UI: Sheen ——
const sheenMat = sheenScene.userData.meshes.mat;
const sheenAmtEl = document.getElementById('sheen-amt');
const sheenRoughEl = document.getElementById('sheen-rough');
const sheenAmtOut = document.getElementById('sheen-amt-out');
const sheenRoughOut = document.getElementById('sheen-rough-out');

function syncSheen() {
  sheenAmtOut.textContent = Number(sheenMat.sheen).toFixed(2);
  sheenRoughOut.textContent = Number(sheenMat.sheenRoughness).toFixed(2);
  sheenAmtEl.value = sheenMat.sheen;
  sheenRoughEl.value = sheenMat.sheenRoughness;
}
function onSheenAmt() { sheenMat.sheen = Number(sheenAmtEl.value); syncSheen(); }
function onSheenRough() { sheenMat.sheenRoughness = Number(sheenRoughEl.value); syncSheen(); }
sheenAmtEl.addEventListener('input', onSheenAmt);
sheenAmtEl.addEventListener('change', onSheenAmt);
sheenRoughEl.addEventListener('input', onSheenRough);
sheenRoughEl.addEventListener('change', onSheenRough);

const sheenPresets = {
  velvet: (m) => {
    m.color.set(0x3a1a58); m.sheenColor.set(0xffd8f8);
    m.sheen = 1; m.sheenRoughness = 0.35; m.roughness = 0.78; m.metalness = 0;
  },
  satin: (m) => {
    m.color.set(0x1a2840); m.sheenColor.set(0xc8e8ff);
    m.sheen = 0.85; m.sheenRoughness = 0.18; m.roughness = 0.45; m.metalness = 0;
  },
  wool: (m) => {
    m.color.set(0x4a3828); m.sheenColor.set(0xf0e0c0);
    m.sheen = 0.7; m.sheenRoughness = 0.55; m.roughness = 0.88; m.metalness = 0;
  },
};
document.querySelectorAll('[data-sheen]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.sheen;
    startDissolve(sheenMat, sheenPresets[kind]);
    syncSheen();
    document.querySelectorAll('[data-sheen]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

// —— UI: Iridescence ——
const iriMat = iriScene.userData.meshes.mat;
const iriAmtEl = document.getElementById('iri-amt');
const iriIorEl = document.getElementById('iri-ior');
const iriThickEl = document.getElementById('iri-thick');
const iriAmtOut = document.getElementById('iri-amt-out');
const iriIorOut = document.getElementById('iri-ior-out');
const iriThickOut = document.getElementById('iri-thick-out');

function syncIri() {
  iriAmtOut.textContent = Number(iriMat.iridescence).toFixed(2);
  iriIorOut.textContent = Number(iriMat.iridescenceIOR).toFixed(2);
  const mid = Math.round((iriMat.iridescenceThicknessRange[0] + iriMat.iridescenceThicknessRange[1]) / 2);
  iriThickOut.textContent = String(mid);
  iriAmtEl.value = iriMat.iridescence;
  iriIorEl.value = iriMat.iridescenceIOR;
  iriThickEl.value = mid;
}
function onIriAmt() { iriMat.iridescence = Number(iriAmtEl.value); syncIri(); }
function onIriIor() { iriMat.iridescenceIOR = Number(iriIorEl.value); syncIri(); }
function onIriThick() {
  const mid = Number(iriThickEl.value);
  // Keep a wide range so the thickness map still paints multi-hue bands
  iriMat.iridescenceThicknessRange = [Math.max(40, mid - 280), mid + 220];
  syncIri();
}
iriAmtEl.addEventListener('input', onIriAmt);
iriAmtEl.addEventListener('change', onIriAmt);
iriIorEl.addEventListener('input', onIriIor);
iriIorEl.addEventListener('change', onIriIor);
iriThickEl.addEventListener('input', onIriThick);
iriThickEl.addEventListener('change', onIriThick);

// Presets tuned for clear cyan / magenta / gold shifts
const iriPresets = {
  bubble: (m) => {
    m.color.set(0x6a7388);
    m.metalness = 0.4;
    m.roughness = 0.16;
    m.iridescence = 1;
    m.iridescenceIOR = 1.45;
    m.iridescenceThicknessRange = [70, 520];
    m.envMapIntensity = 2.9;
    m.clearcoat = 0.55;
  },
  oil: (m) => {
    m.color.set(0x3a4048);
    m.metalness = 0.55;
    m.roughness = 0.14;
    m.iridescence = 1;
    m.iridescenceIOR = 1.9;
    m.iridescenceThicknessRange = [200, 1000];
    m.envMapIntensity = 3.0;
    m.clearcoat = 0.45;
  },
  beetle: (m) => {
    m.color.set(0x1a1420);
    m.metalness = 0.8;
    m.roughness = 0.2;
    m.iridescence = 1;
    m.iridescenceIOR = 2.3;
    m.iridescenceThicknessRange = [140, 860];
    m.envMapIntensity = 2.7;
    m.clearcoat = 0.7;
  },
};
document.querySelectorAll('[data-iri]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.iri;
    startDissolve(iriMat, iriPresets[kind]);
    syncIri();
    document.querySelectorAll('[data-iri]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

// —— UI: Wax ——
const waxMat = waxScene.userData.meshes.mat;
const waxTxEl = document.getElementById('wax-tx');
const waxThickEl = document.getElementById('wax-thick');
const waxAttenEl = document.getElementById('wax-atten');
const waxTxOut = document.getElementById('wax-tx-out');
const waxThickOut = document.getElementById('wax-thick-out');
const waxAttenOut = document.getElementById('wax-atten-out');

function syncWax() {
  waxTxOut.textContent = Number(waxMat.transmission).toFixed(2);
  waxThickOut.textContent = Number(waxMat.thickness).toFixed(2);
  waxAttenOut.textContent = Number(waxMat.attenuationDistance).toFixed(2);
  waxTxEl.value = waxMat.transmission;
  waxThickEl.value = waxMat.thickness;
  waxAttenEl.value = waxMat.attenuationDistance;
}
function onWaxTx() { waxMat.transmission = Number(waxTxEl.value); syncWax(); }
function onWaxThick() { waxMat.thickness = Number(waxThickEl.value); syncWax(); }
function onWaxAtten() { waxMat.attenuationDistance = Number(waxAttenEl.value); syncWax(); }
waxTxEl.addEventListener('input', onWaxTx);
waxTxEl.addEventListener('change', onWaxTx);
waxThickEl.addEventListener('input', onWaxThick);
waxThickEl.addEventListener('change', onWaxThick);
waxAttenEl.addEventListener('input', onWaxAtten);
waxAttenEl.addEventListener('change', onWaxAtten);

const waxPresets = {
  candle: (m) => {
    m.color.set(0xf2d9a8); m.attenuationColor.set(0xe8a040);
    m.transmission = 0.65; m.thickness = 1.5; m.attenuationDistance = 0.8; m.roughness = 0.42;
  },
  jade: (m) => {
    m.color.set(0xa8e0b8); m.attenuationColor.set(0x2a8040);
    m.transmission = 0.55; m.thickness = 2.2; m.attenuationDistance = 0.55; m.roughness = 0.35;
  },
  milk: (m) => {
    m.color.set(0xe8eef5); m.attenuationColor.set(0x88a0c0);
    m.transmission = 0.75; m.thickness = 1.2; m.attenuationDistance = 1.1; m.roughness = 0.28;
  },
};
document.querySelectorAll('[data-wax]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.wax;
    startDissolve(waxMat, waxPresets[kind]);
    syncWax();
    document.querySelectorAll('[data-wax]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

// —— UI: Centerpiece ——
let orbitView = true;
const angleEl = document.getElementById('cmp-angle');
const angleOut = document.getElementById('cmp-angle-out');
const orbitEl = document.getElementById('cmp-orbit');
const orbitOut = document.getElementById('cmp-orbit-out');
const shared = { viewAngle: Number(angleEl.value) * Math.PI * 2, lightAngle: 0 };

function syncAngle() {
  const v = Number(angleEl.value);
  angleOut.textContent = v.toFixed(2);
  shared.viewAngle = v * Math.PI * 2;
}
function syncOrbit() {
  orbitView = Number(orbitEl.value) === 1;
  orbitOut.textContent = orbitView ? 'ON' : 'OFF';
}
angleEl.addEventListener('input', syncAngle);
angleEl.addEventListener('change', syncAngle);
orbitEl.addEventListener('input', syncOrbit);
orbitEl.addEventListener('change', syncOrbit);
syncAngle();
syncOrbit();

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
  tickDissolves(dt);

  if (orbitView && !reducedMotion) {
    shared.viewAngle += dt * 0.55;
    const norm = ((shared.viewAngle / (Math.PI * 2)) % 1 + 1) % 1;
    angleEl.value = norm;
    angleOut.textContent = norm.toFixed(2);
  }

  renderer.setScissorTest(false);
  renderer.setClearColor(0x0a0810, 1);
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
    if (scene.userData.update) scene.userData.update(now * 0.001, dt, shared);
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
      renderer.setClearColor(0x0a0810, 1);
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
  renderer, canvas, scenes, shared,
  get frameCount() { return frameCount; },
  get reducedMotion() { return reducedMotion; },
  get orbitView() { return orbitView; },
  webglContexts: () => document.querySelectorAll('canvas').length,
  heroPost,
};

updateSize();
renderer.setAnimationLoop(animate);
