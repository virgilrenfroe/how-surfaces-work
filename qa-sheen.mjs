/**
 * Full QA for Lesson 03 (/sheen/) on preview URL
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(process.env.PW_ROOT
  ? path.join(process.env.PW_ROOT, 'package.json')
  : import.meta.url);
const { chromium, webkit } = require('playwright');

const BASE = process.env.HSW_URL || 'https://how-surfaces-work-preview-production.up.railway.app/sheen/';
const ROOT = process.env.HSW_ROOT || 'https://how-surfaces-work-preview-production.up.railway.app/';
const L02 = 'https://how-textures-work-production.up.railway.app/';
const OUT = path.resolve('shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(id, pass, detail = '') {
  results.push({ id, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`);
}

async function sampleView(page, selector, grid = 5) {
  return page.evaluate(({ selector, grid }) => {
    const el = document.querySelector(selector);
    const canvas = document.getElementById('c');
    if (!el || !canvas) return null;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { error: 'no-gl' };
    const r = el.getBoundingClientRect();
    const sx = canvas.width / canvas.clientWidth;
    const sy = canvas.height / canvas.clientHeight;
    let nonBlank = 0;
    const patch = [];
    for (let gy = 1; gy <= grid; gy++) {
      for (let gx = 1; gx <= grid; gx++) {
        const vx = r.left + (r.width * gx) / (grid + 1);
        const vy = r.top + (r.height * gy) / (grid + 1);
        if (vx < 0 || vy < 0 || vx > canvas.clientWidth || vy > canvas.clientHeight) continue;
        const cx = Math.floor(vx * sx);
        const cy = Math.floor((canvas.clientHeight - vy) * sy);
        const p = new Uint8Array(4);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        if (!(p[0] < 28 && p[1] < 28 && p[2] < 28)) nonBlank++;
      }
    }
    const cx0 = r.left + r.width * 0.35;
    const cy0 = r.top + r.height * 0.4;
    const w = Math.min(48, r.width * 0.3);
    const h = Math.min(48, r.height * 0.3);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const vx = cx0 + (x / 15) * w;
        const vy = cy0 + (y / 15) * h;
        const cx = Math.floor(vx * sx);
        const cy = Math.floor((canvas.clientHeight - vy) * sy);
        const p = new Uint8Array(4);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        patch.push(p[0], p[1], p[2], p[3]);
      }
    }
    return { nonBlank, patch, rect: { w: r.width, h: r.height } };
  }, { selector, grid });
}

function avgDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  const n = a.length / 4;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / (n * 3);
}

async function waitReady(page) {
  await page.waitForFunction(() => window.__HSW && window.__HSW.scenes?.length >= 6, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

/** Set a range input without Playwright scrolling the control into view (which can push the 3D view off-screen on stacked mobile layouts). */
async function setRange(page, sel, val) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('missing ' + sel);
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel, val });
}

async function waitFrames(page, n = 3) {
  const prev = await page.evaluate(() => window.__HSW.frameCount);
  await page.waitForFunction((p) => window.__HSW.frameCount > p, prev + n - 1, { timeout: 8000 });
}

/** Keep a specimen view on-screen after control changes (placard fill/focus can scroll it away). */
async function ensureSceneVisible(page, scene) {
  await page.evaluate((scene) => {
    document.querySelector(`[data-scene="${scene}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, scene);
  await page.waitForFunction((scene) => {
    const el = document.querySelector(`[data-scene="${scene}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const h = window.innerHeight;
    return r.bottom > 40 && r.top < h - 40 && r.height > 40;
  }, scene, { timeout: 5000 }).catch(() => null);
  await waitFrames(page, 3);
}

async function runSuite(browserType, label, launchOpts, viewportOpts) {
  const vw = viewportOpts.viewport?.width ?? viewportOpts.width;
  const vh = viewportOpts.viewport?.height ?? viewportOpts.height;
  console.log(`\n===== ${label} ${vw}x${vh} =====`);
  const isWebKit = /webkit/i.test(label) || browserType.name?.() === 'webkit';
  const glArgs = isWebKit ? [] : [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ];
  const browser = await browserType.launch({
    ...launchOpts,
    args: [
      ...(launchOpts.args || []),
      ...glArgs,
    ],
  });
  const context = await browser.newContext({ ...viewportOpts, ignoreHTTPSErrors: false });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  const consoleMsgs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleMsgs.push(msg.text());
  });
  page.on('pageerror', (err) => consoleMsgs.push(String(err)));

  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  record(`${label}:load`, !!(resp && resp.ok()), `status=${resp?.status()}`);
  await waitReady(page);

  // one canvas
  const nCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length);
  record(`${label}:one-canvas`, nCanvas === 1, `count=${nCanvas}`);

  // no horizontal scroll
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  record(`${label}:no-hscroll`, !hScroll);

  // audience lock: no developer/status text
  const badCopy = await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    const banned = ['webgl', 'dpr', 'three.js', 'reduced-motion', 'frame rate', 'virgil', 'qa', 'context lost'];
    return banned.filter((b) => t.includes(b));
  });
  record(`${label}:audience-lock`, badCopy.length === 0, badCopy.join(','));

  // kicker
  const kicker = await page.locator('.hero-kicker').textContent();
  record(`${label}:kicker`, /Lesson 03/.test(kicker || ''), kicker?.trim());

  // specimens non-blank
  const scenes = ['hero', 'sheen', 'iridescence', 'wax', 'cmp-sheen', 'cmp-iri', 'cmp-satin'];
  for (const name of scenes) {
    await page.locator(`[data-scene="${name}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const s = await sampleView(page, `[data-scene="${name}"]`);
    record(`${label}:nonblank-${name}`, s && s.nonBlank >= 3, s ? `nonBlank=${s.nonBlank}` : 'null');
  }

  // Strict hero mask checks (same as Surfaces main QA 327c350)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-scene="hero"]');
    const canvas = document.getElementById('c');
    if (!el || !canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const sx = canvas.width / canvas.clientWidth, sy = canvas.height / canvas.clientHeight;
    const p = new Uint8Array(4);
    for (let i = 0; i < 36; i++) {
      const vx = r.left + r.width * ((i % 6) + 0.5) / 6;
      const vy = r.top + r.height * (Math.floor(i / 6) + 0.5) / 6;
      if (vx < 0 || vy < 0 || vx >= canvas.clientWidth || vy >= canvas.clientHeight) continue;
      gl.readPixels(Math.floor(vx * sx), Math.floor((canvas.clientHeight - vy) * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      if (!(p[0] < 28 && p[1] < 28 && p[2] < 28)) return true;
    }
    return false;
  }, null, { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(200);
  const heroSample = await page.evaluate(() => {
    const el = document.querySelector('[data-scene="hero"]');
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const r = el.getBoundingClientRect();
    const sx = canvas.width / canvas.clientWidth;
    const sy = canvas.height / canvas.clientHeight;
    const x0 = Math.max(0, r.left), x1 = Math.min(canvas.clientWidth, r.right);
    const y0 = Math.max(0, r.top), y1 = Math.min(canvas.clientHeight, r.bottom);
    let n = 0, ink = 0, bg = 0;
    const p = new Uint8Array(4);
    for (let gy = 0; gy < 24; gy++) {
      for (let gx = 0; gx < 24; gx++) {
        const vx = x0 + ((x1 - x0) * (gx + 0.5)) / 24;
        const vy = y0 + ((y1 - y0) * (gy + 0.5)) / 24;
        gl.readPixels(Math.floor(vx * sx), Math.floor((canvas.clientHeight - vy) * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        n++;
        if (p[0] < 28 && p[1] < 28 && p[2] < 28) bg++;
        else ink++;
      }
    }
    return { n, ink, bg, inkShare: ink / n, bgShare: bg / n };
  });
  record(`${label}:hero-nonblank`, heroSample.ink >= 20 && heroSample.inkShare >= 0.04, JSON.stringify(heroSample));
  record(`${label}:hero-background-share`, heroSample.bgShare >= 0.25, `bgShare=${heroSample.bgShare.toFixed(2)} (dots masked to the object)`);
  const maskCheck = await page.evaluate(() => {
    const store = window.__HSW || window.__HTW;
    const scene = (store.scenes || []).find((s) => s.userData?.element?.dataset?.scene === 'hero');
    const mesh = scene?.children.find((c) => c.isMesh);
    if (!mesh) return { error: 'no hero mesh' };
    const cam = scene.userData.camera;
    const el = scene.userData.element;
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const r = el.getBoundingClientRect();
    mesh.geometry.computeBoundingSphere();
    const rad = mesh.geometry.boundingSphere.radius * mesh.scale.x * 1.12;
    const c = mesh.position.clone().project(cam);
    const d = cam.position.distanceTo(mesh.position);
    const rNdc = rad / Math.sqrt(Math.max(1e-6, d * d - rad * rad)) / Math.tan((cam.fov * Math.PI) / 360);
    const cx = r.left + ((c.x + 1) / 2) * r.width;
    const cy = r.top + ((1 - c.y) / 2) * r.height;
    const rPx = (rNdc * r.height) / 2;
    const sx = canvas.width / canvas.clientWidth, sy = canvas.height / canvas.clientHeight;
    const p = new Uint8Array(4);
    let out = 0, outBg = 0, inn = 0, inInk = 0;
    for (let gy = 0; gy < 30; gy++) for (let gx = 0; gx < 30; gx++) {
      const vx = r.left + (r.width * (gx + 0.5)) / 30, vy = r.top + (r.height * (gy + 0.5)) / 30;
      if (vx < 0 || vy < 0 || vx >= canvas.clientWidth || vy >= canvas.clientHeight) continue;
      gl.readPixels(Math.floor(vx * sx), Math.floor((canvas.clientHeight - vy) * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      const dark = p[0] < 28 && p[1] < 28 && p[2] < 28;
      if (Math.hypot(vx - cx, vy - cy) > rPx) { out++; if (dark) outBg++; } else { inn++; if (!dark) inInk++; }
    }
    return { out, outBgShare: out ? outBg / out : 1, inn, inInkShare: inn ? inInk / inn : 0, circle: { cx: Math.round(cx), cy: Math.round(cy), r: Math.round(rPx) } };
  });
  record(
    `${label}:hero-mask-outside-object`,
    !maskCheck.error && maskCheck.out >= 20 && maskCheck.outBgShare >= 0.98 && maskCheck.inInkShare >= 0.08,
    JSON.stringify(maskCheck)
  );
  const boxes = await page.evaluate(() => {
    const pick = {
      glossary: '.hero-gloss',
      seriesPill: '.series-nav a',
      enterLink: '.scroll-cue a[href="#s01"]',
      heroBox: '[data-scene="hero"]',
      firstSpecimen: '#s01 .view',
    };
    const out = {};
    for (const [k, s] of Object.entries(pick)) {
      const el = document.querySelector(s);
      const r = el?.getBoundingClientRect();
      out[k] = r ? { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY } : null;
    }
    return out;
  });
  const keys = Object.keys(boxes);
  const hits = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]], b = boxes[keys[j]];
      if (!a || !b) { hits.push(`${keys[i]}|${keys[j]} missing`); continue; }
      if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) hits.push(`${keys[i]}×${keys[j]}`);
    }
  }
  record(`${label}:hero-no-overlap`, hits.length === 0, hits.length ? hits.join(', ') : `${keys.length} boxes clear`);

  // control: sheen slider changes render
  await ensureSceneVisible(page, 'sheen');
  const beforeSheen = await sampleView(page, '[data-scene="sheen"]');
  const fcSheen = await page.evaluate(() => window.__HSW.frameCount);
  await setRange(page, '#sheen-amt', 0);
  await page.waitForFunction((p) => window.__HSW.frameCount > p + 3, fcSheen, { timeout: 8000 });
  await ensureSceneVisible(page, 'sheen');
  const afterSheen = await sampleView(page, '[data-scene="sheen"]');
  const dSheen = avgDiff(beforeSheen?.patch, afterSheen?.patch);
  record(`${label}:ctrl-sheen`, dSheen > 1.5, `diff=${dSheen.toFixed(2)}`);
  await setRange(page, '#sheen-amt', 1);

  // iridescence thickness
  await ensureSceneVisible(page, 'iridescence');
  const beforeIri = await sampleView(page, '[data-scene="iridescence"]');
  const fcIri = await page.evaluate(() => window.__HSW.frameCount);
  await setRange(page, '#iri-thick', 700);
  await page.waitForFunction((p) => window.__HSW.frameCount > p + 3, fcIri, { timeout: 8000 });
  await ensureSceneVisible(page, 'iridescence');
  const afterIri = await sampleView(page, '[data-scene="iridescence"]');
  const dIri = avgDiff(beforeIri?.patch, afterIri?.patch);
  record(`${label}:ctrl-iri`, dIri > 1.0, `diff=${dIri.toFixed(2)}`);

  // wax transmission
  await ensureSceneVisible(page, 'wax');
  const beforeWax = await sampleView(page, '[data-scene="wax"]');
  const fcWax = await page.evaluate(() => window.__HSW.frameCount);
  await setRange(page, '#wax-tx', 0.05);
  await page.waitForFunction((p) => window.__HSW.frameCount > p + 3, fcWax, { timeout: 8000 });
  await ensureSceneVisible(page, 'wax');
  const afterWax = await sampleView(page, '[data-scene="wax"]');
  const dWax = avgDiff(beforeWax?.patch, afterWax?.patch);
  record(`${label}:ctrl-wax`, dWax > 1.0, `diff=${dWax.toFixed(2)}`);

  // centerpiece angle
  // On stacked mobile layouts, Playwright fill() scrolls the placard control into
  // view and can push cmp-iri above the fold — samples then read clear color and
  // avgDiff stays 0 even though shared.viewAngle updated. Set values in-page,
  // re-center the scene, and wait for frameCount to advance after input.
  await ensureSceneVisible(page, 'cmp-iri');
  await setRange(page, '#cmp-orbit', 0);
  await ensureSceneVisible(page, 'cmp-iri');
  const beforeAng = await sampleView(page, '[data-scene="cmp-iri"]');
  const fcAng = await page.evaluate(() => window.__HSW.frameCount);
  await setRange(page, '#cmp-angle', 0.85);
  await page.waitForFunction((p) => window.__HSW.frameCount > p + 3, fcAng, { timeout: 8000 });
  await ensureSceneVisible(page, 'cmp-iri');
  const afterAng = await sampleView(page, '[data-scene="cmp-iri"]');
  const dAng = avgDiff(beforeAng?.patch, afterAng?.patch);
  record(
    `${label}:ctrl-angle`,
    dAng > 1.0 && (beforeAng?.nonBlank ?? 0) >= 3 && (afterAng?.nonBlank ?? 0) >= 3,
    `diff=${dAng.toFixed(2)} beforeNB=${beforeAng?.nonBlank} afterNB=${afterAng?.nonBlank}`
  );

  // screenshot
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitReady(page);
  await page.screenshot({ path: path.join(OUT, `${label}-hero.png`) });
  await page.locator('#s01').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${label}-sheen.png`) });
  await page.locator('#s02').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${label}-iri.png`) });
  await page.locator('#s04').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${label}-center.png`) });

  // console errors (ignore swiftshader deprecation noise)
  const realErrs = consoleMsgs.filter((t) =>
    !/swiftshader|GroupMarkerNotSet|GPU stall|ReadPixels|Automatic fallback/i.test(t)
  );
  record(`${label}:no-console-errors`, realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

  await browser.close();
}

// Lesson 01 + 02 load checks (chromium desktop only)
async function checkSeriesLinks() {
  console.log('\n===== Series links =====');
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const r1 = await page.goto(ROOT, { waitUntil: 'networkidle', timeout: 60000 });
  record('series:lesson01-preview', !!(r1 && r1.ok()), `status=${r1?.status()}`);
  await page.waitForFunction(() => window.__HSW && window.__HSW.scenes?.length >= 4, null, { timeout: 45000 }).catch(() => null);
  const hasL01 = await page.evaluate(() => !!window.__HSW);
  record('series:lesson01-hsw', hasL01);
  const hasSheenLink = await page.locator('a[href="/sheen/"]').count();
  record('series:lesson01-has-sheen-nav', hasSheenLink > 0, `count=${hasSheenLink}`);

  const r2 = await page.goto(L02, { waitUntil: 'networkidle', timeout: 60000 });
  record('series:lesson02-live', !!(r2 && r2.ok()), `status=${r2?.status()}`);
  await browser.close();
}

await runSuite(chromium, 'chromium-desk', {}, { viewport: { width: 1440, height: 900 } });
await runSuite(chromium, 'chromium-phone', {}, {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
await runSuite(webkit, 'webkit-phone', {}, {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
await checkSeriesLinks();

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n==== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total ====`);
fs.writeFileSync(path.join(OUT, 'qa-summary.json'), JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail > 0 ? 1 : 0);
