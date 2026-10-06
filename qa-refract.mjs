/**
 * Full QA for Lesson 07 (/refract/)
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(process.env.PW_ROOT
  ? path.join(process.env.PW_ROOT, 'package.json')
  : import.meta.url);
const { chromium, webkit } = require('playwright');

const BASE = process.env.HSW_URL || 'http://127.0.0.1:8877/refract/';
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
    const cx0 = r.left + r.width * 0.5 - 24;
    const cy0 = r.top + r.height * 0.45 - 24;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const vx = cx0 + (x / 15) * 48;
        const vy = cy0 + (y / 15) * 48;
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

async function sampleViewAt(page, selector, ox = 0.5, oy = 0.45) {
  return page.evaluate(({ selector, ox, oy }) => {
    const el = document.querySelector(selector);
    const canvas = document.getElementById('c');
    if (!el || !canvas) return null;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { error: 'no-gl' };
    const r = el.getBoundingClientRect();
    const sx = canvas.width / canvas.clientWidth;
    const sy = canvas.height / canvas.clientHeight;
    const patch = [];
    let nonBlank = 0;
    const w = Math.min(56, r.width * 0.35);
    const h = Math.min(56, r.height * 0.35);
    const cx0 = r.left + r.width * ox - w / 2;
    const cy0 = r.top + r.height * oy - h / 2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const vx = cx0 + (x / 15) * w;
        const vy = cy0 + (y / 15) * h;
        if (vx < 0 || vy < 0 || vx > canvas.clientWidth || vy > canvas.clientHeight) {
          patch.push(0, 0, 0, 0); continue;
        }
        const cx = Math.floor(vx * sx);
        const cy = Math.floor((canvas.clientHeight - vy) * sy);
        const p = new Uint8Array(4);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        patch.push(p[0], p[1], p[2], p[3]);
        if (!(p[0] < 28 && p[1] < 28 && p[2] < 28)) nonBlank++;
      }
    }
    return { nonBlank, patch };
  }, { selector, ox, oy });
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
  await page.waitForFunction(() => window.__HSW && window.__HSW.scenes?.length >= 5, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

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

async function touchDragRange(page, sel, fromRatio, toRatio, useTouch) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, sel);
  await page.waitForTimeout(200);
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error('no box for ' + sel);
  const y = box.y + box.height / 2;
  const x0 = box.x + Math.max(4, box.width * fromRatio);
  const x1 = box.x + Math.min(box.width - 4, box.width * toRatio);
  const before = await page.evaluate((sel) => Number(document.querySelector(sel).value), sel);
  if (useTouch) {
    try {
      const client = await page.context().newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let i = 1; i <= 14; i++) {
        const x = x0 + ((x1 - x0) * i) / 14;
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach().catch(() => {});
    } catch (_) {
      await page.mouse.move(x0, y); await page.mouse.down();
      await page.mouse.move(x1, y, { steps: 14 }); await page.mouse.up();
    }
  } else {
    await page.mouse.move(x0, y); await page.mouse.down();
    await page.mouse.move(x1, y, { steps: 14 }); await page.mouse.up();
  }
  await page.waitForTimeout(120);
  const after = await page.evaluate((sel) => Number(document.querySelector(sel).value), sel);
  return { before, after };
}

async function runSuite(browserType, label, launchOpts, viewportOpts) {
  const vw = viewportOpts.viewport?.width ?? viewportOpts.width;
  const vh = viewportOpts.viewport?.height ?? viewportOpts.height;
  console.log(`\n===== ${label} ${vw}x${vh} =====`);
  const isWebKit = /webkit/i.test(label) || browserType.name?.() === 'webkit';
  const useTouch = !!viewportOpts.hasTouch;
  const glArgs = isWebKit ? [] : [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ];
  const browser = await browserType.launch({ ...launchOpts, args: [...(launchOpts.args || []), ...glArgs] });
  const context = await browser.newContext({ ...viewportOpts });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const consoleMsgs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleMsgs.push(msg.text()); });
  page.on('pageerror', (err) => consoleMsgs.push(String(err)));

  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  record(`${label}:load`, !!(resp && resp.ok()), `status=${resp?.status()}`);
  await waitReady(page);

  const nCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length);
  record(`${label}:one-canvas`, nCanvas === 1, `count=${nCanvas}`);

  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  record(`${label}:no-hscroll`, !hScroll);

  const badCopy = await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    const banned = ['webgl', 'dpr', 'three.js', 'reduced-motion', 'frame rate', 'virgil', 'qa', 'context lost', 'pmrem', 'roomenvironment'];
    return banned.filter((b) => t.includes(b));
  });
  record(`${label}:audience-lock`, badCopy.length === 0, badCopy.join(','));

  const kicker = await page.locator('.hero-kicker').textContent();
  record(`${label}:kicker`, /Lesson 07/.test(kicker || ''), kicker?.trim());

  const docTitle = await page.title();
  record(`${label}:document-title`, /Lesson 07/.test(docTitle) && !/Lesson 01/.test(docTitle), docTitle);
  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
  record(`${label}:og-title`, /Lesson 07/.test(ogTitle || '') && !/Lesson 01/.test(ogTitle || ''), ogTitle || 'missing');
  const twTitle = await page.locator('meta[name="twitter:title"]').getAttribute('content');
  record(`${label}:twitter-title`, /Lesson 07/.test(twTitle || '') && !/Lesson 01/.test(twTitle || ''), twTitle || 'missing');

  const rw = await page.evaluate(() => {
    const sec = document.getElementById('real-world');
    if (!sec) return { exists: false };
    const title = sec.querySelector('h2')?.textContent.trim();
    const items = [...sec.querySelectorAll('.real-list > li')].map((li) => ({
      setting: li.querySelector('h3')?.textContent.trim() || '',
      job: li.querySelector('.job')?.textContent.trim() || '',
      text: li.querySelector('p:not(.job)')?.textContent.trim() || '',
    }));
    const all = [...document.querySelectorAll('section')];
    const idx = all.indexOf(sec);
    const lastSpec = Math.max(...all.map((e, i) => (e.classList.contains('specimen') ? i : -1)));
    const teach = all.findIndex((e) => e.id === 'teachers');
    return { exists: true, title, items, afterSpecimens: idx > lastSpec, beforeTeachers: teach < 0 || idx < teach };
  });
  record(`${label}:rw-exists`, rw.exists && rw.title === 'Where you see this', rw.title || 'missing');
  if (rw.exists) {
    const n = rw.items.length;
    const complete = rw.items.every((it) => it.setting && it.job && /[.!?]$/.test(it.text) && it.text.split(/\s+/).length >= 12);
    record(`${label}:rw-entries`, n >= 3 && n <= 5 && complete, `count=${n}`);
    record(`${label}:rw-placement`, rw.afterSpecimens && rw.beforeTeachers);
  }

  for (const name of ['hero', 'ior', 'lens', 'prism', 'gem']) {
    await page.locator(`[data-scene="${name}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const s = await sampleView(page, `[data-scene="${name}"]`);
    record(`${label}:nonblank-${name}`, s && s.nonBlank >= 3, s ? `nonBlank=${s.nonBlank}` : 'null');
  }

  // Strict hero
  await page.locator('[data-scene="hero"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelector('[data-scene="hero"]')?.scrollIntoView({ block: 'center' });
  });
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
    for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 24; gx++) {
      const vx = x0 + ((x1 - x0) * (gx + 0.5)) / 24;
      const vy = y0 + ((y1 - y0) * (gy + 0.5)) / 24;
      gl.readPixels(Math.floor(vx * sx), Math.floor((canvas.clientHeight - vy) * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      n++;
      if (p[0] < 28 && p[1] < 28 && p[2] < 28) bg++; else ink++;
    }
    return { n, ink, bg, inkShare: ink / n, bgShare: bg / n };
  });
  record(`${label}:hero-nonblank`, heroSample.ink >= 20 && heroSample.inkShare >= 0.04, JSON.stringify(heroSample));
  record(`${label}:hero-background-share`, heroSample.bgShare >= 0.25, `bgShare=${heroSample.bgShare.toFixed(2)}`);

  const maskCheck = await page.evaluate(() => {
    const store = window.__HSW;
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
    return { out, outBgShare: out ? outBg / out : 1, inn, inInkShare: inn ? inInk / inn : 0 };
  });
  record(
    `${label}:hero-mask-outside-object`,
    !maskCheck.error && maskCheck.out >= 20 && maskCheck.outBgShare >= 0.98 && maskCheck.inInkShare >= 0.08,
    JSON.stringify(maskCheck)
  );

  const boxes = await page.evaluate(() => {
    const pick = {
      glossary: '.hero-gloss', seriesPill: '.series-nav a',
      enterLink: '.scroll-cue a[href="#s01"]', heroBox: '[data-scene="hero"]', firstSpecimen: '#s01 .view',
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

  // IOR low vs high — grid warp must differ strongly
  await ensureSceneVisible(page, 'ior');
  await setRange(page, '#ior-amt', 1.0);
  await waitFrames(page, 5);
  await ensureSceneVisible(page, 'ior');
  await page.waitForTimeout(400);
  const lowIor = await sampleViewAt(page, '[data-scene="ior"]', 0.5, 0.45);
  await setRange(page, '#ior-amt', 2.4);
  await waitFrames(page, 5);
  await ensureSceneVisible(page, 'ior');
  await page.waitForTimeout(400);
  const highIor = await sampleViewAt(page, '[data-scene="ior"]', 0.5, 0.45);
  const dIor = avgDiff(lowIor?.patch, highIor?.patch);
  record(
    `${label}:ctrl-ior-warp`,
    dIor > 8 && (lowIor?.nonBlank ?? 0) >= 3 && (highIor?.nonBlank ?? 0) >= 3,
    `diff=${dIor.toFixed(2)} lowNB=${lowIor?.nonBlank} highNB=${highIor?.nonBlank}`
  );
  await setRange(page, '#ior-amt', 1.5);

  // Lens thickness
  await ensureSceneVisible(page, 'lens');
  await setRange(page, '#lens-thick', 0.2);
  await waitFrames(page, 4);
  await ensureSceneVisible(page, 'lens');
  const beforeLens = await sampleViewAt(page, '[data-scene="lens"]', 0.5, 0.45);
  await setRange(page, '#lens-thick', 2.2);
  await waitFrames(page, 4);
  await ensureSceneVisible(page, 'lens');
  const afterLens = await sampleViewAt(page, '[data-scene="lens"]', 0.5, 0.45);
  const dLens = avgDiff(beforeLens?.patch, afterLens?.patch);
  record(`${label}:ctrl-lens-thick`, dLens > 3, `diff=${dLens.toFixed(2)}`);

  // Dispersion toggle
  await ensureSceneVisible(page, 'prism');
  const beforeDisp = await sampleViewAt(page, '[data-scene="prism"]', 0.5, 0.42);
  await page.locator('[data-disp="on"]').click();
  await waitFrames(page, 5);
  await ensureSceneVisible(page, 'prism');
  const afterDisp = await sampleViewAt(page, '[data-scene="prism"]', 0.5, 0.42);
  const dDisp = avgDiff(beforeDisp?.patch, afterDisp?.patch);
  const dispOn = await page.evaluate(() => (window.__HSW.prismScene?.userData?.meshes?.mat?.dispersion ?? 0) > 0.1);
  record(`${label}:ctrl-dispersion`, dispOn && (dDisp > 0.5 || (afterDisp?.nonBlank ?? 0) >= 3), `diff=${dDisp.toFixed(2)} dispOn=${dispOn}`);
  await page.locator('[data-disp="off"]').click();

  // Gem glass vs diamond
  await ensureSceneVisible(page, 'gem');
  await page.locator('[data-gem="glass"]').click();
  await waitFrames(page, 4);
  await ensureSceneVisible(page, 'gem');
  const beforeGem = await sampleViewAt(page, '[data-scene="gem"]', 0.5, 0.4);
  await page.locator('[data-gem="diamond"]').click();
  await waitFrames(page, 4);
  await ensureSceneVisible(page, 'gem');
  const afterGem = await sampleViewAt(page, '[data-scene="gem"]', 0.5, 0.4);
  const dGem = avgDiff(beforeGem?.patch, afterGem?.patch);
  record(`${label}:ctrl-gem`, dGem > 2, `diff=${dGem.toFixed(2)}`);

  // Touch drag IOR
  await ensureSceneVisible(page, 'ior');
  const drag = await touchDragRange(page, '#ior-amt', 0.1, 0.85, useTouch);
  record(`${label}:touch-drag-slider`, Math.abs(drag.after - drag.before) > 0.05, `before=${drag.before} after=${drag.after}`);

  // Screenshots
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitReady(page);
  await page.screenshot({ path: path.join(OUT, `${label}-hero.png`) });
  await ensureSceneVisible(page, 'ior');
  await setRange(page, '#ior-amt', 1.0);
  await waitFrames(page, 4);
  await page.screenshot({ path: path.join(OUT, `${label}-ior-low.png`) });
  await setRange(page, '#ior-amt', 2.4);
  await waitFrames(page, 4);
  await page.screenshot({ path: path.join(OUT, `${label}-ior-high.png`) });
  await ensureSceneVisible(page, 'lens');
  await page.screenshot({ path: path.join(OUT, `${label}-lens.png`) });
  await ensureSceneVisible(page, 'prism');
  await page.screenshot({ path: path.join(OUT, `${label}-prism.png`) });
  await ensureSceneVisible(page, 'gem');
  await page.screenshot({ path: path.join(OUT, `${label}-gem.png`) });
  await page.locator('#real-world').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${label}-realworld.png`) });

  const realErrs = consoleMsgs.filter((t) =>
    !/swiftshader|GroupMarkerNotSet|GPU stall|ReadPixels|Automatic fallback|dispersion/i.test(t)
  );
  record(`${label}:no-console-errors`, realErrs.length === 0, realErrs.slice(0, 3).join(' | '));
  await browser.close();
}

await runSuite(chromium, 'chromium-desk', {}, { viewport: { width: 1440, height: 900 } });
await runSuite(chromium, 'chromium-phone', {}, {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
});
await runSuite(chromium, 'chromium-phone-land', {}, {
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
});
await runSuite(webkit, 'webkit-phone', {}, {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
});

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n==== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total ====`);
fs.writeFileSync(path.join(OUT, 'qa-summary.json'), JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail > 0 ? 1 : 0);
