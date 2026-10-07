'use strict';
const CG = window.CG = {};
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const BUZZ = { tap: 8, tick: 5, select: 12, confirm: 22, success: [14, 60, 22], warn: [30, 50, 30], cue: [220, 90, 220] };
let buzzOn = true, buzzAt = 0, iosTick = null;
try { buzzOn = localStorage.getItem('cg-haptics') !== '0'; } catch (e) {}

function setBuzz(on) {
  buzzOn = on;
  try { localStorage.setItem('cg-haptics', on ? '1' : '0'); } catch (e) {}
  buzz('select', true);
}

function buzz(kind = 'tap', force) {
  const now = performance.now();
  if (!buzzOn || (!force && now - buzzAt < 40)) return;
  buzzAt = now;
  if (navigator.vibrate) { try { navigator.vibrate(BUZZ[kind] || BUZZ.tap); } catch (e) {} return; }
  if (!iosTick) {
    iosTick = document.createElement('label');
    iosTick.innerHTML = '<input type="checkbox" switch>';
    iosTick.style.display = 'none';
    document.body.appendChild(iosTick);
  }
  iosTick.click();
}

const BUZZ_ON = [
  ['confirm', '.btn-primary, #pxStart, #startBrewingBtn, .lv-cta, #brewFinishBtn, #glEndBtn, .fx-btn.dark, #rvApply, #saveReviewBtn, #shareReviewBtn'],
  ['tick', '#dialTicks [data-g], #pxDial [data-g], [data-dose], [data-adj], [data-set]'],
  ['select', '.tabbar [data-tab], .tabbar [data-feature], .lv-seg-btn, .hs-chip, [data-pat], #pxTabs [data-step], #pxWdtSeg [data-wdt], #tampSeg [data-val], #pxLevelSeg [data-level], .star, .lv-step'],
  ['tap', 'button, a, select, [data-nav], [data-open], [data-method], [data-feature], [data-bean], [data-bag], [data-try], [data-sheet], [data-sh], [data-repeat], [data-id], [role=button], .method-card, .import-row, .try-recipe-btn, .bean-row, #sheetScrim'],
];

function tlog(ev, data) {
  try {
    const list = JSON.parse(localStorage.getItem('cg-testlog') || '[]');
    list.push(Object.assign({ at: new Date().toISOString(), ev }, data));
    localStorage.setItem('cg-testlog', JSON.stringify(list.slice(-400)));
  } catch (e) {}
}

document.addEventListener('click', (e) => {
  if (currentScreen === 'coach' && CG.Coach.running) MAT.taps += 1;
  if (e.target.closest('#arRoot, #glHud')) return;
  for (const [kind, sel] of BUZZ_ON) {
    const el = e.target.closest(sel);
    if (el) return el.disabled ? undefined : buzz(kind);
  }
}, true);

const TRACK = { lib: './vendor/mindar/mindar-image.prod.js', cdn: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js', targets: 'targets/targets.mind', warmup: 3, miss: 8, minCF: 0.0003, beta: 100 };
CG.TARGETS = { dedica: 0, pourmat: 1, cupring: 2, cupring8: 3 };
const AR_FIT = { xray: 0.74, cup: 0.6, max: 2.2, ease: 0.15 };
const arScale = (cur, want) => cur ? cur + (want - cur) * AR_FIT.ease : want * 0.88;

const tk = { load: null, mod: null, buf: null, ctl: null, dims: null, video: null, box: [1, 1], index: -1, want: [], turn: 0, pose: null, last: null, onPose: null, halt: null, idle: Promise.resolve(), run: 0, failed: false };

function trackLoad() {
  if (!tk.load) {
    const targets = fetch(TRACK.targets).then((r) => { if (!r.ok) throw new Error('targets ' + r.status); return r.arrayBuffer(); });
    tk.load = Promise.all([import(TRACK.lib).catch(() => import(TRACK.cdn)), targets])
      .then(([mod, buf]) => { tk.mod = mod; tk.buf = buf; return true; })
      .catch((e) => { tk.failed = e.message || 'load'; console.warn('Tracking off:', tk.failed); return false; });
  }
  return tk.load;
}

function trackAvailable() {
  return location.protocol !== 'file:' && !tk.failed && !!window.WebGLRenderingContext;
}

function trackWhy(granted) {
  if (!granted) return 'Camera access is off. Allow the camera, then open this screen again.';
  if (location.protocol === 'file:') return 'Open the app from its web address. Tracking cannot load from a file.';
  if (!window.WebGLRenderingContext) return 'This browser has no WebGL, which tracking needs.';
  if (String(tk.failed).startsWith('targets')) return 'targets/targets.mind is missing from the site. Upload the targets folder.';
  if (tk.failed) return 'The tracking library did not load. Upload the vendor folder or check the connection.';
  return 'The camera did not start.';
}

function trackFail(root, granted, onSkip) {
  buzz('warn', true);
  root.classList.add('track-fail');
  root.querySelector('[data-why]').textContent = trackWhy(granted);
  root.querySelector('[data-skip]').onclick = () => { root.classList.remove('track-fail'); onSkip(); };
}

function videoReady(video) {
  return new Promise((ok) => {
    if (video.videoWidth) { ok(true); return; }
    video.addEventListener('loadedmetadata', () => ok(true), { once: true });
    setTimeout(() => ok(!!video.videoWidth), 6000);
  });
}

function trackUpdate(d) {
  if (d.type === 'processDone') {
    if (tk.halt) { setTimeout(tk.halt, 80); tk.halt = null; }
    if (tk.want.length > 1 && !tk.pose && tk.ctl) tk.ctl.interestedTargetIndex = tk.want[++tk.turn % tk.want.length];
    return;
  }
  if (d.type !== 'updateMatrix' || !tk.want.includes(d.targetIndex) || (!d.worldMatrix && d.targetIndex !== tk.index)) return;
  tk.index = d.targetIndex;
  tk.pose = d.worldMatrix;
  if (tk.pose) tk.last = tk.pose;
  tk.box = [tk.video.clientWidth || 1, tk.video.clientHeight || 1];
  if (tk.onPose) tk.onPose(tk.pose);
}

function trackStop() {
  tk.run += 1;
  tk.onPose = null;
  tk.index = -1;
  tk.want = [];
  tk.pose = tk.last = null;
  if (!tk.ctl || !tk.ctl.processingVideo) return;
  tk.idle = new Promise((ok) => { tk.halt = ok; setTimeout(ok, 400); });
  tk.ctl.stopProcessVideo();
}

async function trackStart(video, index, onPose) {
  trackStop();
  const run = tk.run;
  if (!trackAvailable() || !(await trackLoad()) || !(await videoReady(video))) return false;
  await tk.idle;
  if (run !== tk.run) return false;
  const w = video.videoWidth, h = video.videoHeight;
  video.width = w;
  video.height = h;
  if (!tk.ctl || tk.ctl.inputWidth !== w || tk.ctl.inputHeight !== h) {
    if (tk.ctl) tk.ctl.dispose();
    tk.ctl = new tk.mod.Controller({ inputWidth: w, inputHeight: h, warmupTolerance: TRACK.warmup, missTolerance: TRACK.miss, filterMinCF: TRACK.minCF, filterBeta: TRACK.beta, onUpdate: trackUpdate });
    tk.dims = tk.ctl.addImageTargetsFromBuffer(tk.buf).dimensions;
    tk.ctl.dummyRun(video);
  }
  if (run !== tk.run) return false;
  const want = [].concat(index);
  Object.assign(tk, { video, index: want[0], want, onPose, pose: null });
  tk.ctl.interestedTargetIndex = want[0];
  tk.ctl.processVideo(video);
  return true;
}

function trackClip(s, t, z) {
  const m = tk.pose || tk.last, p = tk.ctl.projectionMatrix, [mw, mh] = tk.dims[tk.index];
  const v = [s * mw, (1 - t) * mh, (z || 0) * mw, 1];
  const e = [0, 1, 2, 3].map((r) => m[r] * v[0] + m[r + 4] * v[1] + m[r + 8] * v[2] + m[r + 12] * v[3]);
  return [0, 1, 3].map((r) => p[r] * e[0] + p[r + 4] * e[1] + p[r + 8] * e[2] + p[r + 12] * e[3]);
}

function trackPx(s, t, z) {
  const c = trackClip(s, t, z);
  return [(1 + c[0] / c[2]) * tk.ctl.inputWidth / 2, (1 - c[1] / c[2]) * tk.ctl.inputHeight / 2];
}

function trackPoint(s, t, z) {
  const c = trackClip(s, t, z);
  const vw = tk.ctl.inputWidth, vh = tk.ctl.inputHeight, [ew, eh] = tk.box;
  const k = Math.max(ew / vw, eh / vh);
  return [ew / 2 + (c[0] / c[2]) * vw * k / 2, eh / 2 - (c[1] / c[2]) * vh * k / 2];
}

function trackFacing() {
  const m = tk.pose || tk.last, d = Math.hypot(m[12], m[13], m[14]) * Math.hypot(m[8], m[9], m[10]) || 1;
  return Math.abs(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]) / d;
}

function trackFit(w, h, map) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => trackPoint(...map(u, v)));
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, q = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + q * x3, d = y1 - y0 + g * y1, e = y3 - y0 + q * y3;
  return 'matrix3d(' + [a / w, d / w, 0, g / w, b / h, e / h, 0, q / h, 0, 0, 1, 0, x0, y0, 0, 1].map((n) => n.toFixed(6)).join(',') + ')';
}

function trackHint(el, minW) {
  if (typeof minW === 'object') minW = minW[tk.index];
  const [a, b, c, d] = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]].map(([u, v]) => trackPoint(u, v)), [mw, mh] = tk.dims[tk.index];
  const w = Math.hypot(a[0] - b[0], a[1] - b[1]) / tk.box[0], h = Math.hypot(c[0] - d[0], c[1] - d[1]) / tk.box[0];
  const tip = w < minW ? 'Move a little closer' : w > 1.2 ? 'Move back a little' : h / w < 0.42 * mh / mw ? 'Tilt the phone down more' : '';
  if (tip) el.textContent = tip;
  el.classList.toggle('show', !!tip);
}

CG.Tracker = { index: () => tk.index, px: trackPx, hint: trackHint, facing: trackFacing, load: trackLoad, available: trackAvailable, why: trackWhy, fail: trackFail, start: trackStart, stop: trackStop, point: trackPoint, fit: trackFit, box: () => tk.box };

const TUNE = { sampleHz: 15, basket: { x0: 0.28, x1: 0.72, y0: 0.24, y1: 0.60 }, flowMin: 3.2, steadyFrames: 8, idleFrames: 30, channelRatio: 1.85, channelMinAct: 4, channelHoldMs: 1300, channelClearMs: 700 };
const SW = 48, SH = 32;
const det = { canvas: null, ctx: null, prev: null, hot: -1, hotSince: 0, coolSince: 0, flagged: -1, moving: 0, still: 0, steady: false };

function readThirds(video) {
  const vw = video.videoWidth, vh = video.videoHeight, b = TUNE.basket;
  if (!vw || !vh) return null;
  if (!det.canvas) {
    det.canvas = Object.assign(document.createElement('canvas'), { width: SW, height: SH });
    det.ctx = det.canvas.getContext('2d', { willReadFrequently: true });
  }
  try { det.ctx.drawImage(video, b.x0 * vw, b.y0 * vh, (b.x1 - b.x0) * vw, (b.y1 - b.y0) * vh, 0, 0, SW, SH); } catch (e) { return null; }
  const px = det.ctx.getImageData(0, 0, SW, SH).data, lum = new Float32Array(SW * SH), act = [0, 0, 0];
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    if (det.prev) act[Math.min(2, Math.floor((i % SW) / (SW / 3)))] += Math.abs(lum[i] - det.prev[i]);
  }
  const first = !det.prev;
  det.prev = lum;
  return first ? null : act.map((a) => a / (SW * SH / 3));
}

function detectChannel(video) {
  const th = readThirds(video);
  if (!th) return null;
  const now = performance.now(), top = th.indexOf(Math.max(...th));
  const rest = th.filter((_, i) => i !== top), ratio = th[top] / ((rest[0] + rest[1]) / 2 || 0.0001);
  if (ratio >= TUNE.channelRatio && th[top] >= TUNE.channelMinAct) {
    if (det.hot !== top) { det.hot = top; det.hotSince = now; }
    det.coolSince = 0;
    if (now - det.hotSince >= TUNE.channelHoldMs) det.flagged = top;
  } else {
    det.coolSince = det.coolSince || now;
    if (now - det.coolSince >= TUNE.channelClearMs) { det.hot = -1; det.flagged = -1; }
  }
  return { mean: (th[0] + th[1] + th[2]) / 3, ratio, flagged: det.flagged >= 0, index: det.flagged };
}

function resetDetection() {
  Object.assign(det, { prev: null, hot: -1, hotSince: 0, coolSince: 0, flagged: -1 });
}

function readFlowState(sample) {
  if (sample) {
    const moving = sample.mean >= TUNE.flowMin;
    det.moving = moving ? det.moving + 1 : 0;
    det.still = moving ? 0 : det.still + 1;
    if (det.moving >= TUNE.steadyFrames) det.steady = true;
    if (det.steady && det.still >= TUNE.idleFrames) return 'ended';
  }
  return det.steady ? 'steady' : 'preinfusion';
}

const XR = {
  pre: 8000, firstDrip: 7600, idealEnd: 30000, summaryAt: 1200, finishHold: 7000,
  targetG: 36, doseG: 18, baseFlow: 1.70,
  pivotX: 200, pivotY: 451, basketUnits: 76,
  bedTop: 590, bedBot: 648, bedL: 90, bedR: 190,
  card: { x: 50, y: 100, w: 300, h: 636 },
  baseT: 0.8, standH: 636 / 300, upright: 0.6, flat: 0.75, topPx: 170,
  search: [195, 300, 1.15],
};
const EO_ANCHOR = { pump: [130, 347], block: [200, 335], group: [200, 420], release: [150, 500], cup: [200, 512], puck: [200, 451] };
const EO_SIDE = { pump: 'left', release: 'left', puck: 'left', block: 'right', group: 'right', cup: 'right' };
const STAND_MODES = [['auto', 'Auto'], ['upright', 'Upright'], ['flat', 'Flat']];

let eoRoot = null, eoVideo = null, eoEls = null, eoHost = null, eoResizeObserver = null;
let eoRunning = false, eoRaf = 0, lastSample = 0, lastFrame = 0, onEnd = null;
let basketKind = 'bottomless', aligning = false, drag = null, wide = false, lastCallouts = [];
let flagged = false, flagIndex = 1, hotSince = 0, coolSince = 0;
let grounds = [], jetEls = [], streamEls = [], dropEls = [], flowSegs = [];
let sim = null, prep = null, predicted = { time: 28, drip: 7.6 };
let trace = [], chOn = null, peakQ = 0, maxP = 0;
let pinned = false, found = false, eoRun = 0, xrS = 0, lostTimer = 0, landTimer = 0, swapping = false, xrMap = null, standMode = 'auto', upright = false, hudBox = { x: 0, y: 0, k: 1 };
let phase = 'preinfusion', onTick = null, onDone = null, doneFired = false;

const shot = { t: 0, y: 0, chNow: 0, chDmg: 0, end: null };
const view = { tx: 41, ty: 14, s: 1.30 };
const VIEW_DEFAULT = { phone: { tx: 41, ty: 14, s: 1.30 }, wide: { tx: -5, ty: 100, s: 1.0 } };
const WIDE_DETAIL = { dx: -290, dy: -60 };

let xseed = 7;
function xrnd() { xseed = (xseed * 1103515245 + 12345) % 2147483648; return xseed / 2147483648; }

function markup() {
  return `
  <div class="eo-floor" id="eoFloor"></div>
  <svg class="eo-xray" id="eoXray" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <clipPath id="eoCupClip"><path d="M172,486 H228 L222,532 H178 Z"/></clipPath>
      <clipPath id="eoTankClip"><rect x="112" y="152" width="176" height="116" rx="5"/></clipPath>
      <clipPath id="eoDetailClip"><circle cx="140" cy="620" r="68"/></clipPath>
      <linearGradient id="eoCupGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C8895A"/><stop offset="1" stop-color="#582E0E"/>
      </linearGradient>
    </defs>
    <rect class="eo-stage" x="36" y="86" width="328" height="664" rx="28"/>
    <g id="eoMachine">
      <path class="eo-hid" d="M100,130 H300 V540 H100 Z"/>
      <path class="eo-hid-soft" d="M104,146 H296"/>
      <circle class="eo-hid-soft" cx="248" cy="192" r="6.5"/>
      <circle class="eo-hid-soft" cx="268" cy="192" r="6.5"/>
      <circle class="eo-hid-soft" cx="288" cy="192" r="6.5"/>
      <rect class="eo-hid" x="112" y="152" width="176" height="116" rx="5"/>
      <g clip-path="url(#eoTankClip)"><rect class="eo-tank-water" id="eoTankWater" x="112" y="180" width="176" height="92"/></g>
      <rect class="eo-hid" x="175" y="290" width="50" height="90" rx="5"/>
      <rect class="eo-block-heat" id="eoBlockHeat" x="176" y="291" width="48" height="88" rx="5"/>
      <path class="eo-heat-wave" id="eoWave1" d="M182,306 q6,-6 12,0 t12,0"/>
      <path class="eo-heat-wave" id="eoWave2" d="M182,298 q6,-6 12,0 t12,0"/>
      <rect class="eo-hid" x="115" y="330" width="50" height="34" rx="5"/>
      <rect class="eo-pump-arm" id="eoPumpArm" x="126" y="340" width="9" height="13" rx="2"/>
      <path class="eo-hid-soft" d="M143,336 V358 M152,336 V358"/>
      <path class="eo-hid" d="M155,395 H245 V435 H155 Z"/>
      <path class="eo-hid-soft" d="M163,431 H237"/>
      <path class="eo-hid" d="M162,435 H238 L232,467 H168 Z"/>
      <rect class="eo-puck-small" x="168" y="439" width="64" height="20"/>
      <ellipse class="eo-hid" cx="200" cy="451" rx="22" ry="13"/>
      <path class="eo-hid" d="M172,486 H228 L222,532 H178 Z"/>
      <g clip-path="url(#eoCupClip)"><rect class="eo-cup-fill" id="eoCupFill" x="170" y="532" width="62" height="0"/></g>
      <path class="eo-hid-soft" d="M106,538 H294 M106,538 V556 M294,538 V556 M120,546 H280 M120,550 H280"/>
      <path class="eo-hid-soft" d="M300,352 L326,392 L326,452"/>
      <path class="eo-flow eo-steamline" d="M210,292 H288 V352 H300 L326,392"/>
      <path class="eo-flow eo-cold" id="eoFTank" d="M130,268 V347 H115"/>
      <path class="eo-flow eo-cold" id="eoFPump" d="M165,347 H190 V380"/>
      <path class="eo-flow eo-hot" id="eoFCoil" d="M190,376 V368 H182 V356 H218 V344 H182 V332 H218 V320 H182 V308 H218 V298 H200 V292"/>
      <path class="eo-flow eo-hot" id="eoFGroup" d="M200,290 V278 H240 V395"/>
      <path class="eo-flow eo-hot" id="eoFPuck" d="M180,435 V448 M200,435 V448 M220,435 V448"/>
      <path class="eo-flow eo-coffee" id="eoFSpouts" d="M190,467 V484 M210,467 V484"/>
      <path class="eo-flow eo-coffee" id="eoFBottom" d="M176,465 L194,484 M188,465 L198,484 M200,465 L202,484 M214,465 L208,484"/>
      <path class="eo-flow eo-release" id="eoFRelease" d="M150,435 V556 H240"/>
      <g id="eoAnchor">
        <path class="eo-anchor-mark" d="M168,432 h-8 v10 M232,432 h8 v10 M168,470 h-8 v-10 M232,470 h8 v-10"/>
        <circle class="eo-anchor-ring" cx="200" cy="451" r="27"/>
      </g>
    </g>
    <g id="eoDetail">
      <path class="eo-detail-lead" id="eoLeadA" d="M0,0"/>
      <path class="eo-detail-lead" id="eoLeadB" d="M0,0"/>
      <circle class="eo-detail-ring" cx="140" cy="620" r="68"/>
      <g clip-path="url(#eoDetailClip)">
        <path class="eo-basket-wall" d="M84,560 L87,700"/>
        <path class="eo-basket-wall" d="M196,560 L193,700"/>
        <line class="eo-screen-line" x1="86" y1="578" x2="194" y2="578"/>
        <g id="eoHoles"></g>
        <rect class="eo-channel-band" id="eoBand" x="120" y="590" width="34" height="58" rx="3"/>
        <g id="eoGrounds"></g>
        <line class="eo-front-line" id="eoFront" x1="88" y1="592" x2="192" y2="592"/>
        <g id="eoStreams"></g>
        <g id="eoDrops"></g>
        <path class="eo-plate" id="eoPlate" d="M88,650 H192 V658 H88 Z"/>
        <g id="eoJets"></g>
      </g>
      <text class="eo-detail-label" x="140" y="702" id="eoDetailLabel">PUCK &middot; SECTION</text>
    </g>
  </svg>
  <div class="eo-align-surface" id="eoAlignSurface"></div>
  <div class="eo-hud" id="eoHud">
    <div class="eo-align-btn" id="eoAlignBtn">Align</div>
    <div class="eo-scan"><span class="eo-scan-card"></span><span id="eoScanText">Point at Plate 01 to see inside the machine</span></div>
    <div class="track-hint" id="eoHint"></div>
    <button type="button" class="eo-stand" id="eoStandBtn">View · Auto</button>
    <div class="track-off"><b>Tracking is off</b><span data-why></span><button type="button" data-skip>Show without tracking</button></div>
    <div class="eo-gauge" id="eoGauge">
      <div class="eo-gauge-track"><div class="eo-gauge-fill" id="eoGaugeFill"></div><div class="eo-gauge-mark"></div></div>
      <div class="eo-gauge-lab"><span class="eo-gauge-val" id="eoGaugeVal">0.0</span><br>bar<span class="eo-est">est</span></div>
    </div>
    <div class="eo-flowmeter" id="eoFlowmeter">
      <div class="eo-fm-lab">Flow</div>
      <div class="eo-fm-val" id="eoFlowVal">0.00</div>
      <div class="eo-fm-bar"><span id="eoFlowBar"></span><i class="eo-fm-norm"></i></div>
    </div>
    <div class="eo-data">
      <div class="eo-dt"><div class="k">In the cup</div><div class="v"><span id="eoDYield">0</span><small id="eoDTarget"></small></div><i><span id="eoDBar"></span></i></div>
      <div class="eo-dt"><div class="k">Shot time</div><div class="v" id="eoDTime">0:00</div></div>
      <div class="eo-dt"><div class="k">Ratio</div><div class="v" id="eoDRatio">1:0.0</div></div>
      <div class="eo-dt"><div class="k">Water</div><div class="v"><span id="eoDTemp">93</span>°C<span class="eo-est">est</span></div></div>
    </div>
    <div id="eoCallouts"></div>
    <div class="eo-verdict" id="eoVerdict">
      <div class="big" id="eoVerdictBig"></div>
      <div class="sub" id="eoVerdictSub"></div>
      <div class="eo-stats">
        <div class="eo-stat"><div class="k">In the cup</div><div class="v" id="eoStatYield"></div></div>
        <div class="eo-stat"><div class="k">Shot time</div><div class="v" id="eoStatTime"></div></div>
        <div class="eo-stat"><div class="k">Ratio</div><div class="v" id="eoStatRatio"></div></div>
      </div>
      <div class="eo-hold"><span id="eoHold"></span></div>
    </div>
    <div class="eo-align-panel" id="eoAlignPanel">
      <button type="button" data-scale="-1">&minus;</button>
      <span id="eoAlignInfo"></span>
      <button type="button" data-scale="1">+</button>
    </div>
  </div>`;
}

function svgEl(name, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  setAttrs(e, attrs);
  return e;
}

function setAttrs(e, attrs) {
  for (const k in attrs) e.setAttribute(k, attrs[k]);
}

function build(container) {
  container.innerHTML = markup();
  eoEls = {};
  container.querySelectorAll('[id^=eo]').forEach((n) => { eoEls[n.id[2].toLowerCase() + n.id.slice(3)] = n; });
  flowSegs = [['fTank', 200, 1400], ['fPump', 1400, 2400], ['fCoil', 2400, 4400], ['fGroup', 4400, 5700], ['fPuck', 5700, 6500]]
    .map(([k, b0, b1]) => ({ el: eoEls[k], b0, b1, t0: b0, t1: b1 }));
  [...flowSegs.map((s) => s.el), eoEls.fSpouts, eoEls.fBottom, eoEls.fRelease].forEach((n) => { n.len = n.getTotalLength(); });
  scaleSegs();
  buildDetail();
  bindAlign();
  eoEls.standBtn.addEventListener('click', cycleStand);
  if (!eoResizeObserver && window.ResizeObserver) (eoResizeObserver = new ResizeObserver(() => layout())).observe(container);
  layout();
}

function scaleSegs() {
  const k = XR.firstDrip / 7600;
  flowSegs.forEach((s) => { s.t0 = s.b0 * k; s.t1 = s.b1 * k; });
}

function buildDetail() {
  const w = XR.bedR - XR.bedL, add = (g, name, attrs) => g.appendChild(svgEl(name, attrs));
  for (let x = 94; x <= 186; x += 8) add(eoEls.holes, 'circle', { class: 'eo-screen-hole', cx: x, cy: 578, r: 1.4 });
  jetEls = [];
  for (let x = 96; x <= 186; x += 12) jetEls.push(add(eoEls.jets, 'line', { class: 'eo-jet', x1: x, y1: 580, x2: x, y2: 590, 'stroke-width': 1.5, stroke: '#FFD79B', opacity: 0 }));
  grounds = [];
  for (let i = 0; i < 170; i++) {
    const x = XR.bedL + 4 + (i % 17) * ((w - 8) / 16) + (xrnd() - 0.5) * 3.6;
    const y = XR.bedTop + 3 + Math.floor(i / 17) * ((XR.bedBot - XR.bedTop - 6) / 9) + (xrnd() - 0.5) * 3;
    const node = add(eoEls.grounds, 'circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (1.9 + xrnd() * 1.6).toFixed(1), fill: '#6B4A32' });
    grounds.push({ node, y, third: Math.min(2, Math.floor((x - XR.bedL) / (w / 3))), last: '' });
  }
  streamEls = [0, 1, 2, 3].map(() => add(eoEls.streams, 'path', { class: 'eo-jet', d: '', opacity: 0, 'stroke-width': 2.2 }));
  dropEls = [...Array(9)].map(() => add(eoEls.drops, 'ellipse', { class: 'eo-drop', cx: 140, cy: 668, rx: 2.1, ry: 3, opacity: 0 }));
}

function layout() {
  const w = eoRoot.clientWidth, h = eoRoot.clientHeight;
  if (w < 2 || h < 2) return;
  eoEls.machine.setAttribute('transform', 'translate(' + (view.tx + XR.pivotX * (1 - view.s)).toFixed(2) + ',' + (view.ty + XR.pivotY * (1 - view.s)).toFixed(2) + ') scale(' + view.s.toFixed(3) + ')');
  layoutDetail();
  const k = Math.min(w / 390, h / 844), fit = 'translate(' + ((w - 390 * k) / 2).toFixed(1) + 'px,' + ((h - 844 * k) / 2).toFixed(1) + 'px) scale(' + k.toFixed(4) + ')';
  hudBox = { x: (w - 390 * k) / 2, y: (h - 844 * k) / 2, k };
  eoEls.hud.style.transform = wide ? '' : fit;
  const [sx, sy, ss] = XR.search;
  if (pinned && !found) eoEls.xray.style.transform = fit + ' translate(' + sx + 'px,' + sy + 'px) scale(' + ss + ') translate(-140px,-620px)';
  const px = XR.basketUnits * view.s;
  eoEls.alignInfo.textContent = '51 mm = ' + px.toFixed(0) + ' px  ·  ' + (px / 51).toFixed(2) + ' px/mm';
}

function layoutDetail() {
  const phone = !wide || pinned, d = phone ? { dx: 0, dy: 0 } : WIDE_DETAIL;
  const [a, b] = phone ? [toScreen(200, 467), toScreen(232, 462)] : [toScreen(162, 437), toScreen(168, 467)];
  const m = (p, dx) => 'M' + (p.x - dx).toFixed(1) + ',' + (p.y - d.dy).toFixed(1) + ' ';
  if (phone) eoEls.detail.removeAttribute('transform');
  else eoEls.detail.setAttribute('transform', 'translate(' + d.dx + ',' + d.dy + ')');
  eoEls.leadA.setAttribute('d', m(a, phone ? 30 : d.dx) + (phone ? 'L78,570' : 'L188,572'));
  eoEls.leadB.setAttribute('d', m(b, d.dx) + (phone ? 'L202,572' : 'L188,668'));
}

function toScreen(x, y) {
  return { x: view.tx + XR.pivotX * (1 - view.s) + x * view.s, y: view.ty + XR.pivotY * (1 - view.s) + y * view.s };
}

function bindAlign() {
  const surface = eoEls.alignSurface, end = () => { if (drag) { drag = null; saveView(); } };
  eoEls.alignBtn.addEventListener('click', () => setAligning(!aligning));
  eoEls.alignPanel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (!b) return;
    view.s = clamp(view.s + Number(b.dataset.scale) * 0.05, 0.7, 2.2);
    layout();
    saveView();
  });
  surface.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    surface.setPointerCapture(e.pointerId);
  });
  surface.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = eoRoot.getBoundingClientRect(), k = Math.min(r.width / 390, r.height / 844) || 1;
    view.tx = drag.tx + (e.clientX - drag.x) / k;
    view.ty = drag.ty + (e.clientY - drag.y) / k;
    layout();
  });
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (eoEls) layout(); });
}

function setAligning(on) {
  aligning = on;
  if (!eoEls) return;
  eoRoot.classList.toggle('aligning', on);
  eoEls.alignBtn.classList.toggle('on', on);
  paintCallouts(lastCallouts);
}

const viewKey = () => wide ? 'cg-eo-view-gl' : 'cg-eo-view';

function saveView() {
  try { localStorage.setItem(viewKey(), JSON.stringify(view)); } catch (e) {}
}

function loadView() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(viewKey())); } catch (e) {}
  const def = pinned ? { tx: 0, ty: 0, s: 1 } : VIEW_DEFAULT[wide ? 'wide' : 'phone'];
  Object.assign(view, def, !pinned && v && typeof v.s === 'number' ? { tx: v.tx, ty: v.ty, s: v.s } : {});
}

const flowNow = () => sim ? sim.flow : 0;
const pressureNow = () => sim ? sim.P : 0;

function tempNow() {
  const t = shot.t;
  if (t < 2400) return 93;
  if (t < 8000) return 93 - 0.4 * (t - 2400) / 5600;
  if (t < (shot.end || XR.idealEnd)) return 92.6 - 2 * clamp((t - 8000) / 14000) + Math.sin(t / 1400) * 0.25;
  return 91;
}

function etaMs() {
  if (shot.end) return shot.end;
  if (!sim || sim.drip === null) return predicted.time * 1000;
  return shot.t + ((XR.targetG - shot.y) / Math.max(0.1, sim.flow)) * 1000;
}

function liveChannel(res, live) {
  if (!live || basketKind !== 'bottomless') return undefined;
  return res ? clamp(((res.ratio || 0) - 1.25) / 1.5) : sim.ch;
}

function syncShot() {
  const b = basketKind === 'bottomless';
  Object.assign(shot, { t: sim.t * 1000, y: sim.y, chNow: b ? sim.ch : 0, chDmg: b ? sim.chDmg : 0, end: sim.end !== null ? sim.end * 1000 : null });
  XR.firstDrip = (sim.drip !== null ? sim.drip : predicted.drip) * 1000;
}

function stepShot(dt, liveCh) {
  const was = sim.end;
  CG.Shot.step(sim, dt / 1000, Object.assign({ live: liveCh }, CG.Wizard.mods()));
  syncShot();
  if (sim.end === null || sim.t < sim.end + 1) {
    peakQ = Math.max(peakQ, sim.flow);
    maxP = Math.max(maxP, sim.P);
    if (chOn === null && sim.ch > 0.3) chOn = sim.t;
    if (!trace.length || sim.t - trace[trace.length - 1][0] >= 0.25) trace.push([+sim.t.toFixed(2), +sim.flow.toFixed(2), +sim.P.toFixed(2), +sim.y.toFixed(1)]);
  }
  if (was === null && sim.end !== null && onEnd) onEnd(shot.t);
}

function endSim() {
  if (sim.end === null) sim.end = sim.t;
  syncShot();
  if (onEnd) onEnd(shot.t);
}

function stepBadge(now, res, live) {
  if (basketKind !== 'bottomless') { flagged = false; hotSince = 0; coolSince = 0; return; }
  if (live ? res && res.flagged : shot.chNow > 0.45) {
    hotSince = hotSince || now;
    coolSince = 0;
    if (!flagged && now - hotSince >= TUNE.channelHoldMs) {
      flagged = true;
      flagIndex = live && res && res.index >= 0 ? res.index : channelSide();
    }
  } else {
    coolSince = coolSince || now;
    hotSince = 0;
    if (flagged && now - coolSince >= TUNE.channelClearMs) flagged = false;
  }
}

const channelSide = () => CG.Wizard.on && CG.Wizard.side !== null ? CG.Wizard.side : sim.f.side;

function paintPath(node, fill, moving, now, dash, rush) {
  const s = node.style, len = node.len, run = fill >= 1 && moving;
  s.opacity = String(clamp(fill * 1.5));
  if (fill <= 0) return;
  s.strokeDasharray = fill < 1 ? len * fill + ' ' + len : run ? dash : len + ' ' + len;
  s.strokeDashoffset = run ? String(-(now * 0.055 * (rush || 1)) % 24) : '0';
}

const EO_CALLOUTS = { pump: [150, 167, 'Vibration pump'], block: [150, 167, 'Thermoblock'], group: [150, 167, 'Group head'], release: [150, 167, 'Shot ended'], cup: [150, 300, 'In the cup'], puck: [132, 540, 'Puck'] };

const box = (x, w, y) => 'left:' + x.toFixed(1) + 'px; width:' + w.toFixed(1) + 'px; top:' + y.toFixed(1) + 'px;';

function calloutPos(id, i) {
  const [x, y] = EO_CALLOUTS[id], side = EO_SIDE[id];
  if (wide || aligning) return ['', 'right'];
  if (!pinned) return ['left:' + x + 'px; top:' + y + 'px;', 'right'];
  if (!found || !xrMap) return [box(120, 150, 500 + i * 56), side + ' stack'];
  const [px, py] = CG.Tracker.point(...xrMap(...EO_ANCHOR[id])), hx = (px - hudBox.x) / hudBox.k, hy = (py - hudBox.y) / hudBox.k;
  if (side === 'left') return [box(14, Math.max(150, hx - 10), clamp(hy, 340, 584)), side];
  const l = Math.min(hx - 4, 226);
  return [box(l, 376 - l, clamp(hy, 275, 584)), side];
}

function paintCallouts(list) {
  lastCallouts = list;
  const host = eoEls.callouts, ids = list.map((c) => c.id).join();
  if (host.dataset.ids !== ids) {
    host.dataset.ids = ids;
    host.innerHTML = list.map((c) => '<div class="eo-callout"><span class="dot"></span><span class="lead"></span><div class="box"><div class="k">' + EO_CALLOUTS[c.id][2] + '</div><div class="v"></div></div></div>').join('');
  }
  list.forEach((c, i) => {
    const el = host.children[i], v = el.querySelector('.v'), [pos, side] = calloutPos(c.id, i), html = c.v + (c.est ? '<span class="eo-est">est</span>' : '');
    if (el.getAttribute('style') !== pos) el.setAttribute('style', pos);
    el.className = 'eo-callout ' + side + ' c-' + c.id;
    if (v.innerHTML !== html) v.innerHTML = html;
    v.classList.toggle('warn', !!c.warn);
  });
}

const chStrength = (bottomless) => bottomless ? clamp(shot.chNow * 0.7 + shot.chDmg * 0.5) : 0;

function paintPuck(now, bottomless) {
  const t = shot.t, soak = sim ? sim.sat : 0, strength = chStrength(bottomless), end = shot.end || XR.idealEnd;
  const baseFront = XR.bedTop + soak * (XR.bedBot - XR.bedTop), flowing = t > XR.firstDrip && t < end + 900;
  const spent = clamp(shot.y / XR.targetG), jetOn = t > 5700 && t < end, rush = 1 + 1.6 * strength, third = (XR.bedR - XR.bedL) / 3;
  jetEls.forEach((j, i) => j.setAttribute('opacity', jetOn ? String(0.3 + 0.4 * Math.abs(Math.sin(now / 190 + i))) : '0'));
  grounds.forEach((g) => {
    const hit = g.third === flagIndex, front = baseFront + (strength > 0.05 ? (hit ? 30 : -9) * strength : 0);
    const fill = g.y > front ? '#6B4A32' : strength > 0.35 && hit ? '#A2612F' : spent > 0.35 ? '#2E1B10' : '#3A2416';
    if (fill !== g.last) { g.node.setAttribute('fill', fill); g.last = fill; }
  });
  const wet = soak > 0 && soak < 1;
  setAttrs(eoEls.front, wet ? { y1: baseFront.toFixed(1), y2: baseFront.toFixed(1), opacity: '0.85' } : { opacity: '0' });
  setAttrs(eoEls.band, { x: String(XR.bedL + flagIndex * third + 2), width: String(third - 4) });
  eoEls.band.style.opacity = String(clamp(strength * 1.4));
  eoEls.plate.setAttribute('opacity', bottomless ? '0' : '.9');
  streamEls.forEach((s, i) => {
    if (!bottomless) {
      if (i > 0) { s.setAttribute('opacity', '0'); return; }
      setAttrs(s, { d: 'M140,658 V' + (XR.bedBot + 32), stroke: '#A9713F', 'stroke-width': '3.2', opacity: flowing ? '0.9' : '0' });
      return;
    }
    const x = XR.bedL + 13 + i * 25, inChannel = strength > 0.3 && Math.floor((x - XR.bedL) / third) === flagIndex;
    setAttrs(s, {
      d: 'M' + x + ',' + XR.bedBot + ' Q' + x + ',' + (XR.bedBot + 14) + ' 140,' + (XR.bedBot + 30),
      stroke: inChannel ? '#E0803F' : '#A9713F',
      'stroke-width': String(inChannel ? 2.4 + 1.6 * strength : 2.2 - 0.7 * strength),
      opacity: flowing ? String(0.5 + 0.4 * Math.abs(Math.sin(now / (220 / rush) + i))) : '0',
    });
  });
  dropEls.forEach((d, i) => {
    if (!flowing) { d.setAttribute('opacity', '0'); return; }
    const base = XR.bedBot + 24, y = base + ((now / (3.4 / rush) + i * 42) % 30);
    setAttrs(d, { cy: y.toFixed(1), cx: String(bottomless ? 140 + (i % 3 - 1) * 4 : 140), opacity: String(0.75 * (1 - (y - base) / 30)) });
  });
  return soak;
}

function paint(now) {
  const t = shot.t, bottomless = basketKind === 'bottomless', end = shot.end || XR.idealEnd, pumping = t > 200 && t < end;
  const bar = pressureNow(), temp = tempNow(), flow = flowNow(), strength = chStrength(bottomless), rushing = strength > 0.15;
  const fade = t > end ? clamp(1 - (t - end) / 1400) : 1, outFill = clamp((t - XR.firstDrip) / 1400) * (t > end + 1400 ? 0 : 1);
  flowSegs.forEach((s) => paintPath(s.el, clamp((t - s.t0) / (s.t1 - s.t0)) * fade, pumping, now, '9 13', 1 + strength));
  paintPath(eoEls.fSpouts, bottomless ? 0 : outFill, t < end + 1200, now, '7 11', 1 + strength * 1.6);
  paintPath(eoEls.fBottom, bottomless ? outFill : 0, t < end + 1200, now, '6 9', 1 + strength * 1.6);
  paintPath(eoEls.fRelease, t > end ? clamp((t - end) / 700) * clamp(1 - (t - end - 1500) / 1200) : 0, true, now, '4 6');
  const heating = t > 1800 && t < end;
  eoEls.blockHeat.classList.toggle('on', heating);
  [eoEls.wave1, eoEls.wave2].forEach((w, i) => w.setAttribute('opacity', heating ? String(0.22 + 0.34 * Math.abs(Math.sin(now / 520 + i * 1.6))) : '0'));
  setAttrs(eoEls.pumpArm, { x: String(126 + (pumping ? Math.sin(now / 22) * 2.6 : 0)), opacity: pumping ? '1' : '.35' });
  eoEls.tankWater.setAttribute('y', String(180 + shot.y * 0.06));
  const soak = paintPuck(now, bottomless), cupH = clamp(shot.y / XR.targetG) * 44;
  setAttrs(eoEls.cupFill, { y: String(532 - cupH), height: String(cupH) });
  eoEls.gauge.classList.toggle('show', bar > 0.4);
  eoEls.gaugeFill.style.height = clamp(bar / 15) * 100 + '%';
  eoEls.gaugeVal.textContent = bar.toFixed(1);
  eoEls.gaugeVal.classList.toggle('over', bar > 10.5);
  const choking = !shot.end && flow > 0.05 && flow < 1.2 && bar > 10;
  eoEls.flowmeter.classList.toggle('show', flow > 0.05);
  eoEls.flowVal.textContent = flow.toFixed(2) + ' g/s';
  eoEls.flowBar.style.width = clamp(flow / 3.6) * 100 + '%';
  [eoEls.flowVal, eoEls.flowBar].forEach((n) => { n.classList.toggle('rush', rushing); n.classList.toggle('choke', choking); });
  eoEls.anchor.style.display = aligning ? '' : 'none';
  eoEls.dYield.textContent = Math.round(shot.y);
  eoEls.dTarget.textContent = ' / ' + XR.targetG + ' g';
  eoEls.dBar.style.width = clamp(shot.y / XR.targetG) * 100 + '%';
  eoEls.dTime.textContent = mmss((shot.end || t) / 1000);
  eoEls.dRatio.textContent = '1:' + (shot.y / XR.doseG).toFixed(1);
  eoEls.dTemp.textContent = temp.toFixed(0);
  eoEls.detailLabel.textContent = wide ? 'PUCK SECTION' : bottomless ? 'PUCK · SECTION · BOTTOMLESS' : 'PUCK · SECTION · PRESSURISED';
  const k = XR.firstDrip / 7600, cup = { id: 'cup', v: shot.y.toFixed(0) + ' g', est: true };
  const onCup = (list) => pinned && found && !list.some((c) => c.id === 'cup') ? list.concat(cup) : list;
  paintCallouts(onCup(
    t < 1500 * k ? [{ id: 'pump', v: 'Priming' }]
      : t < 4400 * k ? [{ id: 'block', v: temp.toFixed(0) + '°C', est: true }]
        : t < 5700 * k ? [{ id: 'group', v: 'Water at screen' }]
          : t < XR.firstDrip ? [{ id: 'puck', v: 'Soaking · ' + Math.round(soak * 100) + '%' }]
            : shot.end ? [{ id: 'release', v: 'Pressure to tray' }, cup]
              : [flagged ? { id: 'puck', v: SIDE_NAMES[flagIndex] + ' side fast', warn: true } : choking ? { id: 'puck', v: 'Tight, resisting', warn: true } : { id: 'puck', v: 'Even flow' }, cup]));
  const done = !!shot.end && t - shot.end >= XR.summaryAt;
  if (done !== eoRoot.classList.contains('done')) {
    eoRoot.classList.toggle('done', done);
    if (done) { setAligning(false); paintSummary(); }
  }
  if (done) eoEls.hold.style.width = Math.min(1, (t - shot.end - XR.summaryAt) / (XR.finishHold - XR.summaryAt)) * 100 + '%';
}

const SIDE_NAMES = ['Left', 'Centre', 'Right'];

const VERDICT_TIP = { fast: ' Grind finer or add coffee.', long: ' Grind coarser or use less coffee.', channel: ' Stir with WDT and tamp level.', ok: ' Taste it hot.' };

function shotVerdict() {
  const v = CG.Verdict(shot.end / 1000, shot.chDmg);
  return [v.title, v.cause + VERDICT_TIP[v.kind], v.kind !== 'ok'];
}

function paintSummary() {
  const [big, sub, warn] = shotVerdict();
  eoEls.verdictBig.textContent = big;
  eoEls.verdictSub.textContent = sub;
  eoEls.verdictBig.classList.toggle('warn', warn);
  eoEls.statYield.textContent = Math.round(shot.y) + ' g';
  eoEls.statTime.textContent = mmss(shot.end / 1000);
  eoEls.statRatio.textContent = '1:' + (shot.y / XR.doseG).toFixed(1);
  eoEls.hold.style.width = '0%';
}

function frame() {
  if (!eoRunning) return;
  eoRaf = requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(120, now - lastFrame);
  const live = !pinned && eoVideo && !eoVideo.classList.contains('hidden') && eoVideo.readyState >= 2;
  let res = null;
  lastFrame = now;
  if (live && now - lastSample >= 1000 / TUNE.sampleHz) {
    lastSample = now;
    res = detectChannel(eoVideo);
    if (readFlowState(res) === 'ended' && shot.t > XR.firstDrip && !shot.end) endSim();
  }
  stepShot(dt, liveChannel(res, live));
  stepBadge(now, res, live);
  updatePhase();
  paint(now);
}

function updatePhase() {
  const since = shot.t - shot.end;
  phase = shot.end ? 'finish' : shot.t < XR.firstDrip ? 'preinfusion' : 'extraction';
  const [elapsedPhaseSec, segFill] = phase === 'preinfusion' ? [shot.t / 1000, Math.min(1, shot.t / XR.firstDrip)]
    : phase === 'extraction' ? [(shot.t - XR.firstDrip) / 1000, Math.min(0.98, shot.y / XR.targetG)]
      : [since / 1000, Math.min(1, since / XR.finishHold)];
  if (onTick) onTick({ phase, elapsedPhaseSec, segFill, running: eoRunning, totalSec: shot.t / 1000, weightG: shot.y, flowGs: flowNow(), channel: flagged ? SIDE_NAMES[flagIndex] : '' });
  if (phase === 'finish' && !doneFired && since > XR.finishHold) finishDone();
}

function finishDone() {
  doneFired = true;
  if (onDone) onDone(shot.end / 1000);
}

function resetShot() {
  resetDetection();
  CG.Wizard.reset();
  sim = CG.Shot.create(prep);
  trace = []; chOn = null; peakQ = 0; maxP = 0;
  syncShot();
  flagged = false; hotSince = 0; coolSince = 0;
  phase = 'preinfusion'; doneFired = false;
  eoRoot.classList.remove('done');
}

function runShot(on) {
  eoRunning = on;
  eoRoot.classList.toggle('running', on);
  if (!on) { cancelAnimationFrame(eoRaf); return; }
  lastFrame = performance.now();
  eoRaf = requestAnimationFrame(frame);
}

function startShot() {
  if (eoRunning) return;
  resetShot();
  lastSample = 0;
  layout();
  runShot(true);
}

function eoStart(opts) {
  eoRoot = $(opts.container);
  eoVideo = $(opts.video);
  onEnd = opts.onEnd || null;
  onTick = opts.onTick || null;
  onDone = opts.onDone || null;
  if (!eoRoot) return;
  eoHost = eoRoot.parentElement;
  if (opts.basket) basketKind = opts.basket;
  prep = opts.prep || { grind: 1, dose: 18, wdt: true, tamp: 'ideal', level: 'level' };
  predicted = CG.Puck.forecast(prep);
  XR.doseG = prep.dose;
  XR.targetG = prep.dose * 2;
  XR.firstDrip = predicted.drip * 1000;
  if (flowSegs.length) scaleSegs();
  eoRun += 1;
  pinned = !!opts.pinned;
  found = false;
  try { standMode = localStorage.getItem('cg-xray-view') || 'auto'; } catch (e) {}
  loadView();
  if (!eoEls) build(eoRoot);
  eoRoot.classList.toggle('wide', wide);
  eoRoot.classList.toggle('pinned', pinned);
  eoRoot.classList.remove('found', 'track-fail', 'running', 'upright');
  upright = false;
  eoRoot.classList.add('on');
  eoEls.xray.style.transform = '';
  eoEls.xray.getAnimations().forEach((a) => a.cancel());
  swapping = false;
  eoEls.scanText.textContent = 'Point at Plate 01 to see inside the machine';
  if (eoHost) eoHost.classList.add('eo-active');
  resetDetection();
  startShot();
}

function setFound(on) {
  tlog(on ? 'plate-found' : 'plate-lost', { t: Math.round(shot.t / 100) / 10 });
  found = on;
  eoRoot.classList.toggle('found', on);
  eoRoot.classList.add('landing');
  clearTimeout(landTimer);
  landTimer = setTimeout(() => eoRoot.classList.remove('landing'), 700);
  swapXray();
}

function swapXray() {
  const x = eoEls.xray;
  x.getAnimations().forEach((a) => a.cancel());
  const out = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
  swapping = true;
  out.onfinish = () => {
    swapping = false;
    if (!found) layout();
    else if (xrMap) x.style.transform = CG.Tracker.fit(390, 844, xrMap);
    x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    out.cancel();
  };
}

function cardLost() {
  setFound(false);
  eoEls.hint.classList.remove('show');
  eoEls.scanText.textContent = 'Point back at Plate 01';
  xrS = 0;
}

function onCard(pose) {
  clearTimeout(lostTimer);
  if (!pose) { lostTimer = setTimeout(cardLost, 2500); return; }
  if (!found) { buzz('success', true); setFound(true); }
  CG.Tracker.hint(eoEls.hint, 0.25);
  const facing = CG.Tracker.facing(), up = standMode === 'auto' ? (upright ? facing < XR.flat : facing < XR.upright) : standMode === 'upright';
  if (up !== upright) setUpright(up);
  const c = XR.card, T = XR.baseT, H = XR.standH;
  const [a, b, l, r] = up ? [[0.5, T, 0], [0.5, T, H], [0, T, 0], [1, T, 0]].map((q) => CG.Tracker.point(...q)) : [[0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]].map((q) => CG.Tracker.point(...q));
  const [bw, bh] = CG.Tracker.box(), fitH = AR_FIT.xray * bh / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), fitW = 0.9 * bw / Math.max(1, Math.hypot(l[0] - r[0], l[1] - r[1]));
  const fitTop = up && b[1] < a[1] ? (a[1] - XR.topPx) / (a[1] - b[1]) : Infinity;
  xrS = arScale(xrS, clamp(Math.min(fitH, fitW, fitTop), up ? 0.3 : 1, AR_FIT.max));
  xrMap = up
    ? (u, v) => [0.5 + ((u - c.x) / c.w - 0.5) * xrS, T, (c.y + c.h - v) / c.h * H * xrS]
    : (u, v) => [0.5 + ((u - c.x) / c.w - 0.5) * xrS, 0.5 + ((v - c.y) / c.h - 0.5) * xrS, 0];
  if (swapping) return;
  eoEls.xray.style.transform = CG.Tracker.fit(390, 844, xrMap);
  if (up) eoEls.floor.style.transform = CG.Tracker.fit(200, 100, (u, v) => [0.5 + (u / 200 - 0.5) * 1.5 * xrS, T + (v / 100 - 0.5) * 0.36 * xrS, 0]);
}

function setUpright(on) {
  upright = on;
  eoRoot.classList.toggle('upright', on);
  if (!swapping) eoEls.xray.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'cubic-bezier(.2,.8,.2,1)' });
  eoEls.standBtn.textContent = 'View · ' + (standMode === 'auto' ? 'Auto' : on ? 'Upright' : 'Flat');
}

function cycleStand() {
  standMode = STAND_MODES[(STAND_MODES.findIndex((m) => m[0] === standMode) + 1) % STAND_MODES.length][0];
  try { localStorage.setItem('cg-xray-view', standMode); } catch (e) {}
  if (standMode !== 'auto') setUpright(standMode === 'upright');
  else setUpright(upright);
}

function unpin() {
  clearTimeout(lostTimer);
  xrMap = null;
  pinned = found = false;
  eoRoot.classList.remove('pinned', 'found');
  eoEls.xray.style.transform = '';
  loadView();
  layout();
}

async function eoTrack(granted) {
  if (!pinned) return;
  const run = eoRun, ok = granted && await CG.Tracker.start(eoVideo, CG.TARGETS.dedica, onCard);
  if (!ok && run === eoRun && pinned) CG.Tracker.fail(eoRoot, granted, unpin);
}

function eoStop() {
  clearTimeout(lostTimer);
  if (eoRunning) runShot(false);
  if (pinned) CG.Tracker.stop();
  pinned = found = aligning = false;
  if (eoRoot) eoRoot.classList.remove('on', 'running', 'aligning', 'done', 'pinned', 'found', 'track-fail');
  if (eoEls) eoEls.hint.classList.remove('show');
  if (eoHost) eoHost.classList.remove('eo-active');
  resetDetection();
  eoVideo = null;
}

function eoTogglePause() {
  if (eoRunning) runShot(false);
  else if (eoRoot) runShot(true);
  return eoRunning;
}

function eoFinishNow() {
  if (!shot.end) endSim();
  else if (!doneFired) finishDone();
}

function eoSetWide(on) {
  if (wide === on) return;
  wide = on;
  setAligning(false);
  loadView();
  if (!eoEls) return;
  eoRoot.classList.toggle('wide', wide);
  layout();
  paintCallouts(lastCallouts);
}

function eoGetResult() {
  if (!shot.end) return null;
  const t = shot.end / 1000;
  return {
    weightG: Math.round(shot.y), timeSec: t, early: t < CG.SHOT.targetLo, choked: t > CG.SHOT.targetHi, prep: Object.assign({}, prep),
    model: { time: +t.toFixed(1), drip: sim.drip ?? 0, chOn, chDmg: +shot.chDmg.toFixed(2), peak: peakQ, maxP, side: channelSide(), trace: trace.slice() },
  };
}

CG.EspressoOverlay = {
  start: eoStart, stop: eoStop, getResult: eoGetResult, togglePause: eoTogglePause, finishNow: eoFinishNow, setWide: eoSetWide, setAligning, track: eoTrack,
  etaSec: () => eoRunning ? Math.max(0, (etaMs() - shot.t) / 1000) : null,
  isPinned: () => pinned,
};

const METHOD_DATA = {
  espresso: { key: 'espresso', name: 'Espresso', grind: 'Fine, like powdered sugar', dose: '18g in', yield: '36g out (1:2)', temp: '93°C',
    tips: 'Distribute and tamp level. An uneven puck channels water.',
    phases: [
      { name: 'Pre-infusion', duration: 8, cue: 'Low pressure builds. Watch for even, dark drips before the ramp-up.' },
      { name: 'Extraction', duration: 22, cue: 'Honey-thick, steady stream. Blonde streaks mean pull now.' },
      { name: 'Finish', duration: 5, cue: 'Cut the shot. Taste it hot, then adjust the grind next time.' },
    ] },
  pourover: { key: 'pourover', name: 'V60', grind: 'Medium-fine, like sea salt', dose: '22g coffee', yield: '360g water (1:16)', temp: '94°C',
    tips: 'Keep the bed level. Pour in slow, tight circles from the center out.',
    phases: [
      { name: 'Bloom', duration: 30, cue: 'Pour 2× dose, swirl once. Let CO₂ escape before continuing.' },
      { name: 'Main Pour', duration: 120, cue: 'Slow concentric pours, center to edge. Keep the bed level.' },
      { name: 'Draw-down', duration: 45, cue: 'Let the last water filter through undisturbed.' },
    ] },
  immersion: { key: 'immersion', name: 'French Press', grind: 'Coarse, like breadcrumbs', dose: '30g coffee', yield: '500g water (1:16.7)', temp: '96°C',
    tips: 'Leave it to steep. Stirring less gives a sweeter cup.',
    phases: [
      { name: 'Steep', duration: 210, cue: 'Stir gently at 30 sec, then leave undisturbed.' },
      { name: 'Break', duration: 30, cue: 'Break the crust and skim the foam off the top.' },
      { name: 'Press / Strain', duration: 30, cue: 'Press slowly and evenly so the grounds stay settled.' },
    ] },
  aeropress: { key: 'aeropress', name: 'AeroPress', grind: 'Medium-fine, like sea salt', dose: '16g coffee', yield: '220g water (1:14)', temp: '85°C',
    tips: 'Press steadily over 30 seconds. Stop when you hear the hiss.',
    phases: [
      { name: 'Steep', duration: 80, cue: 'Stir three times, then let it steep undisturbed.' },
      { name: 'Press', duration: 25, cue: 'Press slow and steady. Stop when you hear the hiss.' },
      { name: 'Finish', duration: 10, cue: 'Dilute to taste if you used the inverted method.' },
    ] },
  chemex: { key: 'chemex', name: 'Chemex', grind: 'Medium-coarse, like kosher salt', dose: '30g coffee', yield: '500g water (1:16.7)', temp: '94°C',
    tips: 'The thick filter needs a slower pour and a longer draw-down.',
    phases: [
      { name: 'Bloom', duration: 35, cue: 'Pour 2× dose, swirl once. Let CO₂ escape.' },
      { name: 'Main Pour', duration: 150, cue: 'Slow circles in stages. Let the bed settle between pours.' },
      { name: 'Draw-down', duration: 70, cue: 'The thick filter runs slow. Give it time.' },
    ] },
  mokapot: { key: 'mokapot', name: 'Moka Pot', grind: 'Fine, just coarser than espresso', dose: '18g coffee', yield: 'Fill to valve', temp: '—',
    tips: 'Keep the heat medium-low. A slow, steady flow avoids a bitter, burnt finish.',
    phases: [
      { name: 'Heat', duration: 180, cue: 'Medium-low heat, lid open so you can watch the flow.' },
      { name: 'Flow', duration: 60, cue: 'Listen for the gurgle. It means the pot is almost done.' },
      { name: 'Finish', duration: 10, cue: 'Remove from heat immediately to stop extraction.' },
    ] },
  import: { key: 'import', name: 'Import Recipe', grind: 'As specified by recipe', dose: 'From imported recipe', yield: '—', temp: '—',
    tips: "Imported from the community feed. Steps follow the author's notes.",
    phases: [
      { name: 'Bloom', duration: 30, cue: 'Follow the imported bloom instructions.' },
      { name: 'Main Pour', duration: 120, cue: 'Follow the imported pour pattern.' },
      { name: 'Draw-down', duration: 45, cue: 'Let it finish draining before serving.' },
    ] },
};

const BAG_DATA = {
  broadway: { key: 'broadway', name: 'Broadway', roastLabel: 'Dark roast', notes: ['Dark chocolate', 'Toffee', 'Spice'],
    context: 'Best with milk. Smooth and intense, with a long finish', methodKey: 'espresso',
    roastedIn: 'Roasted in Sydney, Australia', originFact: 'An intense espresso blend, built for milk' },
  decaf: { key: 'decaf', name: 'Decaf', roastLabel: 'Roast level not published', notes: ['Berries', 'Malt', 'Chocolate'],
    context: "Sourced direct at origin, unlike most decaf. Rich and smooth without the caffeine", methodKey: 'pourover',
    roastedIn: 'Roasted in Sydney, Australia', originFact: "Direct-sourced at origin, which most decaf isn't",
    originExplainer: 'Most decaf coffee is bought as already-decaffeinated green stock; this one keeps the direct farmer relationship intact.' },
};

CG.GRIND = {
  scale: [
    { um: 200, like: 'Powder, like flour' },
    { um: 280, like: 'Fine, like powdered sugar' },
    { um: 360, like: 'Just finer than table salt' },
    { um: 450, like: 'Like table salt' },
    { um: 550, like: 'Fine sand' },
    { um: 650, like: 'Sea salt' },
    { um: 750, like: 'Sea salt' },
    { um: 850, like: 'Coarse sand' },
    { um: 950, like: 'Coarse sand' },
    { um: 1050, like: 'Breadcrumbs' },
    { um: 1150, like: 'Breadcrumbs' },
    { um: 1250, like: 'Rock salt' },
  ],
  bands: [['Turk', 'Turkish', 0, 0], ['Espresso', 'espresso', 1, 2], ['Moka', 'moka pot', 3, 3], ['Aero', 'AeroPress', 4, 4],
    ['V60', 'V60', 5, 6], ['Chemex', 'Chemex', 7, 8], ['Press', 'French press', 9, 10], ['Cold', 'cold brew', 11, 11]],
  target: { espresso: 1, mokapot: 3, aeropress: 4, pourover: 5, import: 5, chemex: 7, immersion: 9 },
  band(g) { return CG.GRIND.bands.find((b) => g >= b[2] && g <= b[3]); },
};

CG.BASKET = { depthMm: 20.5, mmPerG: 0.9, swellMm: 2, looseMm: 6 };
CG.TAMP = { light: { kg: 5, r: 0.85 }, ideal: { kg: 15, r: 1 }, tight: { kg: 30, r: 1.1 } };
CG.PUMP = { qMax: 5.5, pMax: 15, opv: 10.5, r0: 6.2 };
CG.SHOT = { targetLo: 25, targetHi: 32, channeled: 0.5 };

CG.Shot = {
  base(p) {
    const B = CG.BASKET, um = CG.GRIND.scale[p.grind].um, perm = Math.pow(um / 280, 2);
    const bed = p.dose * B.mmPerG, head = B.depthMm - bed;
    const crushed = head < B.swellMm, loose = head > B.looseMm;
    const risks = [
      [!p.wdt, 0.3, 'clumps from skipping WDT'],
      [p.level === 'tilted', 0.35, 'the tilted tamp'],
      [p.tamp === 'light', 0.15, 'the light tamp'],
      [loose, 0.2, 'the low dose'],
      [crushed, 0.1, 'the puck pressing on the screen'],
      [perm > 1.4, 0.1, 'the coarse grind'],
    ].filter((r) => r[0]).sort((a, b) => b[1] - a[1]);
    const risk = Math.min(1, 0.05 + risks.reduce((n, r) => n + r[1], 0));
    return {
      um, perm, bed, head, crushed, loose, risk, top: risks.length ? risks[0][2] : '',
      res: (p.dose / 18) * CG.TAMP[p.tamp].r / perm * (crushed ? 1.15 : 1),
      channel: clamp(1.2 * risk - 0.15),
      side: p.level === 'tilted' ? 0 : (p.grind + Math.round(p.dose * 2)) % 3,
      fill: p.dose * 0.7 + Math.max(0, head) * 1.6,
      target: p.dose * 2,
    };
  },
  create(p) {
    return { f: CG.Shot.base(p), t: 0, water: 0, sat: 0, y: 0, P: 0, Q: 0, flow: 0, ch: 0, chDmg: 0, chAt: null, drip: null, end: null };
  },
  step(s, dt, mod) {
    const f = s.f, pump = CG.PUMP, m = mod || {};
    if (s.end !== null) {
      s.P = Math.max(0, s.P - dt * 11);
      s.Q = 0; s.flow = 0; s.t += dt;
      return s;
    }
    const erode = s.drip === null ? 0.08 + 0.92 * s.sat * s.sat : 1 - 0.22 * Math.min(1, s.y / (f.target * 1.1));
    const R = pump.r0 * f.res * erode * (1 - 0.5 * s.ch) * (m.resMul || 1);
    const P = Math.min(pump.opv, pump.qMax / (1 / R + pump.qMax / pump.pMax)) * Math.min(1, s.t / 1.2);
    const k = 1 - Math.exp(-dt / 0.35);
    s.P += (P - s.P) * k;
    s.Q += (P / R - s.Q) * k;
    if (s.drip === null) {
      s.water += s.Q * dt;
      s.sat = Math.min(1, s.water / f.fill);
      if (s.sat >= 1) s.drip = s.t;
    } else {
      s.flow = s.Q * Math.min(1, (s.t - s.drip) / 2);
      s.y = Math.min(f.target, s.y + s.flow * dt);
      if (s.y >= f.target) s.end = s.t;
    }
    if (s.drip === null) s.flow = 0;
    if (s.chAt === null && s.drip !== null && s.P > 6) s.chAt = s.t + 1 + 7 * (1 - f.risk);
    const want = m.force != null ? m.force : m.live != null ? m.live : s.chAt !== null && s.t >= s.chAt ? f.channel : 0;
    s.ch += (want - s.ch) * (1 - Math.exp(-dt / (want > s.ch ? 1.1 : 0.8)));
    if (s.drip !== null) s.chDmg = Math.min(1, s.chDmg + s.ch * dt / 9);
    s.t += dt;
    return s;
  },
};

CG.Shot.model = (r) => ({ time: +r.time.toFixed(1), drip: r.drip, chOn: r.chOn, chDmg: +r.chDmg.toFixed(2), side: r.f.side, peak: r.peak, maxP: r.maxP, trace: r.trace });

CG.Shot.result = (prep) => {
  const r = CG.Shot.run(prep);
  return { prep, timeSec: r.time, weightG: Math.round(r.yield), model: CG.Shot.model(r) };
};

CG.Shot.run = (p) => {
  const s = CG.Shot.create(p), trace = [];
  let peak = 0, maxP = 0, chOn = null;
  for (let i = 0; i < 1800 && (s.end === null || s.t < s.end + 1); i++) {
    CG.Shot.step(s, 0.05);
    peak = Math.max(peak, s.flow);
    maxP = Math.max(maxP, s.P);
    if (chOn === null && s.ch > 0.3) chOn = s.t;
    if (i % 5 === 4) trace.push([+s.t.toFixed(2), +s.flow.toFixed(2), +s.P.toFixed(2), +s.y.toFixed(1)]);
  }
  return { f: s.f, trace, time: s.end ?? 90, drip: s.drip ?? 0, chOn, chDmg: s.chDmg, peak, maxP, yield: s.y };
};

CG.Puck = {
  forecast(p) {
    const r = CG.Shot.run(p), f = r.f, flow = [], bar = [];
    r.trace.forEach((q, i) => { if (i % 4 === 3) { flow.push(q[1]); bar.push(q[2]); } });
    while (flow.length < 60) { flow.push(0); bar.push(Math.max(0, (bar[bar.length - 1] || 0) - 5)); }
    return Object.assign({}, f, {
      time: r.time, drip: r.drip, peak: r.peak, chDmg: r.chDmg,
      flowCurve: flow.slice(0, 60), barCurve: bar.slice(0, 60),
      riskLabel: f.risk < 0.3 ? 'Low' : f.risk < 0.55 ? 'Medium' : 'High',
      taste: CG.Puck.taste(r.time, r.chDmg),
    });
  },
  taste(t, dmg) {
    if (dmg >= CG.SHOT.channeled) return 'Sour and bitter';
    if (t < 20) return 'Sour, thin';
    if (t < CG.SHOT.targetLo) return 'Bright, light';
    if (t <= CG.SHOT.targetHi) return 'Balanced';
    if (t <= 40) return 'Heavy, bitter';
    return 'Bitter, dry';
  },
};

CG.Verdict = function verdict(t, dmg) {
  const lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi, ch = dmg >= CG.SHOT.channeled;
  if (t < lo && ch) return { kind: 'channel', title: 'Ran ' + Math.round(lo - t) + ' s fast', cause: 'A channel let the water through. Expect sour and bitter at once.' };
  if (t < lo) return { kind: 'fast', title: 'Ran ' + Math.round(lo - t) + ' s fast', cause: 'Water ran through too easily. Expect sourness.' };
  if (t > hi) return { kind: 'long', title: 'Ran ' + Math.round(t - hi) + ' s long', cause: 'Too much resistance. Expect bitterness.' };
  if (ch) return { kind: 'channel', title: 'Channeled', cause: 'Time landed, but one side ran fast.' };
  return { kind: 'ok', title: 'On target', cause: 'Ratio and time both landed.' };
};

CG.Verdict.plan = (method) => (METHOD_DATA[method] || METHOD_DATA.pourover).phases.reduce((a, p) => a + p.duration, 0);

CG.Verdict.of = (r) => {
  if (r.method === 'espresso') return CG.Verdict(r.time, r.model ? r.model.chDmg : 0);
  const plan = CG.Verdict.plan(r.method), d = r.time - plan;
  if (Math.abs(d) <= plan * 0.1) return { kind: 'ok', title: 'On time', cause: mmss(r.time) + ' total against ' + mmss(plan) + ' planned.' };
  if (d < 0) return { kind: 'fast', title: 'Ran ' + Math.round(-d) + ' s short', cause: 'Less contact time. Expect a lighter, brighter cup.' };
  return { kind: 'long', title: 'Ran ' + Math.round(d) + ' s long', cause: 'More contact time. Expect a heavier, more bitter cup.' };
};

CG.Taste = {
  predict(r) {
    if (r.method !== 'espresso') return { x: 0, y: 0 };
    const ch = r.model && r.model.chDmg >= CG.SHOT.channeled;
    return { x: ch ? -0.15 : clamp((r.time - 28) / 10, -1), y: clamp((2 - r.yield / r.dose) * 1.5 + (r.dose - 18) * 0.08, -1) };
  },
  label(t) {
    if (!t) return 'Not rated';
    const h = t.x < -0.3 ? 'Sour' : t.x > 0.3 ? 'Bitter' : '', v = t.y > 0.35 ? 'strong' : t.y < -0.35 ? 'weak' : '';
    if (!h && !v) return 'Balanced';
    return h && v ? h + ', ' + v : h || v.charAt(0).toUpperCase() + v.slice(1);
  },
};

CG.Advice = {
  next(r) {
    const p = Object.assign({}, r.prep), espresso = r.method === 'espresso', f0 = espresso ? CG.Puck.forecast(p) : null;
    const mk = (field, to, title, why) => {
      const np = field in p ? Object.assign({}, p, { [field]: to }) : p, f = espresso ? CG.Puck.forecast(np) : null;
      return { field, from: field in p ? p[field] : r[field], to, title, why, prep: np, predicted: f, next: f ? +(r.time + f.time - f0.time).toFixed(1) : null };
    };
    const keep = { field: null, title: 'Keep this recipe', why: espresso ? 'Time, ratio and taste all landed. Repeat it to check it holds.' : 'Taste landed. Repeat it to check it holds.', prep: p, predicted: f0, next: espresso ? r.time : null };
    const x = r.taste ? r.taste.x : 0, y = r.taste ? r.taste.y : 0;
    if (espresso) {
      const b = CG.Shot.base(p), lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi;
      if (r.model && r.model.chDmg >= CG.SHOT.channeled) {
        if (p.level === 'tilted') return mk('level', 'level', 'Tamp level', 'The tilted surface gave water a short path on one side.');
        if (!p.wdt) return mk('wdt', true, 'Stir with WDT', 'Clumps left loose spots that the water pushed through.');
        if (p.tamp === 'light') return mk('tamp', 'ideal', 'Tamp firmer, about 15 kg', 'A soft puck shifted when the water hit it.');
        if (b.loose) return mk('dose', 18, 'Dose up to 18 g', 'The puck sat low in the basket and turned soggy.');
      }
      if (b.crushed) return mk('dose', 19, 'Dose down to 19 g', 'The wet puck pressed into the shower screen and choked the flow.');
      if (r.time < lo || r.time > hi) {
        const dir = r.time < lo ? -1 : 1, g = clamp(p.grind + dir, 0, 11), said = 'It ran ' + r.time.toFixed(1) + ' s. ';
        if (g !== p.grind) return mk('grind', g, (dir < 0 ? 'Grind finer' : 'Grind coarser') + ', setting ' + (g + 1),
          said + (dir < 0 ? 'Finer grounds slow the water and extract more.' : 'Coarser grounds let water through faster and extract less.'));
        const d = clamp(p.dose - dir, 14, 21);
        if (d !== p.dose) return mk('dose', d, (dir < 0 ? 'Dose up to ' : 'Dose down to ') + d + ' g', said + 'The grind is at its limit. ' + (dir < 0 ? 'More coffee adds resistance.' : 'Less coffee removes resistance.'));
      }
      if (Math.abs(x) > 0.3 && r.temp) {
        const t = clamp(r.temp + (x < 0 ? 2 : -2), 88, 96);
        if (t !== r.temp) return mk('temp', t, (x < 0 ? 'Raise water to ' : 'Lower water to ') + t + ' °C',
          'Time landed but it tasted ' + (x < 0 ? 'sour' : 'bitter') + '. Keep the grind. ' + (x < 0 ? 'Hotter water extracts more.' : 'Cooler water extracts less.'));
      }
      if (Math.abs(y) > 0.3) {
        const d = clamp(p.dose + (y < 0 ? 1 : -1), 14, 21);
        if (d !== p.dose) return mk('dose', d, (y < 0 ? 'Dose up to ' : 'Dose down to ') + d + ' g', y < 0 ? 'It tasted weak. More coffee at the same ratio gives a stronger cup.' : 'It tasted heavy. Less coffee at the same ratio softens it.');
      }
      return keep;
    }
    if (Math.abs(x) > 0.25) {
      const dir = x < 0 ? -1 : 1, g = clamp(p.grind + dir, 0, 11);
      if (g !== p.grind) return mk('grind', g, (dir < 0 ? 'Grind finer' : 'Grind coarser') + ', setting ' + (g + 1), (dir < 0 ? 'It tasted sour. Finer grounds extract more.' : 'It tasted bitter. Coarser grounds extract less.'));
    }
    if (Math.abs(y) > 0.3) return { field: 'note', title: y < 0 ? 'Use a little more coffee' : 'Use a little less coffee', why: y < 0 ? 'It tasted weak. Raise the dose by about 1 g.' : 'It tasted strong. Lower the dose by about 1 g.', prep: p, predicted: null };
    return keep;
  },
  notes(r, a) {
    const out = [], d = r.roastDays;
    if (a.field === 'grind' && r.click != null) out.push('On your ' + r.grinder + ': click ' + r.click + ' → ' + (r.click + (a.to > a.from ? 1 : -1)) + '. Lower numbers grind finer.');
    if (d != null && d < 4) out.push('Beans are ' + d + ' days off roast. Gas from fresh beans pushes channels. Rest them to about 7 days.');
    if (d != null && d > 35) out.push('Beans are ' + d + ' days off roast. Older beans run faster and taste flat.');
    const best = r.method === 'espresso' && CG.Store.all().find((o) => o.id !== r.id && o.method === 'espresso' && o.grinder === r.grinder && o.verdict && o.verdict.kind === 'ok');
    if (best && best.click !== r.click) out.push('Your last on-target shot on this grinder used click ' + best.click + '.');
    return out;
  },
};

CG.GRINDERS = ['Timemore S3', '1Zpresso J Ultra', 'Niche Zero', 'DF64', 'Other'];

CG.Store = {
  key: 'cg-brews-v1', gearKey: 'cg-gear-v1', list: null,
  all() {
    const S = CG.Store;
    if (!S.list) {
      try { S.list = JSON.parse(localStorage.getItem(S.key)); } catch (e) { S.list = null; }
      if (!Array.isArray(S.list)) S.list = S.seed();
    }
    return S.list;
  },
  save() { try { localStorage.setItem(CG.Store.key, JSON.stringify(CG.Store.list)); } catch (e) {} },
  add(r) { CG.Store.all().unshift(r); CG.Store.save(); },
  remove(id) { CG.Store.list = CG.Store.all().filter((r) => r.id !== id); CG.Store.save(); },
  get(id) { return CG.Store.all().find((r) => r.id === id); },
  reset() {
    try { localStorage.removeItem(CG.Store.key); localStorage.removeItem(CG.Store.gearKey); } catch (e) {}
    CG.Store.list = CG.Store.seed();
  },
  gear() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(CG.Store.gearKey)); } catch (e) {}
    return Object.assign({ grinder: 'Timemore S3', click: 8, bean: 'broadway', roastDays: 9, temp: 93 }, g || {});
  },
  setGear(g) { try { localStorage.setItem(CG.Store.gearKey, JSON.stringify(g)); } catch (e) {} },
  judge(rec) {
    rec.verdict = CG.Verdict.of(rec);
    rec.advice = CG.Advice.next(rec);
    delete rec.advice.predicted;
    return rec;
  },
  espresso(prep, extra, daysAgo) {
    const r = CG.Shot.run(prep);
    return CG.Store.judge(Object.assign({
      id: 'seed-' + daysAgo, at: Date.now() - daysAgo * 86400000, method: 'espresso', bean: 'broadway', roastDays: Math.round(5 + daysAgo), grinder: 'Timemore S3', click: 7 + prep.grind, temp: 93,
      prep, dose: prep.dose, target: prep.dose * 2, time: +r.time.toFixed(1), yield: Math.round(r.yield), model: CG.Shot.model(r),
    }, extra));
  },
  seed() {
    const S = CG.Store, P = (grind, dose, wdt, tamp, level) => ({ grind, dose, wdt, tamp, level });
    return [
      S.espresso(P(1, 18, true, 'ideal', 'level'), { taste: { x: 0.05, y: 0.1 }, rating: 5, notes: 'Toffee and dark chocolate. Syrupy.' }, 0.9),
      S.judge({ id: 'seed-v60', at: Date.now() - 1 * 86400000 - 3600000 * 5, method: 'pourover', bean: 'decaf', roastDays: 12, grinder: 'Timemore S3', click: 18, temp: 94,
        prep: { grind: 5 }, dose: 22, target: 360, time: 195, yield: 360, model: null, taste: { x: 0.1, y: -0.15 }, rating: 4, notes: 'Berries up front, clean finish.' }),
      S.espresso(P(1, 18, false, 'ideal', 'tilted'), { taste: { x: -0.35, y: -0.4 }, rating: 3, notes: 'Thin, sharp edge. Saw a spurt on the left.' }, 3),
      S.espresso(P(2, 18, false, 'ideal', 'level'), { taste: { x: -0.7, y: -0.45 }, rating: 2, notes: 'Sour and watery.' }, 5),
      S.espresso(P(0, 18, false, 'ideal', 'level'), { taste: { x: 0.75, y: 0.5 }, rating: 2, notes: 'Bitter, dry finish. Took forever.' }, 6),
    ];
  },
};

CG.Wizard = {
  on: false, resMul: 1, force: null, side: null,
  reset() { Object.assign(CG.Wizard, { resMul: 1, force: null, side: null }); },
  mods() { return CG.Wizard.on ? { resMul: CG.Wizard.resMul, force: CG.Wizard.force } : {}; },
  cmd(c) {
    const W = CG.Wizard;
    if (!W.on) return;
    if (c === 'faster') W.resMul = Math.max(0.3, W.resMul * 0.8);
    if (c === 'slower') W.resMul = Math.min(3, W.resMul * 1.25);
    if (c === 'left' || c === 'centre' || c === 'right') { W.force = 0.9; W.side = ['left', 'centre', 'right'].indexOf(c); }
    if (c === 'clear') W.force = 0;
    if (c === 'reset') W.reset();
    if (c === 'stop' && CG.EspressoOverlay) CG.EspressoOverlay.finishNow();
  },
};

const seedFeed = [
  { user: 'Mara T.', initials: 'MT', method: 'V60', methodKey: 'pourover', time: '2h ago', notes: 'Floral and juicy. 1:16 Ethiopian natural.', rating: 5, duration: '0:32' },
  { user: 'Deshawn K.', initials: 'DK', method: 'Espresso', methodKey: 'espresso', time: '5h ago', notes: 'Dialed in at 18g/38g, 29 sec. Syrupy body.', rating: 5, duration: '0:35' },
  { user: 'Priya S.', initials: 'PS', method: 'French Press', methodKey: 'immersion', time: '1d ago', notes: 'Coarser grind fixed the bitterness. Chocolatey now.', rating: 4, duration: '4:12' },
];

const seedBeans = [
  { key: 'broadway', name: 'Broadway', origin: 'Espresso blend', process: 'Dark roast', daysOff: 9 },
  { key: 'decaf', name: 'Decaf', origin: 'Direct-sourced decaf', process: 'Filter or espresso', daysOff: 12 },
];

const mmss = (sec) => {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

const freshness = (daysOff) => {
  const f = clamp(1 - daysOff / 28);
  return { fraction: f, color: f >= 0.6 ? 'var(--teal)' : f >= 0.3 ? 'var(--caramel)' : 'var(--faint)' };
};

const createCameraController = () => {
  let stream = null, recorder = null, videoEl = null;
  const stopRecording = () => {
    if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch (e) {}
    recorder = null;
  };
  return {
    async start(video) {
      videoEl = video;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { granted: false };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (videoEl) videoEl.srcObject = stream;
        return { granted: true };
      } catch (e) {
        return { granted: false, error: e };
      }
    },
    stop() {
      stopRecording();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoEl) videoEl.srcObject = null;
      videoEl = null;
    },
    startRecording() {
      if (!stream) return false;
      try { recorder = new MediaRecorder(stream); recorder.start(); return true; } catch (e) { return false; }
    },
    stopRecording,
  };
};

const PLAY_ICON = '<i class="fa-solid fa-play icon-fa ic-ink ic-18"></i>';
const PAUSE_ICON = '<i class="fa-solid fa-pause icon-fa ic-ink ic-18"></i>';
let brewMethod = null, brewIndex = 0, brewSeconds = 0, totalElapsed = 0, brewRunning = false, brewTimer = null, onCompleteCb = null;

const currentPhase = () => brewMethod.phases[Math.min(brewIndex, brewMethod.phases.length - 1)];

function renderBrew() {
  const phase = currentPhase(), eta = brewMethod.key === 'espresso' && brewIndex === 1 && CG.EspressoOverlay ? CG.EspressoOverlay.etaSec() : null;
  $('brewPhasePillName').textContent = phase.name;
  $('brewPhasePillTime').textContent = '· ' + mmss(eta != null ? eta : phase.duration - brewSeconds);
  paintPhases(brewIndex, 1, brewMethod.phases, brewRunning);
}

function paintPhases(idx, fill, phases, running) {
  [0, 1, 2].forEach((i) => {
    const seg = $('brewSegment' + i), lab = $('brewLabel' + i), f = i < idx ? 1 : i > idx ? 0 : fill, show = i === idx || (i === 2 && idx >= 2) ? '' : 'none';
    if (seg) seg.style.background = f >= 1 ? 'var(--teal)' : f > 0 ? `linear-gradient(to right, var(--teal) ${Math.round(f * 100)}%, rgba(244,241,236,.22) ${Math.round(f * 100)}%)` : 'rgba(244,241,236,.22)';
    if (lab) { lab.textContent = phases[i].name; lab.style.color = i === idx ? '#F4F1EC' : 'rgba(244,241,236,.45)'; }
    ['', 'b'].forEach((k) => { const hub = $('brewHub' + i + k); if (hub) hub.style.display = show; });
  });
  $('brewPlayPauseIcon').innerHTML = running ? PAUSE_ICON : PLAY_ICON;
}

function tick() {
  brewSeconds += 1;
  totalElapsed += 1;
  if (brewSeconds >= currentPhase().duration) {
    if (brewIndex >= brewMethod.phases.length - 1) return finishEarly();
    brewIndex += 1;
    brewSeconds = 0;
  }
  renderBrew();
}

function startTimer() {
  clearInterval(brewTimer);
  brewTimer = setInterval(tick, 1000);
}

function stopBrew() {
  clearInterval(brewTimer);
  brewRunning = false;
}

function finishEarly() {
  stopBrew();
  if (onCompleteCb) onCompleteCb(totalElapsed);
}

function startBrew(methodKey, onComplete) {
  brewMethod = METHOD_DATA[methodKey] || METHOD_DATA.pourover;
  brewIndex = brewSeconds = totalElapsed = 0;
  brewRunning = true;
  onCompleteCb = onComplete;
  if ($('brewMethodName')) $('brewMethodName').textContent = brewMethod.name;
  startTimer();
  renderBrew();
}

function togglePause() {
  brewRunning = !brewRunning;
  if (brewRunning) startTimer(); else clearInterval(brewTimer);
  renderBrew();
}

function skipPhase() {
  if (brewIndex >= brewMethod.phases.length - 1) return;
  brewIndex += 1;
  brewSeconds = 0;
  renderBrew();
}

const Brew = { startBrew, togglePause, skipPhase, finishEarly, stopBrew };

const appState = {
  method: null, feed: [...seedFeed], beans: [...seedBeans], rating: 0, recording: true, scannedBag: null, lastEspressoResult: null,
  grind: 1, grindFor: null, dose: 18, wdt: false, tamp: 'ideal', level: 'level', step: 'grind', glasses: false,
};

const brewCamera = createCameraController(), scanCamera = createCameraController(), coachCamera = createCameraController(), getReadyCamera = createCameraController();

const starSvg = (filled) => `<i class="${filled ? 'fa-solid' : 'fa-regular'} fa-star icon-fa ic-26 ${filled ? 'ic-caramel' : 'ic-faint'}"></i>`;
const miniStarSvg = (filled) => `<i class="${filled ? 'fa-solid' : 'fa-regular'} fa-star icon-fa ic-10 ${filled ? 'ic-caramel' : 'ic-faint'}"></i>`;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => {
    const on = s.dataset.screen === name;
    if (on && !s.classList.contains('active')) s.scrollTop = 0;
    s.classList.toggle('active', on);
  });
  syncTabs(name);
  const bar = $('statusBar');
  if (bar) bar.classList.toggle('dark', name === 'brew' || name === 'coach');
  applyGlasses(name);
}

function updateMethodSelectionUI() {
  document.querySelectorAll('.method-card, .import-row').forEach((el) => {
    el.classList.toggle('selected', el.dataset.method === appState.method);
  });
  $('methodContinueBtn').disabled = !appState.method;
}

function initMethod() {
  document.querySelectorAll('.method-card, .import-row').forEach((el) => {
    el.addEventListener('click', () => {
      appState.method = el.dataset.method;
      updateMethodSelectionUI();
    });
  });
  $('moreMethodsToggle').addEventListener('click', () => {
    const grid = $('moreMethodsGrid');
    const showing = grid.classList.toggle('show');
    $('moreMethodsLabel').textContent = showing ? 'Fewer methods' : 'More methods';
  });
  $('methodContinueBtn').addEventListener('click', () => {
    if (!appState.method) return;
    renderGrind();
    showScreen('grind');
  });
  ['startBrewingBtn', 'pxStart'].forEach((id) => $(id).addEventListener('click', () => {
    startLiveBrew();
    showScreen('brew');
  }));
}

function seeded(n) {
  let x = n * 9301 + 49297;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

const GRAIN_COLS = ['#5C3D24', '#6B4A30', '#7A5334', '#4A311D', '#8C6242'];

function grain(x, y, r, rnd) {
  const n = 6 + Math.floor(rnd() * 3), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, k = r * (0.72 + rnd() * 0.38);
    pts.push((x + Math.cos(a) * k).toFixed(1) + ',' + (y + Math.sin(a) * k).toFixed(1));
  }
  return '<path d="M' + pts.join('L') + 'Z" fill="' + GRAIN_COLS[Math.floor(rnd() * GRAIN_COLS.length)] + '"/>';
}

function prepState() {
  return { grind: appState.grind, dose: appState.dose, wdt: appState.wdt, tamp: appState.tamp, level: appState.level };
}

function segOn(id, attr, val) {
  document.querySelectorAll('#' + id + ' [' + attr + ']').forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(val)));
}

const STEPS = ['grind', 'dose', 'wdt', 'tamp'];
const STEP_NAME = { grind: 'Grind', dose: 'Dose', wdt: 'WDT', tamp: 'Tamp' };
const STEP_CAPTION = {
  grind: 'Side view · grains drawn larger',
  dose: 'Side view of the basket',
  wdt: 'Side view · clumps in the bed',
  tamp: 'Side view · tamper on the puck',
};
const STEP_WHY = {
  grind: 'Water flows through the gaps between particles. Smaller particles leave smaller gaps, so water slows down and extracts more. Espresso sits around 250 to 350 µm.',
  dose: 'Coffee swells about 2 mm when it gets wet, so it needs room above the puck. More coffee also adds resistance. The shot runs longer at the same 1:2 ratio.',
  wdt: 'WDT means stirring the grounds with thin needles before you tamp. It breaks up the clumps a grinder leaves behind. Clumps pack into dense and loose spots, and water finds the loose ones first.',
  tamp: 'Tamping locks the grounds in place so water cannot move them. About 15 kg is enough. Level matters more than force: a tilted puck is thinner on one side, and water takes that short path.',
};

const px = { cur: null, goal: null, raf: 0, last: 0, off: 0, loupeOff: 0, cardOff: 0, loupeSpeed: 40, cardSpeed: 40, clumps: [], cracks: [], sig: '' };

function renderGrind() {
  const m = METHOD_DATA[appState.method] || METHOD_DATA.pourover, espresso = appState.method === 'espresso';
  const target = CG.GRIND.target[appState.method] ?? 5;
  if (appState.grindFor !== appState.method) { appState.grind = target; appState.grindFor = appState.method; appState.step = 'grind'; }
  $('grindMethodName').textContent = m.name;
  $('grindSummary').textContent = `${m.grind} · ${m.dose}`;
  $('grindTip').textContent = m.tips;
  ['grindTipRow', 'ppGrindCard', 'startBrewingBtn'].forEach((id) => $(id).classList.toggle('hidden', espresso));
  document.querySelector('[data-screen=grind] .grind-card').classList.toggle('hidden', espresso);
  $('prepCard').classList.toggle('hidden', !espresso);
  const ticks = CG.GRIND.scale.map((_, i) =>
    `<button type="button" data-g="${i}" class="${i === target ? 'target' : ''}" aria-label="Grind setting ${i + 1}"></button>`).join('');
  const bands = CG.GRIND.bands.map((b) => `<span data-band="${b[2]}" style="flex:${b[3] - b[2] + 1}">${b[0]}</span>`).join('');
  $('dialTicks').innerHTML = ticks;
  $('ppBands').innerHTML = bands;
  $('pxDial').innerHTML = ticks;
  $('pxBands').innerHTML = bands;
  px.cur = null;
  renderPrep();
  prepLoop();
}

function grindState() {
  const g = appState.grind, row = CG.GRIND.scale[g], target = CG.GRIND.target[appState.method] ?? 5;
  const here = CG.GRIND.band(g), goal = CG.GRIND.band(target), diff = g - target;
  const name = (METHOD_DATA[appState.method] || METHOD_DATA.pourover).name;
  const far = Math.abs(diff) >= 2 && here !== goal ? ` This is ${here[1]} range.` : '';
  const txt = diff === 0
    ? ['ok', `Right for ${name}.`, appState.method === 'espresso' ? 'Enough resistance for a 25 to 30 second shot.' : 'Water moves through at the pace this method needs.']
    : diff < 0
      ? ['warn', `Finer than ${name} needs.`, 'Tighter gaps slow the water and pull out more bitterness.' + far]
      : ['warn', `Coarser than ${name} needs.`, 'Wide gaps let water rush through. The cup tastes sour and thin.' + far];
  return { g, row, target, here, goal, txt, perm: Math.pow(row.um / 280, 2) };
}

function paintDial(dial, bands, gs) {
  document.querySelectorAll('#' + dial + ' [data-g]').forEach((b) => b.classList.toggle('on', +b.dataset.g === gs.g));
  document.querySelectorAll('#' + bands + ' [data-band]').forEach((b) => {
    b.classList.toggle('here', +b.dataset.band === gs.here[2]);
    b.classList.toggle('goal', +b.dataset.band === gs.goal[2] && gs.here !== gs.goal);
  });
}

function setNote(id, cls, head, body) {
  const el = $(id), html = '<b>' + head + '</b> ' + body;
  if (el.innerHTML === html) return;
  el.className = 'pp-note ' + cls;
  el.innerHTML = html;
  el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'ease-out' });
}

function stepNote(step, f, gs) {
  if (step === 'grind') return gs.txt;
  if (step === 'dose') {
    if (f.crushed) return ['warn', 'Too much coffee.', 'The wet puck presses into the shower screen and chokes the flow.'];
    if (f.loose) return ['warn', 'Too little coffee.', 'The puck sits low, turns soggy and lets water rush through.'];
    return ['ok', 'Good headspace.', 'The puck has room to swell when wet.'];
  }
  if (step === 'wdt') return appState.wdt ? ['ok', 'Even bed.', 'Water has no easy path, so it extracts the whole puck.'] : ['warn', 'Clumps left in.', 'Water finds the loose spots between them first.'];
  if (appState.level === 'tilted') return ['warn', 'Tilted surface.', 'The low side is thinner, so water rushes through it and channels.'];
  return {
    light: ['warn', 'Too soft.', 'Loose grounds shift when water hits and open gaps.'],
    ideal: ['ok', 'Firm enough.', 'The grounds are locked in place.'],
    tight: ['ok', 'More force, little gain.', 'Past 15 kg the puck barely compresses. Keep it level.'],
  }[appState.tamp];
}

function renderPrep() {
  const gs = grindState();
  paintDial('dialTicks', 'ppBands', gs);
  $('ppGrindLike').textContent = gs.row.like;
  $('ppGrindVal').textContent = `Setting ${gs.g + 1} · ~${gs.row.um} µm`;
  $('ppGrains').style.transform = `scale(${(gs.row.um / 200).toFixed(3)})`;
  px.cardSpeed = 34 * gs.perm;
  setNote('ppGrindNote', ...gs.txt);
  if (appState.method !== 'espresso') return;

  const f = CG.Puck.forecast(prepState()), step = appState.step;
  $('pxSvg').dataset.step = step;
  $('pxCaption').textContent = STEP_CAPTION[step];
  paintDial('pxDial', 'pxBands', gs);
  $('pxGrindVal').textContent = `Setting ${gs.g + 1} · ~${gs.row.um} µm`;
  $('pxLike').textContent = gs.row.like;
  $('pxLoupeGrains').style.transform = `scale(${(gs.row.um / 200).toFixed(3)})`;
  px.loupeSpeed = 34 * gs.perm;
  $('pxDoseNum').textContent = appState.dose.toFixed(1) + ' g';
  $('pxRatio').textContent = `${appState.dose.toFixed(1)} g in, ${(appState.dose * 2).toFixed(0)} g out (1:2)`;
  segOn('pxWdtSeg', 'data-wdt', appState.wdt ? 1 : 0);
  segOn('tampSeg', 'data-val', appState.tamp);
  segOn('pxLevelSeg', 'data-level', appState.level);

  const i = STEPS.indexOf(step);
  $('pxPill').style.transform = `translateX(${i * 100}%)`;
  const status = { grind: gs.g === gs.target, dose: !f.crushed && !f.loose, wdt: appState.wdt, tamp: appState.level === 'level' && appState.tamp !== 'light' };
  document.querySelectorAll('#pxTabs [data-step]').forEach((b) => {
    b.classList.toggle('on', b.dataset.step === step);
    b.querySelector('i').className = status[b.dataset.step] ? 'ok' : 'warn';
  });
  document.querySelectorAll('#pxPanel [data-panel]').forEach((el) => el.classList.toggle('on', el.dataset.panel === step));
  setNote('pxNote', ...stepNote(step, f, gs));
  $('pxWhyText').textContent = STEP_WHY[step];
  $('pxNext').textContent = i < 3 ? 'Next: ' + STEP_NAME[STEPS[i + 1]] + ' →' : '';
  $('pxNext').classList.toggle('hidden', i >= 3);

  $('pxClumps').style.opacity = appState.wdt ? '0' : '1';
  $('pxTopClumps').style.opacity = appState.wdt ? '0' : '1';
  $('pxTopEven').style.opacity = appState.wdt ? '1' : '.35';
  $('pxSpiral').style.strokeDashoffset = appState.wdt ? '0' : '1400';
  $('pxSpiral').style.opacity = appState.wdt ? '.6' : '0';
  $('pxCracks').style.opacity = appState.tamp === 'light' ? '1' : '0';
  $('pxHot').style.opacity = appState.level === 'tilted' ? '1' : '0';
  $('pxSpurt').style.opacity = f.risk >= 0.55 ? '1' : '0';

  const t = f.time;
  const tcls = t >= 25 && t <= 32 ? 'ok' : t >= 20 && t <= 40 ? 'mid' : 'warn';
  $('pxFcRisk').textContent = 'Channel risk ' + f.riskLabel.toLowerCase();
  $('pxFcRisk').className = 'px-chip ' + { Low: 'ok', Medium: 'mid', High: 'warn' }[f.riskLabel];
  $('pxFcTaste').textContent = f.taste;
  $('pxFcTaste').className = 'px-taste ' + (f.taste === 'Balanced' ? 'ok' : f.risk >= 0.55 || t < 20 || t > 40 ? 'warn' : 'mid');
  $('pxFcTime').dataset.cls = tcls;
  const line = (arr, max) => arr.map((v, j) => (j ? 'L' : 'M') + ((j + 1) * 5) + ',' + (43 - Math.min(1, v / max) * 40).toFixed(1)).join(' ');
  [['pxChartQ', f.flowCurve, 4.5], ['pxChartP', f.barCurve, 12]].forEach(([id, arr, max]) => {
    const d = 'M0,43 ' + line(arr, max).slice(1);
    $(id).setAttribute('d', d);
    $(id).style.d = 'path("' + d + '")';
  });
  $('pxChartEnd').style.transform = `translateX(${(Math.min(60, t) * 5).toFixed(1)}px)`;
  const tips = [];
  if (t < 25) tips.push('Runs fast. Grind finer or add coffee.');
  if (t > 32) tips.push('Runs slow. Grind coarser or use less coffee.');
  if (f.risk >= 0.3) tips.push(`Biggest risk: ${f.top}.`);
  $('pxFcTip').textContent = tips.length ? tips.join(' ') : 'Dialled in. Start the shot.';
  const sig = Math.round(t) + f.riskLabel + f.taste;
  if (px.sig && sig !== px.sig) {
    const fc = document.querySelector('.px-fc');
    fc.classList.remove('pulse');
    void fc.offsetWidth;
    fc.classList.add('pulse');
  }
  px.sig = sig;

  px.goal = {
    top: 166 - f.bed * 6 + { light: -3, ideal: 0, tight: 1.5 }[appState.tamp],
    dy: appState.level === 'tilted' ? 6 : 0,
    grain: (2.2 + gs.g * 0.75) / 4,
    kg: CG.TAMP[appState.tamp].kg,
    speed: clamp(60 * 28 / t, 8, 240),
    drip: clamp(3.2 * 28 / t, 1.4, 6),
    hit: f.crushed ? 1 : 0,
    head: f.head,
    time: t,
  };
  if (!px.cur) px.cur = Object.assign({}, px.goal);
}

function drawHero(c) {
  const L = c.top + c.dy, R = c.top - c.dy, surf = (x) => L + (R - L) * (x - 20) / 200;
  $('pxBed').setAttribute('d', `M20,${L.toFixed(2)} L220,${R.toFixed(2)} L220,172 L20,172 Z`);
  $('pxGrains').setAttribute('patternTransform', `scale(${c.grain.toFixed(3)})`);
  $('pxHit').setAttribute('height', (Math.max(0, c.top - 40) * c.hit).toFixed(2));
  px.clumps.forEach((k) => {
    const x = 48 + k.u * 144, y = surf(x) + 7 + k.v * Math.max(0, 158 - surf(x));
    k.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  });
  px.cracks.forEach((k) => {
    const x = 60 + k.u * 120, y = surf(x) + 8 + k.v * 50;
    k.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${k.a})`);
  });
  document.querySelectorAll('#pxWater line').forEach((l) => {
    const x = +l.getAttribute('x1');
    l.setAttribute('y1', surf(x).toFixed(1));
  });
  document.querySelectorAll('#pxDrips line').forEach((l) => l.setAttribute('stroke-width', (l.classList.contains('hot') ? c.drip * 1.7 : c.drip).toFixed(2)));
  const sw = c.top - 12;
  $('pxSwell').setAttribute('y1', sw.toFixed(1));
  $('pxSwell').setAttribute('y2', sw.toFixed(1));
  $('pxSwellTxt').setAttribute('y', (sw - 4).toFixed(1));
  $('pxSwellTxt').style.opacity = String(1 - c.hit);
  $('pxDim').setAttribute('d', `M214,44 H222 M218,44 V${c.top.toFixed(1)} M214,${c.top.toFixed(1)} H222`);
  $('pxHeadNum').textContent = c.head.toFixed(1) + ' mm';
  $('pxHeadNum').style.fill = c.head < CG.BASKET.swellMm ? '#A8492F' : c.head > CG.BASKET.looseMm ? '#A86A34' : '#12664D';
  const ang = Math.atan2(R - L, 200) * 180 / Math.PI;
  $('pxTamper').setAttribute('transform', `translate(0 ${(c.top - 44).toFixed(2)}) rotate(${ang.toFixed(2)} 120 44)`);
  const h = c.kg / 35 * 118;
  $('pxGauge').setAttribute('y', (118 - h).toFixed(1));
  $('pxGauge').setAttribute('height', h.toFixed(1));
  $('pxGaugeTxt').textContent = Math.round(c.kg) + ' kg';
  const time = $('pxFcTime');
  time.textContent = '~' + Math.round(c.time) + ' s';
  time.style.color = { ok: '#12664D', mid: '#A86A34', warn: '#A8492F' }[time.dataset.cls] || '';
}

function prepLoop() {
  if (px.raf) return;
  px.last = performance.now();
  const tick = (now) => {
    if (!document.querySelector('[data-screen=grind]').classList.contains('active') && px.last) {
      px.raf = 0;
      return;
    }
    const dt = Math.min(64, now - px.last) / 1000, k = 1 - Math.exp(-dt / 0.14);
    px.last = now;
    if (px.cur && px.goal && appState.method === 'espresso') {
      for (const key in px.goal) px.cur[key] += (px.goal[key] - px.cur[key]) * k;
      px.off += px.cur.speed * dt;
      drawHero(px.cur);
      document.querySelectorAll('#pxWater line, #pxDrips line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.off + i * 7)); });
    }
    px.loupeOff += px.loupeSpeed * dt;
    px.cardOff += px.cardSpeed * dt;
    document.querySelectorAll('#pxLoupeWater line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.loupeOff + i * 7)); });
    document.querySelectorAll('#ppGrindWater line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.cardOff + i * 7)); });
    px.raf = requestAnimationFrame(tick);
  };
  px.raf = requestAnimationFrame(tick);
}

function grainField(x0, y0, x1, y1, d, seed) {
  const rnd = seeded(seed);
  let out = '';
  for (let y = y0, r = 0; y < y1; y += d * 0.86, r++) {
    for (let x = x0 + (r % 2) * d * 0.5; x < x1; x += d * 1.02) {
      out += grain(x + (rnd() - 0.5) * d * 0.25, y + (rnd() - 0.5) * d * 0.25, d * (0.4 + rnd() * 0.14), rnd);
      if (rnd() < 0.22) out += grain(x + d * 0.5, y + d * 0.42, d * 0.18, rnd);
    }
  }
  return out;
}

function buildPrepArt() {
  $('ppGrains').innerHTML = grainField(-12, -10, 334, 162, 10, 5);
  $('ppGrindWater').innerHTML = Array.from({ length: 10 }, (_, i) => `<line x1="${16 + i * 32}" y1="-20" x2="${16 + i * 32}" y2="170"/>`).join('');
  $('pxLoupeGrains').innerHTML = grainField(216, 38, 338, 160, 10, 9);
  $('pxLoupeWater').innerHTML = Array.from({ length: 5 }, (_, i) => `<line x1="${238 + i * 19}" y1="40" x2="${238 + i * 19}" y2="156"/>`).join('');
  $('pxGrains').innerHTML = '<rect width="30" height="30" fill="#6B4A30"/>' + grainField(-4, -4, 34, 34, 4, 13).replace(/#6B4A30/g, '#7A5334');
  $('pxWater').innerHTML = [60, 84, 108, 132, 156, 180].map((x) => `<line x1="${x}" y1="60" x2="${x}" y2="168"/>`).join('')
    + '<g id="pxHot">' + [60, 84].map((x) => `<line class="hot" x1="${x}" y1="60" x2="${x}" y2="168" style="stroke-width:4.4"/>`).join('') + '</g>';
  $('pxDrips').innerHTML = [106, 120, 134].map((x) => `<line x1="${x}" y1="174" x2="${x + (x - 120) * 0.2}" y2="212"/>`).join('')
    + `<g id="pxSpurt"><line class="hot" x1="84" y1="174" x2="74" y2="212"/></g>`;
  const rnd = seeded(41);
  px.clumps = [];
  let clumps = '';
  for (let i = 0; i < 12; i++) clumps += `<g data-k="${i}">` + (i < 8 ? grain(0, 0, 4 + rnd() * 5, rnd).replace(/fill="[^"]+"/, 'fill="#3A2517"') : `<circle r="${(2.5 + rnd() * 2.5).toFixed(1)}" fill="#C9A987"/>`) + '</g>';
  $('pxClumps').innerHTML = clumps;
  document.querySelectorAll('#pxClumps [data-k]').forEach((el) => px.clumps.push({ el, u: rnd(), v: rnd() }));
  $('pxCracks').innerHTML = Array.from({ length: 5 }, (_, i) => `<path data-k="${i}" d="M0,0 l6,10"/>`).join('');
  px.cracks = [...document.querySelectorAll('#pxCracks [data-k]')].map((el) => ({ el, u: rnd(), v: rnd(), a: Math.round(rnd() * 60 - 30) }));
  let top = '', even = '';
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 38;
    top += grain(276 + Math.cos(a) * r, 98 + Math.sin(a) * r, 4 + rnd() * 6, rnd).replace(/fill="[^"]+"/, 'fill="#3A2517"');
  }
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 38;
    top += `<circle cx="${(276 + Math.cos(a) * r).toFixed(1)}" cy="${(98 + Math.sin(a) * r).toFixed(1)}" r="${(2.5 + rnd() * 3).toFixed(1)}" fill="#C9A987"/>`;
  }
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 48;
    even += `<circle cx="${(276 + Math.cos(a) * r).toFixed(1)}" cy="${(98 + Math.sin(a) * r).toFixed(1)}" r="${(0.7 + rnd()).toFixed(1)}" fill="${GRAIN_COLS[i % 5]}"/>`;
  }
  $('pxTopClumps').innerHTML = top;
  $('pxTopEven').innerHTML = even;
  let d = '';
  for (let k = 0; k <= 220; k++) {
    const a = k / 220 * Math.PI * 12, r = 3 + k / 220 * 42;
    d += (k ? 'L' : 'M') + (276 + Math.cos(a) * r).toFixed(1) + ',' + (98 + Math.sin(a) * r).toFixed(1);
  }
  $('pxSpiral').setAttribute('d', d);
  $('pxSpiral').style.strokeDasharray = '1400 1400';
}

function setSource(wizard) {
  CG.Wizard.on = wizard;
  CG.Wizard.reset();
  $('pxSrc').classList.toggle('on', wizard);
  $('pxSrc').textContent = wizard ? 'Wizard control' : 'Demo data';
}

function initWizard() {
  try { new BroadcastChannel('espresso-wizard').onmessage = (e) => CG.Wizard.cmd(e.data && e.data.cmd); } catch (e) {}
  const keys = { f: 'faster', s: 'slower', 1: 'left', 2: 'centre', 3: 'right', 0: 'clear', e: 'stop', r: 'reset' };
  document.addEventListener('keydown', (e) => {
    if (!keys[e.key] || !CG.Wizard.on || !document.querySelector('[data-screen=brew]').classList.contains('active')) return;
    CG.Wizard.cmd(keys[e.key]);
  });
  $('pxSrc').addEventListener('click', () => setSource(!CG.Wizard.on));
}

function goStep(step) {
  const from = STEPS.indexOf(appState.step), to = STEPS.indexOf(step);
  if (from === to) return;
  $('pxPanel').style.setProperty('--dir', (to > from ? 14 : -14) + 'px');
  appState.step = step;
  $('pxWhy').classList.remove('on');
  $('pxWhyBtn').classList.remove('on');
  renderPrep();
}

function initPrep() {
  buildPrepArt();
  initWizard();
  document.querySelectorAll('#dialTicks, #pxDial').forEach((dial) => dial.addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    appState.grind = +b.dataset.g;
    renderPrep();
  }));
  document.querySelectorAll('[data-dose]').forEach((b) => b.addEventListener('click', () => {
    appState.dose = clamp(appState.dose + Number(b.dataset.dose), 14, 22);
    renderPrep();
  }));
  document.querySelectorAll('#pxWdtSeg [data-wdt]').forEach((b) => b.addEventListener('click', () => { appState.wdt = b.dataset.wdt === '1'; renderPrep(); }));
  document.querySelectorAll('#tampSeg [data-val]').forEach((b) => b.addEventListener('click', () => { appState.tamp = b.dataset.val; renderPrep(); }));
  document.querySelectorAll('#pxLevelSeg [data-level]').forEach((b) => b.addEventListener('click', () => { appState.level = b.dataset.level; renderPrep(); }));
  document.querySelectorAll('#pxTabs [data-step]').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
  $('pxNext').addEventListener('click', () => goStep(STEPS[Math.min(3, STEPS.indexOf(appState.step) + 1)]));
  $('pxWhyBtn').addEventListener('click', () => {
    $('pxWhyBtn').classList.toggle('on', $('pxWhy').classList.toggle('on'));
  });
  let sx = null;
  $('pxHero').addEventListener('pointerdown', (e) => { sx = e.clientX; });
  $('pxHero').addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, i = STEPS.indexOf(appState.step);
    sx = null;
    if (Math.abs(dx) < 50) return;
    buzz('select');
    goStep(STEPS[clamp(i + (dx < 0 ? 1 : -1), 0, 3)]);
  });
}

function updateRecordingUI() {
  $('recDot').classList.toggle('paused', !appState.recording);
  $('recLabel').textContent = appState.recording ? 'REC' : 'PAUSED';
}

function setHubTimerLabel(phaseName) {
  $('brewHubTimerLabel').textContent = phaseName;
  $('brewHub2Label').textContent = phaseName;
}

let espressoDoneFired = false;

function startBrewCamera(then) {
  camOn(brewCamera, 'brew').then((granted) => {
    if (granted && appState.recording) brewCamera.startRecording();
    if (then) then(granted);
  });
  updateRecordingUI();
}

function startEspressoLiveBrew() {
  const m = METHOD_DATA.espresso;
  espressoDoneFired = false;
  if ($('brewMethodName')) $('brewMethodName').textContent = m.name;
  setHubTimerLabel(m.phases[0].name);
  m.phases.forEach((ph, i) => { const lab = $('brewLabel' + i); if (lab) lab.textContent = ph.name; });
  CG.EspressoOverlay.start({
    container: 'espressoOverlay',
    video: 'brewVideo',
    basket: 'bottomless',
    pinned: true,
    prep: prepState(),
    onTick: renderEspressoTick,
    onDone: (elapsedSec) => {
      if (espressoDoneFired) return;
      espressoDoneFired = true;
      appState.lastEspressoResult = CG.EspressoOverlay.getResult();
      CG.EspressoOverlay.stop();
      brewCamera.stop();
      renderReview(elapsedSec);
      showScreen('review');
    },
  });
  startBrewCamera((granted) => CG.EspressoOverlay.track(granted));
}

function renderEspressoTick(info) {
  const idx = { preinfusion: 0, extraction: 1, finish: 2 }[info.phase] ?? 0, phases = METHOD_DATA.espresso.phases;
  $('brewPhasePillName').textContent = phases[idx].name;
  $('brewPhasePillTime').textContent = '· ' + mmss(info.elapsedPhaseSec);
  $('brewHubTimerValue').textContent = mmss(info.elapsedPhaseSec);
  setHubTimerLabel(phases[idx].name);
  paintPhases(idx, info.segFill, phases, info.running);
  glRender(info);
}

function startLiveBrew() {
  $('glassesBtn').classList.toggle('hidden', appState.method !== 'espresso');
  if (appState.method === 'espresso') return startEspressoLiveBrew();
  const m = METHOD_DATA[appState.method] || METHOD_DATA.pourover;
  setHubTimerLabel(m.phases[0].name);
  Brew.startBrew(appState.method, (elapsed) => {
    appState.lastEspressoResult = null;
    brewCamera.stop();
    renderReview(elapsed);
    showScreen('review');
  });
  startBrewCamera();
  clearInterval(startLiveBrew.sync);
  startLiveBrew.sync = setInterval(() => {
    $('brewHubTimerValue').textContent = $('brewPhasePillTime').textContent.replace('· ', '');
    setHubTimerLabel($('brewPhasePillName').textContent);
  }, 500);
}

function initLiveBrew() {
  $('recToggleBtn').addEventListener('click', () => {
    appState.recording = !appState.recording;
    if (appState.recording) brewCamera.startRecording(); else brewCamera.stopRecording();
    updateRecordingUI();
  });
  $('brewPlayPauseBtn').addEventListener('click', () => appState.method === 'espresso' ? CG.EspressoOverlay.togglePause() : Brew.togglePause());
  $('brewFinishBtn').addEventListener('click', () => appState.method === 'espresso' ? CG.EspressoOverlay.finishNow() : Brew.finishEarly());
  document.querySelectorAll('[data-stop-brew]').forEach((el) => el.addEventListener('click', () => {
    Brew.stopBrew();
    CG.EspressoOverlay.stop();
    brewCamera.stop();
    clearInterval(startLiveBrew.sync);
  }));
}

const GL_ZONE = [1.3, 2.3];
let glInfo = null, glAudio = null, glWake = null, glWasFinish = false, glWait = Promise.resolve();

function glActive() {
  return document.body.classList.contains('glasses');
}

function applyGlasses(name) {
  const on = !!appState.glasses, hud = on && name === 'brew' && appState.method === 'espresso';
  const was = glActive();
  document.body.classList.toggle('glasses', on);
  $('brewStage').classList.toggle('gl-on', hud);
  CG.EspressoOverlay.setWide(hud);
  if (!hud) {
    $('brewStage').classList.remove('gl-xr');
    $('glViewBtn').textContent = 'Camera X-Ray';
  }
  if (CG.AR) CG.AR.show(on ? name : null);
  if (hud && glInfo) glRender(glInfo);
  if (was === on) return;
  fitPhoneToViewport();
  glWait = on ? glClaim() : glRelease();
}

function setGlasses(on) {
  appState.glasses = on;
  try { localStorage.setItem('cg-glasses', on ? '1' : ''); } catch (e) {}
  const apply = () => applyGlasses(document.querySelector('.screen.active').dataset.screen);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
  const veil = $('glVeil'), phone = $('phoneEl'), ease = 'cubic-bezier(.2, .8, .2, 1)';
  AR.morph = true;
  phone.animate([{ scale: 1, filter: 'blur(0)' }, { scale: 0.96, filter: 'blur(4px)' }], { duration: 280, easing: 'ease-in' });
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished
    .then(() => { apply(); return Promise.race([glWait, new Promise((r) => setTimeout(r, 700))]); })
    .then(() => new Promise((r) => setTimeout(r, 120)))
    .then(() => {
      AR.morph = false;
      phone.animate([{ scale: 1.03, filter: 'blur(4px)' }, { scale: 1, filter: 'blur(0)' }], { duration: 480, easing: ease });
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: ease, fill: 'forwards' });
    });
}

function glClaim() {
  if (!glAudio) { try { glAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  const el = document.documentElement;
  if (!glWake && navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { glWake = w; }).catch(() => {});
  if (document.fullscreenElement || !el.requestFullscreen) return Promise.resolve();
  return el.requestFullscreen().then(() => screen.orientation.lock('landscape')).catch(() => {});
}

function glRelease() {
  try { screen.orientation.unlock(); } catch (e) {}
  if (glWake) glWake.release().catch(() => {});
  glWake = null;
  return document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
}

function glCue() {
  buzz('cue', true);
  if (!glAudio) return;
  const o = glAudio.createOscillator(), g = glAudio.createGain(), t = glAudio.currentTime;
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g).connect(glAudio.destination);
  o.start(t);
  o.stop(t + 0.3);
}

function glSet(key, text, s) {
  document.querySelectorAll('[data-gl="' + key + '"]').forEach((el) => {
    el.textContent = text;
    if (s !== undefined) el.dataset.s = s;
  });
}

function glMessage(info) {
  if (!info.running) return info.totalSec < 0.1 ? ['Ready', 'Tap to start the shot', ''] : ['Paused', 'Tap to resume', ''];
  if (info.phase === 'preinfusion') return ['Pre-infusion', 'Soaking the puck', ''];
  if (info.phase === 'finish') {
    if (info.elapsedPhaseSec < 1.2) return ['Stop', 'Stop the shot now', 'stop'];
    const r = CG.EspressoOverlay.getResult();
    if (!r) return ['Done', '', ''];
    const head = r.weightG + ' g in ' + mmss(r.timeSec);
    if (r.early) return ['Done', head + ', ran early', 'warn'];
    if (r.choked) return ['Done', head + ', ran long', 'warn'];
    return ['Done', head + ', on target', 'ok'];
  }
  if (info.weightG >= XR.targetG - 4) return ['Extracting', 'Get ready to stop', 'warn'];
  if (info.channel) return ['Extracting', info.channel + ' side running fast', 'warn'];
  if (info.flowGs > GL_ZONE[1]) return ['Extracting', 'Running fast, grind finer next shot', 'warn'];
  if (info.flowGs < GL_ZONE[0] && info.elapsedPhaseSec > 3) return ['Extracting', 'Running slow, grind coarser next shot', 'warn'];
  return ['Extracting', 'Steady flow, hold', 'ok'];
}

function glRender(info) {
  glInfo = info;
  if (!glActive()) return;
  const [phaseName, msg, s] = glMessage(info);
  const w = info.weightG, flow = info.flowGs, extracting = info.phase === 'extraction';
  const inZone = flow >= GL_ZONE[0] && flow <= GL_ZONE[1];
  glSet('phase', phaseName);
  glSet('msg', msg, s);
  glSet('weight', w.toFixed(1));
  glSet('time', String(Math.floor(info.phase === 'finish' ? info.totalSec - info.elapsedPhaseSec : info.totalSec)));
  glSet('flow', flow.toFixed(1));
  glSet('target', '/ ' + XR.targetG + ' g');
  glSet('src', CG.Wizard.on ? 'Wizard control' : CG.EspressoOverlay.isPinned() ? 'Card tracking' : $('brewVideo').classList.contains('hidden') ? 'Demo data' : 'Camera sensing');
  $('glWeight').style.setProperty('--p', Math.min(100, w / XR.targetG * 100) + '%');
  $('glMark').style.left = Math.min(1, flow / 3.6) * 100 + '%';
  $('glMark').dataset.s = extracting ? (inZone ? 'ok' : 'warn') : '';
  $('glPuck').classList.toggle('on', info.phase !== 'finish');
  $('glStream').classList.toggle('on', extracting);
  const h = Math.min(1, w / XR.targetG) * 20;
  $('glCup').setAttribute('y', String(150 - h));
  $('glCup').setAttribute('height', String(h));
  $('glHud').classList.toggle('gl-stop', s === 'stop');
  glPlayIcon(info.running);
  $('glRecBtn').classList.toggle('rec', !!appState.recording);
  if (info.phase === 'finish' && !glWasFinish) glCue();
  glWasFinish = info.phase === 'finish';
}

function glToggleView() {
  const xr = $('brewStage').classList.toggle('gl-xr');
  if (!xr) CG.EspressoOverlay.setAligning(false);
  $('glViewBtn').textContent = xr ? 'Back to HUD' : 'Camera X-Ray';
}

function glPlayIcon(running) {
  $('glPlayBtn').innerHTML = '<i class="fa-solid fa-' + (running ? 'pause' : 'play') + ' icon-fa"></i>';
}

function glTogglePause() {
  const running = CG.EspressoOverlay.togglePause();
  $('brewPlayPauseIcon').innerHTML = running ? PAUSE_ICON : PLAY_ICON;
  glPlayIcon(running);
  if (glInfo) glRender({ ...glInfo, running });
}

function glToggleRec() {
  $('recToggleBtn').click();
  $('glRecBtn').classList.toggle('rec', appState.recording);
}

function initGlasses() {
  try { appState.glasses = localStorage.getItem('cg-glasses') === '1'; } catch (e) {}
  $('glassesBtn').addEventListener('click', () => setGlasses(true));
  $('glExitBtn').addEventListener('click', () => setGlasses(false));
  $('arDeviceBtn').addEventListener('click', () => setGlasses(true));
  $('glViewBtn').addEventListener('click', glToggleView);
  $('glPlayBtn').addEventListener('click', glTogglePause);
  $('glEndBtn').addEventListener('click', () => CG.EspressoOverlay.finishNow());
  $('glRecBtn').addEventListener('click', glToggleRec);
  $('glBackBtn').addEventListener('click', () => document.querySelector('[data-screen=brew] [data-stop-brew]').click());
}

const KIND_LABEL = { ok: 'On target', fast: 'Ran fast', long: 'Ran long', channel: 'Channeled' };
const KIND_BREW = { ok: 'On time', fast: 'Ran short', long: 'Ran long', channel: 'Channeled' };
const FIELD_NAME = { grind: 'Grind', dose: 'Dose', wdt: 'WDT', tamp: 'Tamp force', level: 'Tamp surface', temp: 'Water temperature' };
const FIELD_STEP = { grind: 'grind', dose: 'dose', wdt: 'wdt', tamp: 'tamp', level: 'tamp' };
const TAMP_NAME = { light: 'Light, 5 kg', ideal: 'Firm, 15 kg', tight: 'Hard, 30 kg' };
const SIDES = ['left', 'centre', 'right'];
const RV = { rec: null, tracked: null, saved: false };
const HS = { filter: 'all', fresh: null };
const BD = { id: null };
const RP = { x0: 10, x1: 310, y0: 12, y1: 118 };
const CP = { cx: 150, cy: 104, rx: 124, ry: 84 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const methodName = (k) => (METHOD_DATA[k] || METHOD_DATA.pourover).name;
const chipText = (r) => (r.method === 'espresso' ? KIND_LABEL : KIND_BREW)[r.verdict.kind];
const timeText = (r) => r.method === 'espresso' ? r.time.toFixed(1) + ' s' : mmss(r.time);
const beanName = (k) => (BAG_DATA[k] || { name: 'Other beans' }).name;
const starsHtml = (n) => [0, 1, 2, 3, 4].map((i) => miniStarSvg(i < n)).join('');

function fmtDay(at, short) {
  const d = new Date(at), days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  const hm = short ? '' : ', ' + d.toTimeString().slice(0, 5);
  if (days === 0) return 'Today' + hm;
  if (days === 1) return 'Yesterday' + hm;
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: short ? 'short' : 'long' }) + hm;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fieldText(f, v) {
  if (f === 'grind') return 'Setting ' + (v + 1) + ' · ' + CG.GRIND.scale[v].um + ' µm';
  if (f === 'dose') return v + ' g';
  if (f === 'wdt') return v ? 'Stir' : 'Skipped';
  if (f === 'tamp') return TAMP_NAME[v];
  if (f === 'level') return v === 'level' ? 'Level' : 'Tilted';
  if (f === 'temp') return v + ' °C';
  return String(v);
}

function countTo(el, to, fmt) {
  const from = el._v ?? to * 0.6, t0 = performance.now();
  el._v = to;
  cancelAnimationFrame(el._raf);
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

function sample(tr, t) {
  let i = 1;
  while (i < tr.length - 1 && tr[i][0] < t) i++;
  const a = tr[i - 1], b = tr[i], k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0])) : 1;
  return a.map((v, j) => v + (b[j] - v) * k);
}

function replayCaption(m, t, v) {
  const q = v[1].toFixed(1) + ' g/s', p = v[2].toFixed(1) + ' bar';
  if (t >= m.time - 0.05) return 'Stopped at ' + Math.round(v[3]) + ' g after ' + m.time.toFixed(1) + ' s.';
  if (t < m.drip) return 'Pre-infusion. Water soaks the puck. Pressure at ' + p + '.';
  if (m.chOn != null && t >= m.chOn) return 'Channel on the ' + SIDES[m.side ?? 1] + '. Flow at ' + q + ', pressure down to ' + p + '.';
  return 'Extraction. ' + q + ' at ' + p + '. ' + Math.round(v[3]) + ' g in the cup.';
}

function drawReplay(host, rec) {
  cancelAnimationFrame(host._raf);
  if (!rec.model || !rec.model.trace || !rec.model.trace.length) { drawPhases(host, rec); return; }
  const m = rec.model, id = host.dataset.replay, T = Math.max(40, Math.ceil((m.time + 3) / 10) * 10);
  const x = (t) => RP.x0 + (RP.x1 - RP.x0) * t / T, h = RP.y1 - RP.y0;
  const yq = (v) => RP.y1 - h * Math.min(v, 3.2) / 3.2, yp = (v) => RP.y1 - h * Math.min(v, 12) / 12;
  const tr = [[0, 0, 0, 0]].concat(m.trace), line = (rows, col, fy) => rows.map((r, i) => (i ? 'L' : 'M') + x(r[0]).toFixed(1) + ' ' + fy(r[col]).toFixed(1)).join('');
  const fc = CG.Shot.run(rec.prep), off = Math.abs(fc.time - m.time) > 0.5;
  const lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi, ticks = [];
  for (let t = 0; t <= T; t += 10) ticks.push(`<text class="rp-tk" x="${x(t)}" y="132">${t}s</text>`);
  host.innerHTML = `
    <div class="rv-head"><div class="rv-title">Shot replay</div><button type="button" class="rv-link" data-r="play">Replay</button></div>
    <svg class="rp" viewBox="0 0 320 138">
      <defs><clipPath id="rpClip-${id}"><rect data-r="clip" x="0" y="0" width="0" height="138"/></clipPath></defs>
      <rect class="rp-zone" x="${x(lo)}" y="${RP.y0}" width="${x(hi) - x(lo)}" height="${h}"/>
      <text class="rp-zl" x="${(x(lo) + x(hi)) / 2}" y="${RP.y0 + 9}">${lo}–${hi} s</text>
      ${[1, 2, 3].map((v) => `<line class="rp-grid" x1="${RP.x0}" x2="${RP.x1}" y1="${yq(v)}" y2="${yq(v)}"/>`).join('')}
      ${m.chOn != null ? `<rect class="rp-ch" x="${x(m.chOn)}" y="${RP.y0}" width="${Math.max(2, x(m.time) - x(m.chOn))}" height="${h}"/><text class="rp-chl" x="${x(m.chOn) + 3}" y="${RP.y1 - 4}">Channel · ${SIDES[m.side ?? 1]}</text>` : ''}
      ${off ? `<path class="rp-f" d="${line([[0, 0, 0, 0]].concat(fc.trace), 1, yq)}"/>` : ''}
      <g clip-path="url(#rpClip-${id})"><path class="rp-p" d="${line(tr, 2, yp)}"/><path class="rp-q" d="${line(tr, 1, yq)}"/></g>
      <line class="rp-mk" x1="${x(m.drip)}" x2="${x(m.drip)}" y1="${RP.y0}" y2="${RP.y1}"/><text class="rp-ml" x="${x(m.drip) + 3}" y="${RP.y0 + 8}">First drip</text>
      <line class="rp-mk" x1="${x(m.time)}" x2="${x(m.time)}" y1="${RP.y0}" y2="${RP.y1}"/>
      <g data-r="head"><line class="rp-hl" x1="0" x2="0" y1="${RP.y0}" y2="${RP.y1}"/><circle class="rp-hp" data-r="hp" cx="0" cy="${RP.y1}" r="3"/><circle class="rp-hq" data-r="hq" cx="0" cy="${RP.y1}" r="4.5"/></g>
      ${ticks.join('')}
    </svg>
    <div class="rp-read"><div><span>Time</span><b data-r="t"></b></div><div><span>Flow</span><b data-r="q"></b></div><div><span>Pressure</span><b data-r="p"></b></div><div><span>In cup</span><b data-r="y"></b></div></div>
    <div class="rp-cap" data-r="cap"></div>
    <div class="px-legend"><span><i></i>Flow</span><span><i class="p"></i>Pressure</span>${off ? '<span><i class="f"></i>Forecast</span>' : ''}<span class="z">${off ? 'Forecast was ' + fc.time.toFixed(1) + ' s' : 'Matched the forecast'}</span></div>`;
  const q = (k) => host.querySelector(`[data-r="${k}"]`), svg = host.querySelector('svg');
  const set = (t) => {
    const v = sample(tr, t), px = x(t).toFixed(1);
    q('clip').setAttribute('width', px);
    q('head').setAttribute('transform', `translate(${px} 0)`);
    q('hq').setAttribute('cy', yq(v[1]).toFixed(1));
    q('hp').setAttribute('cy', yp(v[2]).toFixed(1));
    q('t').textContent = t.toFixed(1) + ' s';
    q('q').textContent = v[1].toFixed(1) + ' g/s';
    q('p').textContent = v[2].toFixed(1) + ' bar';
    q('y').textContent = Math.round(v[3]) + ' g';
    q('cap').textContent = replayCaption(m, t, v);
  };
  const play = () => {
    cancelAnimationFrame(host._raf);
    const t0 = performance.now(), dur = 1400 + m.time * 20;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      set(m.time * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
      if (k < 1) host._raf = requestAnimationFrame(tick);
    };
    host._raf = requestAnimationFrame(tick);
  };
  const scrub = (e) => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 320;
    set(clamp((vx - RP.x0) / (RP.x1 - RP.x0) * T, 0, m.time));
  };
  svg.addEventListener('pointerdown', (e) => { buzz('tick'); cancelAnimationFrame(host._raf); svg.setPointerCapture(e.pointerId); scrub(e); });
  svg.addEventListener('pointermove', (e) => { if (svg.hasPointerCapture(e.pointerId)) scrub(e); });
  q('play').addEventListener('click', play);
  set(0);
  play();
}

function drawPhases(host, rec) {
  const ph = (METHOD_DATA[rec.method] || METHOD_DATA.pourover).phases, plan = CG.Verdict.plan(rec.method);
  const T = Math.max(plan, rec.time) * 1.08, pct = (t) => (t / T * 100).toFixed(1) + '%';
  host.innerHTML = `
    <div class="rv-head"><div class="rv-title">Your brew</div><div class="rv-hint">Planned vs actual</div></div>
    <div class="ph">
      <div class="ph-bar" style="width:${pct(plan)}">${ph.map((p) => `<span style="flex:${p.duration}">${p.name}</span>`).join('')}</div>
      <div class="ph-mark" data-r="mark" style="left:0%"><b>${mmss(rec.time)}</b></div>
    </div>
    <div class="ph-scale"><span>0:00</span><span>Planned ${mmss(plan)}</span></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { host.querySelector('[data-r=mark]').style.left = pct(rec.time); }));
}

function verdictTiles(r) {
  if (r.method === 'espresso') {
    const ratio = r.yield / r.dose;
    return [
      { lab: 'Time', v: r.time, lo: CG.SHOT.targetLo, hi: CG.SHOT.targetHi, min: 15, max: 50, fmt: (v) => v.toFixed(1) + ' s', sub: 'Target 25–32 s' },
      { lab: 'Yield', v: r.yield, lo: r.target - 2, hi: r.target + 2, min: r.target - 12, max: r.target + 12, fmt: (v) => Math.round(v) + ' g', sub: 'Target ' + r.target + ' g' },
      { lab: 'Ratio', v: ratio, lo: 1.8, hi: 2.2, min: 1.2, max: 3, fmt: (v) => '1:' + v.toFixed(1), sub: 'Target 1:2' },
    ];
  }
  const plan = CG.Verdict.plan(r.method), r0 = r.target && r.dose ? r.target / r.dose : null;
  return [
    { lab: 'Time', v: r.time, lo: plan * 0.9, hi: plan * 1.1, min: 0, max: plan * 1.6, fmt: mmss, sub: 'Planned ' + mmss(plan) },
    r.target && r.yield ? { lab: 'Water', v: r.yield, lo: r.target * 0.95, hi: r.target * 1.05, min: r.target * 0.5, max: r.target * 1.5, fmt: (v) => Math.round(v) + ' g', sub: 'Recipe ' + r.target + ' g' } : null,
    r0 && r.yield ? { lab: 'Ratio', v: r.yield / r.dose, lo: r0 * 0.93, hi: r0 * 1.07, min: r0 * 0.5, max: r0 * 1.5, fmt: (v) => '1:' + v.toFixed(1), sub: 'Recipe 1:' + r0.toFixed(1) } : null,
  ];
}

function drawVerdict(host, rec) {
  if (!host.firstChild) {
    host.innerHTML = `<div class="rv-head"><span class="rv-chip" data-v="chip"></span><span class="rv-hint" data-v="when"></span></div>
      <div class="rv-vtitle" data-v="title"></div><div class="rv-vsub" data-v="cause"></div>
      <div class="rv-tiles">${[0, 1, 2].map((i) => `<div class="rv-tile" data-tile="${i}"><span data-t="lab"></span><b data-t="val"></b><div class="rv-g"><i class="rv-gb"></i><i class="rv-gm"></i></div><em data-t="sub"></em></div>`).join('')}</div>`;
  }
  const v = rec.verdict, q = (k) => host.querySelector(`[data-v="${k}"]`);
  q('chip').className = 'rv-chip k-' + v.kind;
  q('chip').textContent = chipText(rec);
  q('when').textContent = fmtDay(rec.at);
  q('title').textContent = v.title;
  q('cause').textContent = v.cause;
  verdictTiles(rec).forEach((t, i) => {
    const el = host.querySelector(`[data-tile="${i}"]`);
    el.classList.toggle('hidden', !t);
    if (!t) return;
    const pos = (x) => clamp((x - t.min) / (t.max - t.min)) * 100;
    el.querySelector('[data-t=lab]').textContent = t.lab;
    el.querySelector('[data-t=sub]').textContent = t.sub;
    countTo(el.querySelector('[data-t=val]'), t.v, t.fmt);
    el.querySelector('.rv-gb').style.cssText = `left:${pos(t.lo)}%;width:${pos(t.hi) - pos(t.lo)}%`;
    const mk = el.querySelector('.rv-gm');
    mk.style.left = pos(t.v) + '%';
    mk.classList.toggle('off', t.v < t.lo || t.v > t.hi);
  });
}

const cpAt = (t) => [CP.cx + t.x * CP.rx, CP.cy - t.y * CP.ry];

function drawCompass(host, rec, onTaste) {
  const id = host.dataset.compass;
  if (!host.firstChild) {
    host.innerHTML = `<svg class="cp${onTaste ? ' edit' : ''}" viewBox="0 0 300 208">
      <defs>
        <linearGradient id="cpH-${id}"><stop offset="0" stop-color="#F4E2A6"/><stop offset=".5" stop-color="#FBF8F2"/><stop offset="1" stop-color="#DCC3AC"/></linearGradient>
        <linearGradient id="cpV-${id}" x2="0" y2="1"><stop offset="0" stop-color="#2B1B12" stop-opacity=".1"/><stop offset=".5" stop-color="#2B1B12" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".45"/></linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="208" rx="12" fill="url(#cpH-${id})"/>
      <rect x="0" y="0" width="300" height="208" rx="12" fill="url(#cpV-${id})"/>
      <line class="cp-axis" x1="${CP.cx}" x2="${CP.cx}" y1="14" y2="194"/><line class="cp-axis" x1="14" x2="286" y1="${CP.cy}" y2="${CP.cy}"/>
      <ellipse class="cp-ok" cx="${CP.cx}" cy="${CP.cy}" rx="30" ry="22"/>
      <text class="cp-lab" x="12" y="${CP.cy - 6}" text-anchor="start">Sour</text>
      <text class="cp-lab" x="288" y="${CP.cy - 6}" text-anchor="end">Bitter</text>
      <text class="cp-lab" x="${CP.cx}" y="13" text-anchor="middle">Strong</text>
      <text class="cp-lab" x="${CP.cx}" y="203" text-anchor="middle">Weak</text>
      <text class="cp-bal" x="${CP.cx}" y="${CP.cy + 36}">Balanced</text>
      <path class="cp-fix" d="M${CP.cx} ${CP.cy}L${CP.cx} ${CP.cy}"/>
      <g class="cp-ghost"><circle r="8"/><text y="-13">Shot suggests</text></g>
      <g class="cp-dot"><circle class="cp-halo" r="17"/><circle class="cp-core" r="9"/></g>
    </svg>`;
    if (onTaste) {
      const svg = host.querySelector('svg'), pick = (e) => {
        const r = svg.getBoundingClientRect();
        const x = clamp(((e.clientX - r.left) / r.width * 300 - CP.cx) / CP.rx, -1);
        const y = clamp((CP.cy - (e.clientY - r.top) / r.height * 208) / CP.ry, -1);
        host._rec.taste = { x: +x.toFixed(2), y: +y.toFixed(2) };
        drawCompass(host, host._rec);
      };
      svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); pick(e); requestAnimationFrame(() => svg.classList.add('drag')); });
      svg.addEventListener('pointermove', (e) => { if (svg.hasPointerCapture(e.pointerId)) pick(e); });
      svg.addEventListener('pointerup', () => { buzz('select'); svg.classList.remove('drag'); host._on(); });
      host._on = onTaste;
    }
  }
  host._rec = rec;
  const pr = CG.Taste.predict(rec), ghost = rec.method === 'espresso', t = rec.taste || pr;
  const [gx, gy] = cpAt(pr), [dx, dy] = cpAt(t);
  const g = host.querySelector('.cp-ghost'), d = host.querySelector('.cp-dot'), fix = host.querySelector('.cp-fix');
  g.style.transform = `translate(${gx}px, ${gy}px)`;
  g.style.opacity = ghost && rec.taste ? 1 : 0;
  d.style.transform = `translate(${dx}px, ${dy}px)`;
  d.classList.toggle('unset', !rec.taste);
  d.style.opacity = rec.taste || host._on ? 1 : 0;
  fix.style.d = `path("M${CP.cx} ${CP.cy}L${dx.toFixed(1)} ${dy.toFixed(1)}")`;
  fix.style.opacity = rec.taste ? 1 : 0;
}

function miniCompass(t) {
  const dot = t ? `<circle cx="${16 + t.x * 12}" cy="${16 - t.y * 12}" r="3.5"/>` : '';
  return `<svg class="hs-cp" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7"/><line x1="16" x2="16" y1="5" y2="27"/><line x1="5" x2="27" y1="16" y2="16"/>${dot}</svg>`;
}

function sparkline(r) {
  if (r.model && r.model.trace) {
    const tr = r.model.trace, T = Math.max(40, r.model.time + 2), x = (t) => 2 + 84 * t / T, y = (v) => 30 - 26 * Math.min(v, 4) / 4;
    const d = tr.map((q, i) => (i ? 'L' : 'M') + x(q[0]).toFixed(1) + ' ' + y(q[1]).toFixed(1)).join('');
    return `<svg class="hs-sp" viewBox="0 0 88 32"><rect class="hs-spz" x="${x(CG.SHOT.targetLo)}" y="2" width="${x(CG.SHOT.targetHi) - x(CG.SHOT.targetLo)}" height="28"/><path class="k-${r.verdict.kind}" d="${d}"/></svg>`;
  }
  const plan = CG.Verdict.plan(r.method), T = Math.max(plan, r.time) * 1.1, w = (t) => (84 * t / T).toFixed(1);
  return `<svg class="hs-sp" viewBox="0 0 88 32"><rect class="hs-spb" x="2" y="12" width="${w(plan)}" height="8" rx="4"/><line class="hs-spm" x1="${2 + +w(r.time)}" x2="${2 + +w(r.time)}" y1="6" y2="26"/></svg>`;
}

function whyHtml(rec, a) {
  const notes = CG.Advice.notes(rec, a);
  return esc(a.why) + (notes.length ? '<ul class="rv-also">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '');
}

function drawAdvice(rec) {
  const a = rec.advice, espresso = rec.method === 'espresso', changed = $('rvAdvice').textContent !== a.title;
  $('rvChange').innerHTML = a.field && a.field !== 'note'
    ? `<div class="rv-cf">${FIELD_NAME[a.field]}</div><div class="rv-cv"><span class="rv-from">${fieldText(a.field, a.from)}</span><i class="fa-solid fa-arrow-right icon-fa ic-12"></i><span class="rv-to">${fieldText(a.field, a.to)}</span></div>`
    : a.field ? '' : '<div class="rv-cv"><span class="rv-to">Same recipe</span></div>';
  $('rvAdvice').textContent = a.title;
  $('rvWhy').innerHTML = whyHtml(rec, a);
  $('rvApply').textContent = a.field && a.field !== 'note' ? 'Apply to next brew' : 'Brew again';
  const cmp = $('rvCmp');
  cmp.classList.toggle('hidden', !espresso || !a.predicted);
  if (espresso && a.predicted) {
    if (!cmp.firstChild) {
      cmp.innerHTML = `<div class="rv-tl"><i class="rv-tlb"></i><span class="rv-tm now"><em></em></span><span class="rv-tm next"><em></em></span></div>
        <div class="rv-tls"><span>15 s</span><span class="z">Target 25–32 s</span><span>50 s</span></div>`;
    }
    const pos = (t) => (clamp((t - 15) / 35) * 100).toFixed(1) + '%', nx = a.next;
    cmp.querySelector('.rv-tlb').style.cssText = `left:${pos(CG.SHOT.targetLo)};width:calc(${pos(CG.SHOT.targetHi)} - ${pos(CG.SHOT.targetLo)})`;
    const now = cmp.querySelector('.now'), next = cmp.querySelector('.next');
    now.style.left = pos(rec.time);
    next.style.left = pos(nx);
    now.querySelector('em').textContent = 'This shot ' + rec.time.toFixed(1) + ' s';
    next.querySelector('em').textContent = (a.field && Math.abs(nx - rec.time) > 0.4 ? 'Next ≈ ' : 'Stays ≈ ') + nx.toFixed(1) + ' s';
  }
  if (changed) $('rvNext').animate([{ opacity: 0.35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

const RV_INPUTS = { rvInYield: 'yield', rvInTime: 'time', rvInGrinder: 'grinder', rvInClick: 'click', rvInBean: 'bean', rvInRoast: 'roastDays', rvInTemp: 'temp' };

function rvFill() {
  const r = RV.rec, espresso = r.method === 'espresso';
  Object.entries(RV_INPUTS).forEach(([id, k]) => { $(id).value = r[k] ?? ''; $(id).classList.remove('edited'); });
  $('rvInYield').closest('.rv-f').firstElementChild.textContent = espresso ? 'Yield on scale' : 'Water poured';
  $('rvInTime').closest('.rv-f').firstElementChild.textContent = espresso ? 'Shot time' : 'Total brew time';
}

function rvRead() {
  const r = RV.rec;
  Object.entries(RV_INPUTS).forEach(([id, k]) => {
    const el = $(id), v = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    if (el.tagName === 'SELECT' || Number.isFinite(v)) r[k] = v;
  });
  ['rvInYield', 'rvInTime'].forEach((id) => $(id).classList.toggle('edited', RV.tracked[RV_INPUTS[id]] !== r[RV_INPUTS[id]]));
}

function rvUpdate() {
  const rec = RV.rec, espresso = rec.method === 'espresso', t = RV.tracked;
  rec.verdict = CG.Verdict.of(rec);
  rec.advice = CG.Advice.next(rec);
  drawVerdict(document.querySelector('[data-verdict=rv]'), rec);
  drawCompass(document.querySelector('[data-compass=rv]'), rec, rvUpdate);
  $('rvTasteLab').textContent = rec.taste ? CG.Taste.label(rec.taste) : 'Drag the dot';
  const pr = CG.Taste.predict(rec), far = rec.taste && Math.hypot(rec.taste.x - pr.x, rec.taste.y - pr.y) > 0.6;
  $('rvTasteNote').innerHTML = !rec.taste
    ? (espresso ? '<b>The shot suggests ' + CG.Taste.label(pr).toLowerCase() + '.</b> Taste it, then move the dot to where it landed.' : '<b>Taste it,</b> then move the dot to where it landed.')
    : !espresso ? '<b>' + CG.Taste.label(rec.taste) + '.</b> The advice below follows your taste.'
      : far ? '<b>Different from what the shot suggests.</b> Check the beans, the water and your scale reading.' : '<b>Close to what the shot suggests.</b>';
  drawAdvice(rec);
  const edited = t.time !== rec.time || t.yield !== rec.yield;
  $('rvMeasNote').textContent = rec.model
    ? edited ? 'Tracked ' + t.time.toFixed(1) + ' s and ' + t.yield + ' g. Your reading replaces it.' : 'Filled in from the tracked shot. Correct it if your scale read differently.'
    : 'Filled in from the timer and the recipe. Correct it if yours differ.';
}

function renderReview(elapsedSec) {
  const g = CG.Store.gear(), method = appState.method || 'pourover', m = METHOD_DATA[method] || METHOD_DATA.pourover;
  let rec;
  if (method === 'espresso') {
    const r = appState.lastEspressoResult || CG.Shot.result(prepState());
    rec = { prep: r.prep, dose: r.prep.dose, target: r.prep.dose * 2, time: +r.timeSec.toFixed(1), yield: r.weightG, model: r.model, temp: g.temp };
  } else {
    const water = parseFloat(m.yield) || null;
    rec = { prep: { grind: appState.grind }, dose: parseFloat(m.dose) || null, target: water, time: Math.round(elapsedSec), yield: water, model: null, temp: parseFloat(m.temp) || g.temp };
  }
  RV.rec = Object.assign({ id: 'b' + Date.now(), at: Date.now(), method, bean: appState.scannedBag || g.bean, roastDays: g.roastDays, grinder: g.grinder, click: g.click, taste: null, rating: 0, notes: '' }, rec);
  RV.tracked = { time: rec.time, yield: rec.yield };
  RV.saved = false;
  ['shareReviewBtn', 'saveReviewBtn'].forEach((id) => { $(id).disabled = false; });
  rvFill();
  appState.rating = 0;
  renderStars();
  $('reviewNotes').value = '';
  document.querySelector('[data-screen=review]').scrollTop = 0;
  drawReplay(document.querySelector('[data-replay=rv]'), RV.rec);
  rvUpdate();
  buzz(RV.rec.verdict.kind === 'ok' ? 'success' : 'warn', true);
}

function renderStars() {
  $('starsRow').innerHTML = [0, 1, 2, 3, 4].map((i) => `<span class="star" data-i="${i}">${starSvg(i < appState.rating)}</span>`).join('');
  document.querySelectorAll('.star').forEach((el) => el.addEventListener('click', () => {
    appState.rating = Number(el.dataset.i) + 1;
    renderStars();
  }));
}

function rvSave() {
  if (RV.saved) return CG.Store.get(RV.rec.id);
  const rec = RV.rec;
  rec.rating = appState.rating;
  rec.notes = $('reviewNotes').value.trim();
  const out = JSON.parse(JSON.stringify(Object.assign({}, rec, { advice: Object.assign({}, rec.advice, { predicted: null }) })));
  CG.Store.add(out);
  CG.Store.setGear(Object.assign(CG.Store.gear(), { grinder: rec.grinder, click: rec.click, bean: rec.bean, roastDays: rec.roastDays }, rec.method === 'espresso' ? { temp: rec.temp } : {}));
  RV.saved = true;
  buzz('success', true);
  appState.beans.forEach((b) => { if (b.key === rec.bean) b.daysOff = rec.roastDays; });
  ['shareReviewBtn', 'saveReviewBtn'].forEach((id) => { $(id).disabled = true; });
  renderHome();
  return out;
}

function brewSummary(r) {
  return r.method === 'espresso'
    ? r.dose + ' g in, ' + r.yield + ' g out, ' + r.time.toFixed(1) + ' s. ' + r.verdict.title + '.'
    : methodName(r.method) + ', ' + mmss(r.time) + '. ' + r.verdict.title + '.';
}

function applyRecipe(method, prep, field, temp, msg) {
  appState.method = method;
  appState.grindFor = method;
  ['grind', 'dose', 'wdt', 'tamp', 'level'].forEach((k) => { if (prep[k] !== undefined) appState[k] = prep[k]; });
  appState.step = FIELD_STEP[field] || 'grind';
  if (temp) CG.Store.setGear(Object.assign(CG.Store.gear(), { temp }));
  updateMethodSelectionUI();
  go('grind');
  document.querySelector('[data-screen=grind]').scrollTop = 0;
  const toast = $('applyToast');
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(applyRecipe._t);
  applyRecipe._t = setTimeout(() => toast.classList.remove('on'), 5000);
  const hit = method === 'espresso' ? document.querySelector(`#pxTabs [data-step="${appState.step}"]`) : $('ppGrindCard');
  if (hit) { hit.classList.remove('flash'); void hit.offsetWidth; hit.classList.add('flash'); }
}

function applyAdvice(r, lead = 'Advice applied.') {
  const a = r.advice;
  applyRecipe(r.method, a.prep, a.field, a.field === 'temp' ? a.to : null, changeMsg(a, lead));
}

function repeatRecipe(r, msg = 'Loaded your last recipe.') {
  applyRecipe(r.method, r.prep, null, r.method === 'espresso' ? r.temp : null, msg);
}

function changeMsg(a, lead) {
  if (!a.field || a.field === 'note') return lead + ' ' + (a.field ? a.title + '.' : 'Same recipe loaded.');
  return lead + ' ' + FIELD_NAME[a.field] + ': ' + fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to) + '.';
}

function initReview() {
  document.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const el = $(b.dataset.adj), by = Number(b.dataset.by) * (b.dataset.adj === 'rvInTime' && RV.rec.method === 'espresso' ? 0.5 : 1);
    el.value = +((parseFloat(el.value) || 0) + by).toFixed(1);
    el.dispatchEvent(new Event('input'));
  }));
  $('rvInGrinder').innerHTML = CG.GRINDERS.map((g) => `<option>${g}</option>`).join('');
  Object.keys(RV_INPUTS).forEach((id) => $(id).addEventListener(id === 'rvInGrinder' || id === 'rvInBean' ? 'change' : 'input', () => {
    const bean = id === 'rvInBean' && appState.beans.find((b) => b.key === $(id).value);
    if (bean) $('rvInRoast').value = bean.daysOff;
    rvRead();
    rvUpdate();
  }));
  $('rvApply').addEventListener('click', () => {
    rvSave();
    applyAdvice(RV.rec, 'Saved to history.');
  });
  $('shareReviewBtn').addEventListener('click', () => {
    const out = rvSave();
    appState.feed.unshift({ user: 'You', initials: 'AR', method: methodName(out.method), methodKey: out.method, time: 'Just now', notes: out.notes || brewSummary(out), rating: out.rating || 4, duration: mmss(out.time) });
    renderFeed();
    $('sharedMessage').textContent = `Your ${methodName(out.method)} brew is saved to your history and posted to the feed.`;
    go('shared');
  });
  $('saveReviewBtn').addEventListener('click', () => {
    HS.fresh = rvSave().id;
    go('history');
  });
  [['historyList', 'home'], ['hsList', 'history'], ['hsChart', 'history']].forEach(([id, from]) => $(id).addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c) openBrew(c.dataset.id, from);
  }));
  $('hsChips').addEventListener('click', (e) => { const c = e.target.closest('[data-f]'); if (!c) return; HS.filter = c.dataset.f; renderHistory(); });
  twoTap($('hsReset'), 'Tap again to reset all brews', () => { CG.Store.reset(); HS.filter = 'all'; renderHistory(); renderHome(); });
  twoTap($('bdDelete'), 'Tap again to delete', () => { CG.Store.remove(BD.id); renderHome(); go($('bdBack').dataset.nav); });
  $('bdAgain').addEventListener('click', () => {
    const r = CG.Store.get(BD.id);
    repeatRecipe(r, 'Loaded the recipe from ' + fmtDay(r.at) + '.');
  });
  $('bdApply').addEventListener('click', () => applyAdvice(CG.Store.get(BD.id)));
}

function twoTap(btn, ask, fn) {
  const label = btn.textContent, disarm = () => {
    clearTimeout(btn._t);
    btn.classList.remove('armed');
    btn.textContent = label;
  };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) return disarm(), buzz('confirm', true), fn();
    buzz('warn', true);
    btn.classList.add('armed');
    btn.textContent = ask;
    clearTimeout(btn._t);
    btn._t = setTimeout(disarm, 3000);
  });
}

function renderHistory() {
  const all = CG.Store.all(), esp = all.filter((r) => r.method === 'espresso');
  const shots = esp.slice(0, 10).reverse(), n = shots.length;
  const x = (i) => n < 2 ? 160 : 26 + 280 * i / (n - 1), y = (t) => 112 - 100 * (clamp(t, 15, 55) - 15) / 40;
  const d = shots.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.time).toFixed(1)).join('');
  const last = shots[n - 1];
  $('hsTrendHint').textContent = n ? 'Last ' + n + ' shots' : '';
  $('hsChart').innerHTML = `
    <rect class="hs-band" x="18" y="${y(CG.SHOT.targetHi)}" width="296" height="${y(CG.SHOT.targetLo) - y(CG.SHOT.targetHi)}"/>
    <text class="hs-ax" x="2" y="${y(CG.SHOT.targetHi) + 3}">${CG.SHOT.targetHi}</text><text class="hs-ax" x="2" y="${y(CG.SHOT.targetLo) + 3}">${CG.SHOT.targetLo}</text>
    <text class="hs-ax" x="2" y="${y(55) + 3}">55</text><text class="hs-ax" x="2" y="${y(15) + 3}">15</text>
    ${n > 1 ? `<path class="hs-line" pathLength="1" d="${d}"/>` : ''}
    ${shots.map((r, i) => `<circle class="hs-dot k-${r.verdict.kind}" data-id="${r.id}" cx="${x(i).toFixed(1)}" cy="${y(r.time).toFixed(1)}" r="${r === last ? 6.5 : 5}" style="animation-delay:${200 + i * 70}ms"/>`).join('')}
    ${last ? `<text class="hs-last" x="${x(n - 1) - 8}" y="${y(last.time) - 11}">${last.time.toFixed(1)} s</text>` : ''}
    ${n ? '' : '<text class="hs-ax" x="160" y="66" text-anchor="middle">No espresso shots yet</text>'}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { const l = $('hsChart').querySelector('.hs-line'); if (l) l.classList.add('on'); }));
  const ok = esp.filter((r) => r.verdict.kind === 'ok').length, rated = all.filter((r) => r.rating);
  $('hsStats').innerHTML = '<div><b data-s="0"></b><span>Brews logged</span></div><div><b data-s="1"></b><span>Shots on target</span></div><div><b data-s="2"></b><span>Average rating</span></div>';
  [[all.length, (v) => String(Math.round(v))], [esp.length ? 100 * ok / esp.length : 0, (v) => Math.round(v) + '%'],
    [rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : 0, (v) => v.toFixed(1)]].forEach(([v, fmt], i) => countTo($('hsStats').querySelector(`[data-s="${i}"]`), v, fmt));
  const methods = ['all'].concat([...new Set(all.map((r) => r.method))]);
  if (!methods.includes(HS.filter)) HS.filter = 'all';
  $('hsChips').innerHTML = methods.map((k) => `<button type="button" class="hs-chip${k === HS.filter ? ' on' : ''}" data-f="${k}">${k === 'all' ? 'All' : methodName(k)} · ${k === 'all' ? all.length : all.filter((r) => r.method === k).length}</button>`).join('');
  const list = all.filter((r) => HS.filter === 'all' || r.method === HS.filter);
  $('hsList').innerHTML = list.length ? list.map((r, i) => `
    <button type="button" class="hs-card${r.id === HS.fresh ? ' fresh' : ''}" data-id="${r.id}" style="--i:${i}">
      <div class="hs-top"><span class="hs-m">${mi(r.method)}${methodName(r.method)}</span><span class="hs-d">${fmtDay(r.at)}</span></div>
      <div class="hs-mid">${sparkline(r)}<div class="hs-nums"><b>${timeText(r)}</b><span>${r.method === 'espresso' ? r.dose + ' g → ' + r.yield + ' g · 1:' + (r.yield / r.dose).toFixed(1) : (r.dose ? r.dose + ' g coffee' : '') + (r.yield ? ' · ' + r.yield + ' g water' : '')}</span></div>${miniCompass(r.taste)}</div>
      <div class="hs-bot"><span class="rv-chip k-${r.verdict.kind}">${chipText(r)}</span><span class="hs-bean">${beanName(r.bean)} · ${r.roastDays} d off roast</span><span class="mini-stars">${starsHtml(r.rating)}</span></div>
      ${r.notes ? `<div class="hs-note">${esc(r.notes)}</div>` : ''}
    </button>`).join('') : '<div class="hs-empty">No brews logged yet. Finish a brew and save it from the review.</div>';
  HS.fresh = null;
}

function openBrew(id, from) {
  const r = CG.Store.get(id);
  if (!r) return;
  BD.id = id;
  $('bdBack').dataset.nav = from || 'history';
  $('bdTitle').textContent = methodName(r.method);
  go('brewdetail');
  document.querySelector('[data-screen=brewdetail]').scrollTop = 0;
  drawReplay(document.querySelector('[data-replay=bd]'), r);
  drawVerdict(document.querySelector('[data-verdict=bd]'), r);
  drawCompass(document.querySelector('[data-compass=bd]'), r);
  $('bdTasteLab').textContent = CG.Taste.label(r.taste);
  $('bdWhen').textContent = fmtDay(r.at);
  const p = r.prep, rows = r.method === 'espresso'
    ? [['Grind', fieldText('grind', p.grind)], ['Dose', r.dose + ' g'], ['Yield', r.yield + ' g of ' + r.target + ' g'], ['WDT', fieldText('wdt', p.wdt)],
      ['Tamp', TAMP_NAME[p.tamp] + ', ' + fieldText('level', p.level).toLowerCase()], ['Water', r.temp + ' °C']]
    : [['Grind', fieldText('grind', p.grind)], ['Coffee', r.dose ? r.dose + ' g' : '–'], ['Water', r.yield ? r.yield + ' g' : '–'], ['Temperature', r.temp + ' °C']];
  rows.push(['Grinder', r.grinder + ' · click ' + r.click], ['Beans', beanName(r.bean) + ' · ' + r.roastDays + ' d']);
  $('bdRecipe').innerHTML = rows.map(([k, v]) => `<div class="bd-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  const a = r.advice;
  $('bdAdvice').textContent = a.title;
  $('bdWhy').innerHTML = whyHtml(r, a);
  $('bdApply').classList.toggle('hidden', !a.field || a.field === 'note');
  $('bdStars').innerHTML = starsHtml(r.rating);
  $('bdNotes').textContent = r.notes || 'No notes for this brew.';
}

const QUICK = ['espresso', 'pourover', 'aeropress', 'immersion', 'chemex', 'mokapot'];
const OTHER = QUICK.slice(1);
const mi = (k, c) => k === 'import' ? '<i class="fa-solid fa-file-import' + (c ? ' ' + c : '') + '"></i>' : '<i class="mi' + (c ? ' ' + c : '') + '"><svg><use href="#mi-' + k + '"/></svg></i>';
const TAB_SCREENS = ['home', 'history', 'beans', 'feed'];

function brewStreak(list) {
  const days = new Set(list.map((r) => new Date(r.at).toDateString())), d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(d.toDateString())) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

function homeHead(list) {
  const h = new Date().getHours(), n = brewStreak(list), week = list.filter((r) => Date.now() - r.at < 7 * 86400000).length;
  $('hmGreet').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', Alex';
  $('hmSub').textContent = (n ? n + '-day streak' : 'Brew today to start a streak') + ' · ' + week + ' brew' + (week === 1 ? '' : 's') + ' this week';
}

function renderHero(list) {
  const r = list[0], el = $('hmHero');
  if (!r) {
    el.className = 'hm-hero lg empty';
    el.innerHTML = '<div class="hm-kicker">No brews yet</div><div class="hm-hero-t">Your first brew</div><div class="hm-hero-s">Pick a method. The app walks you through grind, dose and the pour, then logs it here.</div><div class="hm-hero-act"><button type="button" class="btn-primary" data-sheet="brew">Start brewing</button></div>';
    return;
  }
  const a = r.advice || {}, act = a.field && a.field !== 'note', fresh = Date.now() - r.at < 2 * 3600000;
  const sub = r.method === 'espresso' ? r.dose + ' g → ' + r.yield + ' g · 1:' + (r.yield / r.dose).toFixed(1) : beanName(r.bean) + (r.dose ? ' · ' + r.dose + ' g' : '');
  const change = act ? fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to) : a.why || '';
  el.className = 'hm-hero lg' + (fresh ? ' fresh' : '');
  el.innerHTML = `
    <div class="hm-hero-top"><span class="hm-kicker">${fresh ? '<i class="hm-live"></i>Just brewed' : 'Last brew · ' + fmtDay(r.at)}</span><span class="rv-chip k-${r.verdict.kind}">${chipText(r)}</span></div>
    <button type="button" class="hm-hero-main" data-open="${r.id}">
      <div class="hm-hero-nums"><div class="hm-hero-m">${mi(r.method)}${methodName(r.method)}</div><div class="hm-hero-t">${timeText(r)}</div><div class="hm-hero-s">${sub}</div></div>
      ${sparkline(r)}
    </button>
    <div class="hm-next"><i class="fa-solid fa-arrow-trend-up icon-fa ic-14"></i><div><b>Next: ${esc(a.title || 'Keep this recipe')}</b><span>${esc(change)}</span></div></div>
    <div class="hm-hero-act">
      <button type="button" class="btn-primary" id="hmApply">${act ? 'Apply and brew' : 'Brew again'}</button>
      <button type="button" class="btn-glass" data-open="${r.id}">Details</button>
    </div>`;
  $('hmApply').onclick = () => act ? applyAdvice(r) : repeatRecipe(r);
}

function renderQuick(list) {
  const r = list[0];
  const repeat = r ? `<button type="button" class="hm-chip repeat" data-repeat="1"><i class="fa-solid fa-rotate-right"></i>Repeat ${methodName(r.method)}</button>` : '';
  $('hmQuick').innerHTML = repeat
    + '<button type="button" class="hm-chip ft-esp" data-feature="espresso">' + mi('espresso') + 'Espresso<b>AR</b></button>'
    + '<button type="button" class="hm-chip ft-art" data-feature="liveart">' + mi('liveart') + 'LiveARt<b>AR</b></button>'
    + OTHER.map((k) => `<button type="button" class="hm-chip" data-method="${k}">${mi(k)}${methodName(k)}</button>`).join('');
}

function renderDialTile(list) {
  const esp = list.filter((r) => r.method === 'espresso'), shots = esp.slice(0, 6).reverse(), ok = esp.slice(0, 5).filter((r) => r.verdict.kind === 'ok').length;
  const x = (i) => shots.length < 2 ? 60 : 8 + 104 * i / (shots.length - 1), y = (t) => 44 - 38 * (clamp(t, 15, 55) - 15) / 40;
  $('hmDial').innerHTML = `<span class="hm-tile-k">Espresso dial-in</span>
    <svg class="hm-dial" viewBox="0 0 120 50"><rect x="0" y="${y(32)}" width="120" height="${y(25) - y(32)}" class="hs-band"/>${shots.length > 1 ? `<path d="${shots.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.time).toFixed(1)).join('')}"/>` : ''}${shots.map((r, i) => `<circle class="hs-dot k-${r.verdict.kind}" cx="${x(i).toFixed(1)}" cy="${y(r.time).toFixed(1)}" r="3.4" style="animation-delay:${i * 60}ms"/>`).join('')}</svg>
    <b>${esp.length ? ok + ' of ' + Math.min(5, esp.length) : '–'}</b><span>${esp.length ? 'recent shots on target' : 'No shots yet'}</span>`;
}

const roastState = (d) => d >= 7 && d <= 21 ? 'at its peak' : d < 7 ? 'still resting' : 'past its peak';

function renderBeanTile(list) {
  const key = list[0] ? list[0].bean : CG.Store.gear().bean, b = appState.beans.find((x) => x.key === key) || appState.beans[0];
  const f = freshness(b.daysOff), c = 94.2;
  $('hmBean').innerHTML = `<span class="hm-tile-k">In the grinder</span>
    <svg class="hm-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" style="stroke:${f.color};stroke-dasharray:${c};stroke-dashoffset:${(c * (1 - f.fraction)).toFixed(1)}" class="fg"/></svg>
    <b>${b.name}</b><span>${b.daysOff} days off roast · ${roastState(b.daysOff)}</span>`;
}

function renderHomeFeed() {
  const post = appState.feed[0];
  $('hmFeed').innerHTML = post ? `<div class="hm-post lg">
    <div class="feed-avatar">${post.initials}</div>
    <div class="hm-post-body"><div class="hm-post-top"><b>${esc(post.user)}</b><span>${esc(post.method)} · ${esc(post.time)}</span></div><div class="hm-post-note">${esc(post.notes)}</div></div>
    <button type="button" class="hm-try" data-try="0">Try</button></div>` : '';
}

function renderHome() {
  const list = CG.Store.all();
  homeHead(list);
  renderHero(list);
  renderQuick(list);
  renderDialTile(list);
  renderBeanTile(list);
  renderHomeFeed();
  $('historyList').innerHTML = list.length ? list.slice(1, 7).map((h) => `
    <button type="button" class="history-card" data-id="${h.id}">
      <div class="row-top"><span class="method">${mi(h.method)}${methodName(h.method)}</span><span class="date">${fmtDay(h.at, true)}</span></div>
      <div class="hc-v"><span class="rv-chip k-${h.verdict.kind}">${chipText(h)}</span><b>${timeText(h)}</b></div>
      <div class="notes">${esc(h.notes || h.verdict.title)}</div>
      <div class="mini-stars">${starsHtml(h.rating)}</div>
    </button>`).join('') : '<div class="hs-empty">No brews yet.</div>';
}

function openFeature(f) {
  if (f === 'liveart') go('studio');
  else quickMethod('espresso');
}

function quickMethod(k) {
  appState.method = k;
  updateMethodSelectionUI();
  go('grind');
  document.querySelector('[data-screen=grind]').scrollTop = 0;
}

function tryPost(i) {
  quickMethod(appState.feed[i].methodKey);
}

function brewBean(key) {
  appState.scannedBag = key;
  quickMethod((BAG_DATA[key] || BAG_DATA.broadway).methodKey);
}

function syncTabs(name) {
  const on = TAB_SCREENS.includes(name), bar = $('tabbar');
  if (!bar) return;
  bar.classList.toggle('off', !on);
  if (!on) { closeSheet(); return; }
  const b = bar.querySelector(`[data-tab="${name}"]`);
  bar.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  $('tabLens').classList.toggle('off', !b);
  if (b) $('tabLens').style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - 29}px)`;
}

function openSheet(html) {
  $('sheetBody').innerHTML = html;
  $('sheet').classList.add('on');
  $('sheetScrim').classList.add('on');
}

function closeSheet() {
  if (!$('sheet')) return;
  $('sheet').classList.remove('on');
  $('sheetScrim').classList.remove('on');
}

function brewSheet() {
  const r = CG.Store.all()[0], a = r && r.advice, act = a && a.field && a.field !== 'note';
  const recipe = r ? (r.method === 'espresso' ? fieldText('grind', r.prep.grind) + ' · ' + r.dose + ' g → ' + r.yield + ' g' : fieldText('grind', r.prep.grind)) : '';
  openSheet(`<div class="sh-title">Start a brew</div>
    <div class="sh-ft">
      <button type="button" class="ft-esp" data-feature="espresso"><span class="ft-badge"><b>AR</b>Live X-Ray</span>${mi('espresso')}<strong>Espresso</strong></button>
      <button type="button" class="ft-art" data-feature="liveart"><span class="ft-badge"><b>AR</b>Pour coach</span>${mi('liveart')}<strong>LiveARt</strong></button>
    </div>
    ${r ? `<button type="button" class="sh-row main" data-sh="repeat"><i class="fa-solid fa-rotate-right"></i><div><b>Repeat last ${methodName(r.method)}</b><span>${recipe}</span></div><em>Go</em></button>` : ''}
    ${act ? `<button type="button" class="sh-row" data-sh="advice"><i class="fa-solid fa-arrow-trend-up"></i><div><b>Try the advice: ${esc(a.title)}</b><span>${fieldText(a.field, a.from)} → ${fieldText(a.field, a.to)}</span></div><em>Go</em></button>` : ''}
    <div class="sh-k">Other methods</div>
    <div class="sh-grid">${OTHER.map((k) => `<button type="button" data-method="${k}">${mi(k)}<span>${methodName(k)}</span></button>`).join('')}</div>`);
}

function settingsSheet() {
  const g = CG.Store.gear();
  openSheet(`<div class="sh-title">Settings</div>
    <div class="sh-set"><span>Grinder</span><select id="setGrinder">${CG.GRINDERS.map((x) => `<option${x === g.grinder ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="sh-set"><span>Espresso water</span><div class="rv-num"><button type="button" data-set="-1">&minus;</button><input id="setTemp" type="number" value="${g.temp}"><em>°C</em><button type="button" data-set="1">+</button></div></div>
    <div class="sh-set"><span>Vibration</span><button type="button" class="sh-switch${buzzOn ? ' on' : ''}" id="setBuzz" role="switch" aria-checked="${buzzOn}" aria-label="Vibration"><i></i></button></div>
    <button type="button" class="btn-ghost sh-reset" id="setAr"><i class="fa-solid fa-glasses"></i> AR glasses view</button>
    <div class="sh-set"><span>Tracking</span><em class="sh-note">${CG.Tracker.available() ? 'Ready. Point at Plate 01, Pour Mat 02 or Cup Ring 03.' : CG.Tracker.why(true)}</em></div>
    <div class="sh-set"><span>Test log</span><em class="sh-note" id="setLogN"></em></div>
    <button type="button" class="btn-ghost sh-reset" id="setLog"><i class="fa-solid fa-copy"></i> Copy test log</button>
    <button type="button" class="btn-ghost sh-reset" id="setLogClear">Clear test log</button>
    <button type="button" class="btn-ghost sh-reset" id="setReset">Reset demo data</button>`);
  const log = () => { try { return localStorage.getItem('cg-testlog') || '[]'; } catch (e) { return '[]'; } };
  const count = () => { $('setLogN').textContent = JSON.parse(log()).length + ' events on this phone'; };
  count();
  $('setLog').onclick = () => navigator.clipboard.writeText(log()).then(() => { $('setLogN').textContent = 'Copied. Paste it into your notes.'; }, count);
  twoTap($('setLogClear'), 'Tap again to clear', () => { try { localStorage.removeItem('cg-testlog'); } catch (e) {} count(); });
  const save = () => CG.Store.setGear(Object.assign(CG.Store.gear(), { grinder: $('setGrinder').value, temp: clamp(Number($('setTemp').value) || g.temp, 85, 98) }));
  $('setAr').onclick = () => { closeSheet(); setGlasses(true); };
  $('setBuzz').onclick = () => {
    setBuzz(!buzzOn);
    $('setBuzz').classList.toggle('on', buzzOn);
    $('setBuzz').setAttribute('aria-checked', buzzOn);
  };
  $('setGrinder').onchange = save;
  $('setTemp').oninput = save;
  $('sheetBody').querySelectorAll('[data-set]').forEach((b) => { b.onclick = () => { $('setTemp').value = Number($('setTemp').value) + Number(b.dataset.set); save(); }; });
  twoTap($('setReset'), 'Tap again to reset', () => { CG.Store.reset(); renderHome(); closeSheet(); });
}

function initHome() {
  const act = (e) => {
    const t = e.target.closest('[data-feature],[data-repeat],[data-method],[data-nav-to],[data-open],[data-try],[data-sheet],[data-sh],[data-bean]');
    if (!t) return;
    const r = CG.Store.all()[0];
    closeSheet();
    if (t.dataset.feature) openFeature(t.dataset.feature);
    else if (t.dataset.repeat || t.dataset.sh === 'repeat') repeatRecipe(r);
    else if (t.dataset.sh === 'advice') applyAdvice(r);
    else if (t.dataset.method && !t.classList.contains('method-card')) quickMethod(t.dataset.method);
    else if (t.dataset.navTo) go(t.dataset.navTo);
    else if (t.dataset.open) openBrew(t.dataset.open, 'home');
    else if (t.dataset.try) tryPost(Number(t.dataset.try));
    else if (t.dataset.sheet) brewSheet();
    else if (t.dataset.bean) brewBean(t.dataset.bean);
  };
  document.querySelector('[data-screen=home]').addEventListener('click', act);
  $('sheet').addEventListener('click', act);
  $('hmDial').addEventListener('click', () => go('history'));
  $('hmBean').addEventListener('click', () => go('beans'));
  $('settingsBtn').addEventListener('click', settingsSheet);
  $('tabBrew').addEventListener('click', () => ($('sheet').classList.contains('on') ? closeSheet() : brewSheet()));
  $('sheetScrim').addEventListener('click', closeSheet);
  $('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab],[data-feature]');
    if (!b) return;
    closeSheet();
    if (b.dataset.feature) openFeature(b.dataset.feature);
    else go(b.dataset.tab);
  });
  $('beanList').addEventListener('click', (e) => { const b = e.target.closest('[data-bean]'); if (b) brewBean(b.dataset.bean); });
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  document.documentElement.classList.toggle('lg-refract', brands.some((b) => b.brand === 'Chromium'));
  syncTabs('home');
}

function renderFeed() {
  $('feedList').innerHTML = appState.feed.map((post, i) => `
    <div class="feed-card">
      <div class="feed-thumb">
        <div class="feed-play"><span><i class="fa-solid fa-play icon-fa ic-cream ic-14"></i></span></div>
        <div class="feed-duration">${post.duration}</div>
        <div class="feed-method-badge">${post.method}</div>
      </div>
      <div class="feed-body">
        <div class="feed-user-row">
          <div class="feed-avatar">${post.initials}</div>
          <div style="flex:1"><div class="feed-user-name">${post.user}</div><div class="feed-user-time">${post.time}</div></div>
          <div style="display:flex;gap:1px">${[0,1,2,3,4].map((i) => miniStarSvg(i < post.rating)).join('')}</div>
        </div>
        <div class="feed-notes">${post.notes}</div>
        <div class="try-recipe-btn" data-i="${i}">Try this recipe</div>
      </div>
    </div>`).join('');

  document.querySelectorAll('.try-recipe-btn').forEach((el) => el.addEventListener('click', () => tryPost(Number(el.dataset.i))));
}

const camOn = (cam, id) => cam.start($(id + 'Video')).then((res) => {
  $(id + 'Video').classList.toggle('hidden', !res.granted);
  $(id + 'Fallback').classList.toggle('hidden', res.granted);
  return res.granted;
});

function initCoach() {
  $('lvPlay').addEventListener('click', () => CG.Model.toggle());
  $('lvSpin').addEventListener('click', () => $('lvSpin').classList.toggle('on', CG.Model.toggleSpin()));
}

function onEnterSetup() {
  stopCoach();
  CG.Setup.render();
  CG.Model.mount();
  CG.Model.setPattern(CG.UI.key);
  CG.Model.syncPlayUI();
}

function onEnterLineup() {
  if (uiState.sound) beatAudioOn();
  camOn(getReadyCamera, 'getready');
  CG.Lineup.enter();
}

function stopLineup() {
  CG.Lineup.exit();
  getReadyCamera.stop();
}

const lnScreen = () => document.querySelector('.ln-screen');

function initPour() {
  lnScreen().addEventListener('click', (e) => { if (CG.Coach.hold && !e.target.closest('[data-nav]')) CG.Coach.go(); });
}

function onEnterCoach() {
  MAT.armed = true;
  Object.assign(MAT, { openAt: performance.now(), taps: 0, pick: null, turn: 90 });
  tlog('coach-open', { pattern: uiState.key });
  MAT.run += 1;
  lnScreen().classList.remove('track-fail');
  lnScreen().classList.add('pinned');
  camOn(coachCamera, 'coach').then((granted) => {
    lnScreen().classList.toggle('has-cam', granted);
    trackMat(granted);
  });
  CG.Pour.enter();
}

function stopCoach() {
  coachCamera.stop();
  if (MAT.armed || MAT.live) CG.Tracker.stop();
  clearTimeout(MAT.lostT);
  MAT.armed = MAT.live = false;
  uiState.range = null;
  lnScreen().classList.remove('pinned', 'found', 'track-fail', 'on-ring', 'picking');
  $('lnDist').classList.remove('show');
  CG.Pour.exit();
}

function startPour() {
  CG.Coach.start(CG.Coach.key, { speed: uiState.speed, watch: uiState.watch && !uiState.range, stops: uiState.stops, range: uiState.range });
}

function matLost() {
  tlog('lost', { pour: CG.Coach.running });
  MAT.live = false;
  MAT.pick = null;
  lnScreen().classList.remove('picking');
  MAT.s = 0;
  lnScreen().classList.remove('found');
  $('lnDist').classList.remove('show');
}

function onMat(pose) {
  clearTimeout(MAT.lostT);
  if (!pose) { MAT.lostT = setTimeout(matLost, 2500); return; }
  if (!MAT.live) tlog('found', { prop: onRing() ? `ring ${cupRing().oz} oz` : 'mat', ms: Math.round(performance.now() - MAT.openAt) });
  MAT.live = true;
  const scr = lnScreen(), picking = MAT.armed && onRing();
  scr.classList.add('found');
  scr.classList.toggle('on-ring', onRing());
  scr.classList.toggle('picking', picking);
  matFit();
  CG.Tracker.hint($('lnDist'), { [CG.TARGETS.pourmat]: 0.38, [CG.TARGETS.cupring]: 0.62, [CG.TARGETS.cupring8]: 0.62 });
  const ready = picking && ringPick();
  CG.Pour.draw();
  if (MAT.armed && (!onRing() || ready)) {
    MAT.armed = false;
    scr.classList.remove('picking');
    buzz('success', true);
    tlog('pour-start', { pattern: uiState.key, via: onRing() ? 'ring' : 'mat' });
    startPour();
  }
}

async function trackMat(granted) {
  if (!MAT.armed) return;
  const run = MAT.run, ok = granted && await CG.Tracker.start($('coachVideo'), [CG.TARGETS.cupring, CG.TARGETS.cupring8, CG.TARGETS.pourmat], onMat);
  if (ok || run !== MAT.run || !MAT.armed) return;
  CG.Tracker.fail(lnScreen(), granted, () => {
    MAT.armed = false;
    lnScreen().classList.remove('pinned', 'found');
    startPour();
  });
}

function renderBeans() {
  $('beanList').innerHTML = appState.beans.map((b) => {
    const f = freshness(b.daysOff);
    const circ = 131.9;
    const roasted = new Date(Date.now() - b.daysOff * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<div class="bean-row" data-bean="${b.key}">
      <svg width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="21" fill="none" stroke="rgba(43,27,18,.12)" stroke-width="5"/><circle cx="26" cy="26" r="21" fill="none" stroke="${f.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - f.fraction)}" transform="rotate(-90 26 26)"/></svg>
      <div class="info">
        <div class="name">${b.name}</div>
        <div class="origin">${b.origin} · ${b.process}</div>
        <div class="roast">Roasted ${roasted} · ${b.daysOff} days off roast</div>
      </div>
      <span class="bean-go">Brew</span>
    </div>`;
  }).join('');
}

function initScan() {
  document.querySelectorAll('[data-bag]').forEach((el) => {
    el.addEventListener('click', () => {
      scanCamera.stop();
      appState.scannedBag = el.dataset.bag;
      renderBagDetail();
      showScreen('bagdetail');
    });
  });
  document.querySelectorAll('[data-stop-scan]').forEach((el) => el.addEventListener('click', () => scanCamera.stop()));
}
const scannedBag = () => BAG_DATA[appState.scannedBag] || BAG_DATA.broadway;

function onEnterScan() {
  camOn(scanCamera, 'scan');
}
function renderBagDetail() {
  const bag = scannedBag();
  $('bagName').textContent = bag.name;
  $('bagRoastBadge').textContent = bag.roastLabel;
  $('bagContext').textContent = bag.context;
  $('bagNotes').innerHTML = bag.notes.map((n) => `<span class="tag">${n}</span>`).join('');
}
function renderOriginStory() {
  const bag = scannedBag();
  $('originTitle').textContent = bag.name + ' · Origin';
  $('originRoastedIn').textContent = bag.roastedIn;
  if (bag.originExplainer) {
    $('originFacts').innerHTML = `<div class="fact-card stack">
      <div class="fact-title-row">
        <i class="fa-solid fa-circle-check icon-fa ic-teal-dark ic-20"></i>
        <div class="fact-title">${bag.originFact}</div>
      </div>
      <div class="fact-explainer">${bag.originExplainer}</div>
    </div>`;
  } else {
    $('originFacts').innerHTML = `<div class="fact-card">
      <i class="fa-solid fa-seedling icon-fa ic-teal-dark ic-20"></i>
      <div>${bag.originFact}</div>
    </div>`;
  }
}
function initBagDetail() {
  $('bagPhoto').addEventListener('click', () => { renderOriginStory(); showScreen('originstory'); });
  $('brewThisBagBtn').addEventListener('click', () => {
    const bag = scannedBag();
    appState.method = bag.methodKey;
    updateMethodSelectionUI();
    renderGrind();
    showScreen('grind');
  });
}

const ENTER = { home: renderHome, grind: renderGrind, history: renderHistory, beans: renderBeans, beanscan: onEnterScan, studio: onEnterSetup, getready: onEnterLineup, coach: onEnterCoach, forensics: () => CG.Forensics.enter() };
const LEAVE = { studio: () => CG.Model.remove(), getready: stopLineup, coach: stopCoach };
let currentScreen = 'home';

function go(target) {
  if (LEAVE[currentScreen]) LEAVE[currentScreen]();
  currentScreen = target;
  if (ENTER[target]) ENTER[target]();
  showScreen(target);
}

function initNav() {
  document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => go(el.dataset.nav)));
}

function fitPhoneToViewport() {
  const phone = $('phoneEl');
  if (!phone) return;
  const scale = document.body.classList.contains('glasses') ? 1 : Math.min(1, (window.innerWidth - 24) / 390, (window.innerHeight - 24) / 844);
  const next = scale.toFixed(4);
  if (phone.dataset.scale === next) return;
  phone.dataset.scale = next;
  phone.style.transform = scale < 1 ? `scale(${next})` : '';
  $('page').style.padding = scale < 1 ? '0' : '';
}
window.addEventListener('resize', fitPhoneToViewport);
fitPhoneToViewport();

initHome();
renderHome();
initMethod();
initLiveBrew();
initGlasses();
initReview();
renderFeed();
initCoach();
initPour();
initScan();
initBagDetail();
initNav();
initPrep();
updateMethodSelectionUI();
if (CG.Tracker.available()) CG.Tracker.load();

const DEEP = { ring: () => go('coach'), mat: () => go('coach'), plate: () => { appState.method = 'espresso'; go('grind'); } };
const deepKey = location.hash.slice(1);
if (DEEP[deepKey]) {
  history.replaceState(null, '', location.pathname + location.search);
  tlog('qr', { prop: deepKey });
  setTimeout(DEEP[deepKey], 0);
}

const CAM = { pitch: 52, dist: 560, f: 620, cx: 195, cy: 452 };
const MAT = { wMm: 297, hMm: 210, rimMm: 45, cupMm: 72, baseMm: 32, live: false, armed: false, run: 0, s: 0, turn: 90, pick: null, pickAt: 0, openAt: 0, taps: 0 };
const RING = { holdMs: 1200, labels: [['heart', 90], ['tulip', 210], ['rosetta', 330]] };
const RINGS = { [CG.TARGETS.cupring]: { oz: 12, wMm: 150, hMm: 150, rimMm: 45, cupMm: 110, baseMm: 29 }, [CG.TARGETS.cupring8]: { oz: 8, wMm: 133.3, hMm: 133.3, rimMm: 40, cupMm: 92, baseMm: 28 } };
const MILK = { cv: null, ctx: null, at: 0, x: 50, y: 50, area: 0, rows: [] };
const onRing = () => !!RINGS[CG.Tracker.index()];
const cupRing = () => RINGS[CG.Tracker.index()] || RINGS[CG.TARGETS.cupring];
const prop = () => onRing() ? cupRing() : MAT;
const SCALE = 2.9;
const zWorld = (mm) => 13.6 * Math.pow(Math.max(0, mm), 0.58);
const SPOUT_R = 25;

function matPt(u, v, zmm) {
  const [w, h] = CG.Tracker.box(), s = Math.max(w / 390, h / 844), p = CG.Tracker.point(u, v, (zmm || 0) / prop().wMm);
  return [(p[0] - (w - 390 * s) / 2) / s, (p[1] - (h - 844 * s) / 2) / s];
}

function ringUV(x, y) {
  const r = cupRing(), a = (MAT.turn - 90) * Math.PI / 180, k = r.rimMm / 44, dx = (x - 50) * k, dy = (y - 50) * k;
  return [0.5 + (dx * Math.cos(a) - dy * Math.sin(a)) / r.wMm, 0.5 + (dx * Math.sin(a) + dy * Math.cos(a)) / r.hMm];
}

const ringAt = (deg, r) => matPt(0.5 + r * Math.cos(deg * Math.PI / 180), 0.5 + r * Math.sin(deg * Math.PI / 180), 0);

function ringArc(a0, sweep, r) {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / 4));
  return poly(Array.from({ length: n + 1 }, (_, i) => ringAt(a0 + sweep * i / n, r)), false);
}

function ringPick() {
  const [key, deg] = RING.labels.reduce((b, l) => ringAt(l[1], 0.4)[1] > ringAt(b[1], 0.4)[1] ? l : b), now = performance.now();
  MAT.turn = deg;
  if (MAT.pick !== key) {
    MAT.pick = key;
    MAT.pickAt = now;
    buzz('select', true);
    if (key !== uiState.key) { uiState.key = key; CG.Pour.enter(); }
  }
  const p = clamp((now - MAT.pickAt) / RING.holdMs);
  $('lnCountNum').textContent = CG.PATTERNS[key].name;
  $('lnCountSub').textContent = 'Turn the cup to change. Hold still to start.';
  POUR.pick.setAttribute('d', ringArc(deg - 26, 52 * p, 0.462));
  POUR.pickT.setAttribute('d', ringArc(deg - 26, 52, 0.462));
  return p >= 1;
}

function milkRead() {
  const v = $('coachVideo'), now = performance.now();
  if (!onRing() || !MAT.live || !v.videoWidth || now - MILK.at < 200) return;
  MILK.at = now;
  if (!MILK.cv) { MILK.cv = document.createElement('canvas'); MILK.ctx = MILK.cv.getContext('2d', { willReadFrequently: true }); }
  const W = MILK.cv.width = 160, H = MILK.cv.height = Math.round(160 * v.videoHeight / v.videoWidth), k = W / v.videoWidth;
  MILK.ctx.drawImage(v, 0, 0, W, H);
  const img = MILK.ctx.getImageData(0, 0, W, H).data;
  let n = 0, hit = 0, sx = 0, sy = 0;
  for (let y = 12; y <= 88; y += 4) for (let x = 12; x <= 88; x += 4) {
    if (Math.hypot(x - 50, y - 50) > 39) continue;
    const [px, py] = CG.Tracker.px(...ringUV(x, y), 0), i = (Math.round(py * k) * W + Math.round(px * k)) * 4;
    if (px < 0 || py < 0 || i >= img.length) continue;
    const r = img[i], g = img[i + 1], b = img[i + 2], mx = Math.max(r, g, b, 1);
    n++;
    if ((r * 0.3 + g * 0.59 + b * 0.11) / 255 > 0.66 && (mx - Math.min(r, g, b)) / mx < 0.28) { hit++; sx += x; sy += y; }
  }
  MILK.area = n ? hit / n : 0;
  if (hit) { MILK.x = sx / hit; MILK.y = sy / hit; }
}

function milkSummary(key) {
  const rows = MILK.rows.filter((r) => r[0] >= CG.PATTERNS[key].dur * 0.6);
  if (rows.length < 3) return null;
  const avg = (i) => rows.reduce((a, r) => a + r[i], 0) / rows.length, mm = cupRing().rimMm / 44;
  return { dx: (avg(1) - 50) * mm, dy: (avg(2) - 50) * mm, area: rows[rows.length - 1][3] };
}

function matProject(x, y, zmm) {
  if (onRing()) return matPt(...ringUV(x, y), zmm || 0);
  const k = MAT.rimMm / 44 * MAT.s;
  return matPt(0.5 + (x - 50) * k / MAT.wMm, 0.5 + (y - 50) * k / MAT.hMm, (MAT.cupMm + (zmm || 0)) * MAT.s);
}

function matFit() {
  const r = MAT.rimMm / MAT.wMm, a = matPt(0.5 - r, 0.5, MAT.cupMm), b = matPt(0.5 + r, 0.5, MAT.cupMm);
  const want = clamp(AR_FIT.cup * 390 / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), 1, AR_FIT.max);
  MAT.s = arScale(MAT.s, want);
}

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => list.reduce((h, q) => { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); return h; }, []);
  const lo = half(p), up = half(p.reverse());
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function cupBody() {
  const ring = (r, z) => Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return project(50 + r * Math.cos(a), 50 + r * Math.sin(a), z); });
  const c = prop();
  return poly(hull(ring(44, 0).concat(ring(44 * c.baseMm / c.rimMm, -c.cupMm))), true);
}

function matScrim() {
  const circ = (r) => poly(Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2; return matPt(0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a), 0); }), true);
  if (onRing()) return circ(0.53) + circ(cupRing().rimMm / cupRing().wMm);
  return poly([[-0.04, -0.06], [1.04, -0.06], [1.04, 1.06], [-0.04, 1.06]].map(([u, v]) => matPt(u, v, 0)), true);
}

function project(x, y, zmm) {
  if (MAT.live && tk.index >= 0) return matProject(x, y, zmm);
  const th = CAM.pitch * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const X = (x - 50) * SCALE;
  const Y = -(y - 50) * SCALE;
  const Z = zWorld(zmm || 0);
  const depth = Y * c - Z * s + CAM.dist;
  const up    = Y * s + Z * c;
  const k = CAM.f / Math.max(60, depth);
  return [CAM.cx + X * k, CAM.cy - up * k];
}
const P0 = (x, y) => project(x, y, 0);

const fx = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
const poly = (pts, close) => pts.map((p, i) => (i ? 'L' : 'M') + fx(p)).join(' ') + (close ? ' Z' : '');
const around = (n, f) => Array.from({ length: n + 1 }, (_, i) => f((i / n) * Math.PI * 2));
const circlePath = (cx, cy, r, n) => poly(around(n, (a) => P0(cx + Math.cos(a) * r, cy + Math.sin(a) * r)), true);
const rimPath = (r) => circlePath(50, 50, r, 72);
const ringPath = (x, y, zmm, r) => poly(around(40, (a) => project(x + (Math.cos(a) * r) / SCALE, y + (Math.sin(a) * r) / SCALE, zmm)), true);
const stalkPath = (x, y, zmm) => poly([project(x, y, zmm), P0(x, y)], false);

const rosettaWiggle = (u, t) => ({
  x: 50 + (25 - 16 * u) * Math.sin(2 * Math.PI * 2.4 * t),
  y: 72 - 46 * u,
});

CG.PATTERNS = {
  heart: {
    name: 'Heart', dur: 11, level: 1,
    blurb: 'One pour, then one line through the middle. Every other pattern starts here.',
    steps: [
      { key: 'fill',  label: 'Fill',   t0: 0,   t1: 4.0,  h: [45, 65], f: [3, 5],   hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 58 + 6 * u }),
        why: 'Pour high with a thin stream. The milk sinks under the crema and fills the cup.' },
      { key: 'bloom', label: 'Bloom',  t0: 4.0, t1: 8.2,  h: [8, 14],  f: [8, 11],  hz: 0, cue: 'Come close and hold still',
        pos: () => ({ x: 50, y: 66 }),
        why: 'Bring the jug close to the surface and hold still. A white circle spreads out.' },
      { key: 'cut',   label: 'Cut',    t0: 8.2, t1: 11,   h: [22, 32], f: [2, 4],   hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 22 + 60 * u }),
        why: 'Lift a little and pull a thin line through the circle, away from you.' },
    ],
  },

  tulip: {
    name: 'Tulip', dur: 13, level: 2,
    blurb: 'Three small pours stacked on top of each other. You learn when to stop and start.',
    steps: [
      { key: 'fill',  label: 'Fill',   t0: 0,    t1: 3.4,  h: [45, 65], f: [3, 5],  hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 58 + 8 * u }),
        why: 'Same high, thin pour as the heart. Nothing shows on top yet.' },
      { key: 'push1', label: 'Push 1', t0: 3.4,  t1: 5.6,  h: [8, 14],  f: [8, 11], hz: 0, cue: 'Come close and pour',
        pos: () => ({ x: 50, y: 70 }),
        why: 'Come down close and pour. This first blob is the biggest.' },
      { key: 'stop1', label: 'Stop',   t0: 5.6,  t1: 6.4,  h: [22, 30], f: [0, 1],  hz: 0, cue: 'Lift and stop', join: true,
        pos: () => ({ x: 50, y: 62 }),
        why: 'Lift the jug and stop pouring. The pause keeps the petals apart.' },
      { key: 'push2', label: 'Push 2', t0: 6.4,  t1: 8.4,  h: [8, 14],  f: [7, 10], hz: 0, cue: 'Pour again, a bit further up', join: true,
        pos: () => ({ x: 50, y: 56 }),
        why: 'Pour again a little further up the cup. It pushes the first blob forward.' },
      { key: 'stop2', label: 'Stop',   t0: 8.4,  t1: 9.1,  h: [22, 30], f: [0, 1],  hz: 0, cue: 'Lift and stop', join: true,
        pos: () => ({ x: 50, y: 50 }),
        why: 'Stop again, a bit shorter this time.' },
      { key: 'push3', label: 'Push 3', t0: 9.1,  t1: 10.6, h: [8, 13],  f: [6, 9],  hz: 0, cue: 'One small last pour', join: true,
        pos: () => ({ x: 50, y: 42 }),
        why: 'One small last pour near the far edge.' },
      { key: 'cut',   label: 'Cut',    t0: 10.6, t1: 13,   h: [22, 32], f: [2, 4],  hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 26 + 56 * u }),
        why: 'Draw one line down through all three. That is the stem.' },
    ],
  },

  rosetta: {
    name: 'Rosetta', dur: 14, level: 3,
    blurb: 'Rock the jug side to side while you move back. Keep the rhythm even.',
    steps: [
      { key: 'fill',   label: 'Fill',   t0: 0,    t1: 3.6,  h: [45, 65], f: [3, 5],   hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 60 + 10 * u }),
        why: 'Pour high and thin into the near half. Keep the top clean for now.' },
      { key: 'bloom',  label: 'Bloom',  t0: 3.6,  t1: 5.5,  h: [8, 14],  f: [7, 10],  hz: 2.4, cue: 'Come close and start rocking',
        pos: (u, t) => ({ x: 50 + 25 * Math.sin(2 * Math.PI * 2.4 * t), y: 72 }),
        why: 'Drop close and start rocking the jug side to side on the spot.' },
      { key: 'wiggle', label: 'Wiggle', t0: 5.5,  t1: 10.5, h: [8, 14],  f: [6, 9],   hz: 2.4, cue: 'Keep rocking, move back', join: true,
        pos: rosettaWiggle,
        why: 'Keep the same rhythm as you move back to the far edge. Let the swings get smaller.' },
      { key: 'cap',    label: 'Cap',    t0: 10.5, t1: 11.5, h: [8, 14],  f: [8, 11],  hz: 0, cue: 'Stop rocking, one small blob', join: true,
        pos: () => ({ x: 50, y: 24 }),
        why: 'Stop rocking and pour one small blob at the top.' },
      { key: 'cut',    label: 'Cut',    t0: 11.5, t1: 14,   h: [22, 32], f: [2, 4],   hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 20 + 64 * u }),
        why: 'Lift up and pull a thin line down through the leaves.' },
    ],
  },
};

CG.target = (key, t) => {
  const pat = CG.PATTERNS[key], steps = pat.steps;
  t = clamp(t, 0, pat.dur - 0.001);
  const i = steps.findIndex((x, k) => t < x.t1 || k === steps.length - 1), step = steps[i];
  const u = clamp((t - step.t0) / (step.t1 - step.t0)), p = step.pos(u, t);
  const xs = step.hz > 0 ? Array.from({ length: 12 }, (_, k) => step.pos(u, t + (k / 12) / step.hz).x) : null;
  return {
    step, stepIndex: i, u, x: p.x, y: p.y, hz: step.hz,
    amp: xs ? (Math.max(0, ...xs) - Math.min(100, ...xs)) / 2 : 0,
    heightMm: (step.h[0] + step.h[1]) / 2,
    flow: (step.f[0] + step.f[1]) / 2,
  };
};

function spineAt(key, t) {
  const g = CG.target(key, t);
  if (g.hz <= 0) return { x: g.x, y: g.y, amp: 0 };
  let sx = 0;
  for (let k = 0; k < 10; k++) sx += g.step.pos(g.u, t + (k / 10) / g.hz).x;
  return { x: sx / 10, y: g.y, amp: g.amp };
}

function routePath(key, a = 0, b = CG.PATTERNS[key].dur) {
  const n = Math.max(2, Math.round((b - a) * 24));
  return Array.from({ length: n + 1 }, (_, i) => {
    const q = spineAt(key, a + (b - a) * (i / n));
    return (i ? 'L' : 'M') + fx(P0(q.x, q.y));
  }).join(' ');
}

function envelopePaths(key) {
  const L = [], R = [];
  for (let t = 0; t <= CG.PATTERNS[key].dur; t += 0.05) {
    const q = spineAt(key, t);
    if (q.amp > 1.5) { L.push(P0(q.x - q.amp, q.y)); R.push(P0(q.x + q.amp, q.y)); }
  }
  return L.length ? [poly(L, false), poly(R, false)] : [];
}

function artElements(key) {
  const blob = (cx, cy, r, t) => ({ t, d: circlePath(cx, cy, r, 36) });
  const line = (x0, y0, x1, y1, t) => ({ t, d: poly(Array.from({ length: 13 }, (_, i) => P0(x0 + (x1 - x0) * (i / 12), y0 + (y1 - y0) * (i / 12))), false) });
  if (key === 'heart') return [blob(50, 66, 26, 5.4), line(50, 22, 50, 82, 9.4)];
  if (key === 'tulip') return [blob(50, 70, 22, 4.6), blob(50, 56, 17, 7.4), blob(50, 43, 12, 9.9), line(50, 26, 50, 82, 11.6)];
  if (key !== 'rosetta') return [];
  return Array.from({ length: 9 }, (_, i) => {
    const u = i / 8, amp = 25 - 16 * u, y = 72 - 46 * u, dip = amp * 0.42;
    return { t: 4.4 + i * 0.68, d: poly(Array.from({ length: 15 }, (_, k) => P0(50 - amp + 2 * amp * (k / 14), y + dip * Math.sin(Math.PI * (k / 14)))), false) };
  }).concat(blob(50, 24, 9, 11.2), line(50, 20, 50, 84, 12.6));
}

const tiltToFlow = (deg) => Math.max(0, (deg - 22) * 0.30);
const flowToTilt = (ml) => 22 + ml / 0.30;

const FAULTS = {
  rosetta: { slow: [6.4, 8.8], high: [3.9, 5.2] },
  tulip:   { high: [6.6, 8.2], lean: [9.1, 10.6] },
  heart:   { lean: [4.6, 6.4] },
};

const ScriptedSource = {
  read(t, key) {
    const g = CG.target(key, t), F = FAULTS[key] || {}, inWin = (w) => w && t > w[0] && t < w[1];
    const faltering = inWin(F.slow), hz = faltering ? 1.35 : g.hz, wobble = Math.sin(t * 1.7) * 1.6 + Math.sin(t * 4.3) * 0.7;
    let x = g.x;
    if (g.hz > 0) x = 50 + (g.x - 50) * (faltering ? 0.32 : 1) * (hz / (g.hz || 1));
    return {
      x: x + (wobble * 0.6 + (inWin(F.lean) ? 7.5 : 0) + CG.Faults.dx),
      y: g.y + (Math.sin(t * 2.1) * 0.9 + CG.Faults.dy),
      heightMm: g.heightMm * (1 + Math.sin(t * 1.1) * 0.10) + (inWin(F.high) ? 15 : 0) + CG.Faults.dh,
      flow: g.flow * (1 + Math.sin(t * 1.9) * 0.09) + CG.Faults.df,
      hz,
    };
  },
};

const MotionSource = {
  pitch: 0, yaw: 0, roll: 0, crossings: [], hz: 0, live: false, last: 0,
  async enable() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission && await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
      window.addEventListener('deviceorientation', (e) => Object.assign(MotionSource, { pitch: e.beta || 0, yaw: e.alpha || 0, roll: e.gamma || 0, live: true }));
      window.addEventListener('devicemotion', (e) => {
        const M = MotionSource, ax = (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x) || 0, now = performance.now() / 1000;
        if (M.last <= 0 && ax > 0.8) M.crossings.push(now);
        M.last = ax;
        while (M.crossings.length && now - M.crossings[0] > 2) M.crossings.shift();
        M.hz = M.crossings.length / 2;
      });
      return true;
    } catch (e) { return false; }
  },
  read(t, key) {
    const g = CG.target(key, t);
    if (!MotionSource.live) return ScriptedSource.read(t, key);
    CAM.pitch = clamp(90 - Math.abs(MotionSource.pitch), 28, 76);
    return { x: 50 + clamp(MotionSource.roll * 0.8, -40, 40), y: g.y, heightMm: g.heightMm, flow: tiltToFlow(Math.abs(MotionSource.pitch)), hz: MotionSource.hz / CG.Coach.speed };
  },
};

const WizardSource = {
  state: { dx: 0, dy: 0, dh: 0, df: 0, dhz: 0 },
  enable() {
    try { new BroadcastChannel('liveart-wizard').onmessage = (m) => Object.assign(WizardSource.state, m.data || {}); } catch (e) {}
    const keys = { ArrowLeft: ['dx', -2], ArrowRight: ['dx', 2], ArrowUp: ['dh', 4], ArrowDown: ['dh', -4] };
    window.addEventListener('keydown', (e) => { const k = keys[e.key]; if (k) WizardSource.state[k[0]] += k[1]; });
    return true;
  },
  read(t, key) {
    const g = CG.target(key, t), s = WizardSource.state;
    return { x: g.x + s.dx, y: g.y + s.dy, heightMm: g.heightMm + s.dh, flow: g.flow + s.df, hz: g.hz + s.dhz };
  },
};

const BLE_ID = (n) => '0000fff' + n + '-0000-1000-8000-00805f9b34fb';
const BLESource = {
  last: null, dev: null,
  async enable() {
    if (!navigator.bluetooth) return false;
    try {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_ID(0)] }] });
      const ch = await (await (await dev.gatt.connect()).getPrimaryService(BLE_ID(0))).getCharacteristic(BLE_ID(1));
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const v = e.target.value;
        BLESource.last = { pitch: v.getInt16(0, true) / 100, roll: v.getInt16(2, true) / 100, heightMm: v.getUint16(4, true) / 10, hz: v.getUint8(6) / 10 };
      });
      BLESource.dev = dev;
      return true;
    } catch (e) { return false; }
  },
  read(t, key) {
    const g = CG.target(key, t), r = BLESource.last;
    if (!r) return ScriptedSource.read(t, key);
    return { x: 50 + r.roll * 0.9, y: g.y, heightMm: r.heightMm, flow: tiltToFlow(r.pitch), hz: r.hz / CG.Coach.speed };
  },
};

CG.Faults = { dx: 0, dy: 0, dh: 0, df: 0 };
CG.Sensors = {
  sources: { scripted: ScriptedSource, motion: MotionSource, wizard: WizardSource, ble: BLESource },
  active: ScriptedSource,
  async use(id) {
    const s = CG.Sensors.sources[id];
    if (!s || (s.enable && !await s.enable())) return false;
    CG.Sensors.active = s;
    return true;
  },
  read: (t, key) => CG.Sensors.active.read(t, key),
};

const HAPTIC = { beat: [18], push: [25, 60, 25], drift: [40, 40, 40, 40, 40, 40, 40], altitude: [55, 70, 55, 70, 55], cut: [180], clear: [] };
CG.Haptics = {
  last: {},
  fire(name, side, throttleMs) {
    const now = performance.now(), key = name + (side || '');
    if (throttleMs && now - (CG.Haptics.last[key] || -1e9) < throttleMs) return;
    CG.Haptics.last[key] = now;
    if (HAPTIC[name] && buzzOn && !BLESource.dev && navigator.vibrate) try { navigator.vibrate(HAPTIC[name]); } catch (e) {}
    if (name === 'beat' && uiState.sound) beatTick();
  },
};

let beatAudio = null;

function beatAudioOn() {
  if (!beatAudio) try { beatAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  if (beatAudio && beatAudio.state === 'suspended') beatAudio.resume();
}

function beatTick() {
  if (!beatAudio) return;
  const o = beatAudio.createOscillator(), g = beatAudio.createGain(), t = beatAudio.currentTime;
  o.frequency.value = 1320;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(beatAudio.destination);
  o.start(t);
  o.stop(t + 0.07);
}

const TOL = { pos: 6, height: 10, flow: 2, hz: 0.8 };
const PAUSE = { min: 1, ready: 0.3, max: { 0.5: 2, 0.75: 1.6, 1: 1.2 } };

CG.Coach = {
  key: 'rosetta', running: false, onTick: null, onWord: null, onDone: null, onState: null, raf: 0, last: 0, t: 0, speed: 1, word: '', lastT: null,
  lead: 0, hold: null, holdT: 0, holdOk: 0, watch: false, stops: false, range: null,
  start(key, o = {}) {
    const C = CG.Coach;
    Object.assign(C, { key: key || C.key, speed: o.speed || 1, watch: !!o.watch, stops: !!o.stops && !o.range, range: o.range || null });
    C.reset();
    C.running = true;
    cancelAnimationFrame(C.raf);
    loop();
  },
  reset() {
    const C = CG.Coach;
    Object.assign(C, { t: C.range ? C.range[0] : 0, last: performance.now(), lastT: null, lead: 3, hold: null, word: '' });
    CG.Recorder.reset(C.key);
    if (C.onWord) C.onWord({ word: '', hint: '' });
  },
  go() {
    const C = CG.Coach;
    if (!C.hold) return;
    C.hold = null;
    C.last = performance.now();
    CG.Haptics.fire('push');
    if (uiState.sound) beatTick();
    if (C.onState) C.onState();
  },
  stop() {
    CG.Coach.running = false;
    cancelAnimationFrame(CG.Coach.raf);
    CG.Haptics.fire('clear');
  },
};

function judge(g, r) {
  const dx = r.x - g.x, dy = r.y - g.y, e = {
    pos: Math.hypot(dx, dy) / TOL.pos,
    height: Math.abs(r.heightMm - g.heightMm) / TOL.height,
    flow: Math.abs(r.flow - g.flow) / TOL.flow,
    hz: g.hz > 0 ? Math.abs(r.hz - g.hz) / TOL.hz : 0,
  };
  let worst = 'pos';
  for (const k in e) if (e[k] > e[worst]) worst = k;
  return { e, worst, dx, dy, score: e[worst] };
}

function phrase(g, j, r) {
  const say = (yes, a, b) => yes ? { word: a[0], hint: a[1] } : { word: b[0], hint: b[1] };
  if (j.score < 1) return { word: '', hint: '' };
  if (j.worst === 'height') return say(r.heightMm > g.heightMm, ['COME DOWN', 'Closer to the milk'], ['LIFT', 'A little more air']);
  if (j.worst === 'flow') return say(r.flow > g.flow, ['EASE OFF', 'Bring the pitcher back'], ['TIP MORE', 'Open the flow up']);
  if (j.worst === 'hz') return say(r.hz < g.hz, ['FASTER', 'Keep the beat even'], ['SLOW IT', 'Wider, calmer swings']);
  const swing = Math.abs(r.x - 50);
  if (g.hz > 0 && Math.abs(swing - g.amp) > 3) return say(swing < g.amp, ['SWING WIDER', 'Reach the sides of the cup'], ['SMALLER SWING', 'Tighten it in']);
  if (Math.abs(j.dy) > Math.abs(j.dx)) return say(j.dy > 0, ['PUSH BACK', 'Toward the far rim'], ['COME NEAR', 'Toward you']);
  return say(j.dx > 0, ['GO LEFT', 'Off to the right'], ['GO RIGHT', 'Off to the left']);
}

function haptic(g, j) {
  if (g.hz > 0) CG.Haptics.fire('beat', null, (1000 / (g.hz * CG.Coach.speed)) - 40);
  if (j.score < 1) return;
  if (j.worst === 'height') CG.Haptics.fire('altitude', null, 900);
  else if (j.worst === 'pos') CG.Haptics.fire('drift', j.dx > 0 ? 'L' : 'R', 900);
  else CG.Haptics.fire('push', null, 1100);
}

function backfill(from, to) {
  for (let s2 = from + 0.1; s2 < to; s2 += 0.1) {
    const g = CG.target(CG.Coach.key, s2), r = CG.Sensors.read(s2, CG.Coach.key);
    CG.Recorder.sample(s2, g, r, judge(g, r));
  }
}

function loop() {
  const C = CG.Coach, pat = CG.PATTERNS[C.key], now = performance.now(), dt = (now - C.last) / 1000, end = C.range ? C.range[1] : pat.dur;
  if (!C.running) return;
  C.last = now;
  C.raf = requestAnimationFrame(loop);
  if (C.lead > 0) {
    C.lead -= dt;
    const g = CG.target(C.key, C.t);
    if (C.onTick) C.onTick(g, g, judge(g, g), C.t);
    if (C.onState) C.onState();
    return;
  }
  if (!C.hold) {
    const steps = pat.steps, i = steps.findIndex((s) => C.t < s.t1);
    C.t += dt * C.speed;
    if (C.stops && !C.watch && i >= 0 && i < steps.length - 1 && !steps[i + 1].join && C.t >= steps[i].t1) {
      C.t = steps[i].t1;
      C.hold = steps[i + 1];
      C.holdT = C.holdOk = 0;
      if (C.onState) C.onState();
    }
  }
  if (C.t >= end) {
    if (C.range) { C.reset(); C.lead = 1; return; }
    if (C.watch) { C.watch = false; C.reset(); if (C.onState) C.onState(); return; }
    if (C.lastT != null) backfill(C.lastT, pat.dur);
    CG.Haptics.fire('cut');
    C.running = false;
    cancelAnimationFrame(C.raf);
    if (C.onDone) C.onDone(Object.assign(CG.Recorder.finish(), { speed: C.speed }));
    return;
  }
  const g = CG.target(C.key, C.t), ahead = CG.target(C.key, Math.min(pat.dur - 0.01, C.t + 0.25));
  if (C.hold) {
    const r = CG.Sensors.read(C.t, C.key), j = judge(g, r);
    C.holdT += dt;
    C.holdOk = j.e.pos < 1 && j.e.height < 1 ? C.holdOk + dt : 0;
    if (g.hz > 0) CG.Haptics.fire('beat', null, (1000 / (g.hz * C.speed)) - 40);
    if (C.onTick) C.onTick(g, r, j, C.t);
    if (C.onState) C.onState();
    if (C.holdT >= PAUSE.max[C.speed] || (C.holdT >= PAUSE.min && C.holdOk >= PAUSE.ready)) C.go();
    return;
  }
  if (C.watch) {
    if (g.hz > 0) CG.Haptics.fire('beat', null, (1000 / (g.hz * C.speed)) - 40);
    if (C.onTick) C.onTick(g, g, judge(g, g), C.t);
    return;
  }
  const r = CG.Sensors.read(C.t, C.key), j = judge(g, r);
  if (ahead.step !== g.step) CG.Haptics.fire(ahead.step.key === 'cut' ? 'cut' : 'push', null, ahead.step.key === 'cut' ? 1500 : 600);
  else haptic(g, j);
  const w = phrase(g, j, r);
  if (w.word !== C.word) { C.word = w.word; if (C.onWord) C.onWord(w); }
  if (!C.range) {
    if (C.lastT != null && C.t - C.lastT > 0.15) backfill(C.lastT, C.t);
    CG.Recorder.sample(C.t, g, r, j);
  }
  C.lastT = C.t;
  if (C.onTick) C.onTick(g, r, j, C.t);
}

CG.Recorder = {
  key: 'rosetta', rows: [], next: 0,
  reset(key) { Object.assign(CG.Recorder, { key, rows: [], next: 0 }); },
  sample(t, g, r, j) {
    if (t < CG.Recorder.next) return;
    CG.Recorder.next = t + 0.1;
    CG.Recorder.rows.push({ t, step: g.step.key, gx: g.x, gy: g.y, rx: r.x, ry: r.y, gh: g.heightMm, rh: r.heightMm, gf: g.flow, rf: r.flow, ghz: g.hz, rhz: r.hz, e: j.e, worst: j.worst, score: j.score });
  },
  finish() {
    const { rows, key } = CG.Recorder, scores = {}, faults = [];
    if (!rows.length) return { key, rows, faults, scores };
    ['pos', 'height', 'flow', 'hz'].forEach((c) => {
      const rel = rows.filter((r) => c !== 'hz' || r.ghz > 0);
      scores[c] = rel.length ? Math.round(100 * rel.filter((r) => r.e[c] < 1).length / rel.length) : 100;
    });
    let run = null;
    const close = () => {
      if (run && run.t1 - run.t0 >= 0.4) {
        run.chan = Object.keys(run.tally).reduce((a, c) => run.tally[c] > run.tally[a] ? c : a);
        faults.push(run);
      }
      run = null;
    };
    rows.forEach((r) => {
      if (r.score >= 1) {
        run = run || { step: r.step, t0: r.t, t1: r.t, peak: 0, tally: {}, gap: 0 };
        Object.assign(run, { t1: r.t, gap: 0, peak: Math.max(run.peak, r.score) });
        run.tally[r.worst] = (run.tally[r.worst] || 0) + 1;
      } else if (run && (run.gap += 0.1) > 0.3) close();
    });
    close();
    faults.sort((a, b) => (b.t1 - b.t0) * b.peak - (a.t1 - a.t0) * a.peak);
    return { key, rows, faults: faults.slice(0, 3), scores };
  },
};

const EXPLAIN = {
  hz: ['Your rhythm slowed down', 'The leaves blur together instead of staying separate.'],
  pos: ['You drifted off the line', 'The pattern leans to one side.'],
  height: ['The jug was at the wrong height', 'Too high and the milk sinks. Too low and it floods the top.'],
  flow: ['The flow was off', 'Too much washes the pattern out. Too little and no white shows.'],
};

CG.explain = (f, key) => {
  const s = CG.PATTERNS[key].steps.find((x) => x.key === f.step), m = EXPLAIN[f.chan] || EXPLAIN.pos;
  return { title: m[0], step: s ? s.label : f.step, effect: m[1], fix: s ? s.why : '' };
};

const uiState = { key: 'rosetta', guides: 4, source: 'scripted', speed: 0.5, watch: false, stops: false, sound: true, range: null };
CG.UI = uiState;
const LEVELS = ['', 'Easy', 'Medium', 'Hard'];
const SPEEDS = [[0.5, '0.5×', 'Half speed'], [0.75, '0.75×', 'Three-quarter speed'], [1, '1×', 'Full speed']];
const GUIDE_TEXT = ['Target dot only', 'Adds your trail and tips', 'Adds the pour route', 'Adds the swing lane and the art', 'Adds what comes next'];
const SOURCE_TEXT = { scripted: 'A sample pour, no hardware', motion: 'Your phone’s motion sensors', wizard: 'Run from the wizard page', ble: 'Pitcher clip over Bluetooth' };
const patSecs = (p) => Math.round(p.dur / uiState.speed) + ' s';

function showWhy(s) {
  $('lvWhy').textContent = s.why;
  $('lvWhyStep').textContent = s.label.toUpperCase();
}

function segs(id, attr, isOn, onPick) {
  $(id).querySelectorAll('[' + attr + ']').forEach((b) => {
    b.classList.toggle('on', isOn(b.getAttribute(attr)));
    b.onclick = () => onPick(b.getAttribute(attr), b);
  });
}

const SETUP = {
  render() {
    const wrap = $('lvPatterns'), pat = CG.PATTERNS[uiState.key], steps = $('lvSteps');
    wrap.innerHTML = Object.entries(CG.PATTERNS).map(([k, p]) => `<button class="lv-pat${k === uiState.key ? ' on' : ''}" data-pat="${k}">
          <span class="lv-pat-name">${p.name}</span>
          <span class="lv-pat-meta">${patSecs(p)} &middot; ${LEVELS[p.level]}</span>
        </button>`).join('');
    wrap.querySelectorAll('[data-pat]').forEach((b) => b.addEventListener('click', () => {
      uiState.key = b.dataset.pat;
      SETUP.render();
      CG.Model.setPattern(uiState.key);
    }));
    $('lvBlurb').textContent = pat.blurb;
    steps.innerHTML = pat.steps.map((s, i) => `
        <div class="lv-step${i ? '' : ' on'}" data-i="${i}">
          <div class="lv-step-bar"></div>
          <div class="lv-step-label">${s.label}</div>
        </div>`).join('');
    steps.querySelectorAll('.lv-step').forEach((n) => n.addEventListener('click', () => {
      const s = pat.steps[+n.dataset.i];
      showWhy(s);
      steps.querySelectorAll('.lv-step').forEach((m) => m.classList.toggle('on', m === n));
      CG.Model.seek((s.t0 + s.t1) / 2);
    }));
    showWhy(pat.steps[0]);
    segs('lvSpeed', 'data-speed', (v) => +v === uiState.speed, (v) => { uiState.speed = +v; SETUP.render(); });
    $('lvSpeedText').textContent = SPEEDS.find((x) => x[0] === uiState.speed)[2];
    segs('lvPractice', 'data-opt', (v) => uiState[v], (v) => { uiState[v] = !uiState[v]; if (v === 'sound' && uiState.sound) beatAudioOn(); SETUP.render(); });
    segs('lvGuides', 'data-g', (v) => +v === uiState.guides, (v) => { uiState.guides = +v; SETUP.render(); });
    $('lvGuidesText').textContent = GUIDE_TEXT[uiState.guides - 1];
    segs('lvSource', 'data-src', (v) => v === uiState.source, async (v, b) => {
      if (!await CG.Sensors.use(v)) { buzz('warn', true); b.classList.add('nope'); setTimeout(() => b.classList.remove('nope'), 900); return; }
      uiState.source = v;
      SETUP.render();
    });
    $('lvSourceText').textContent = SOURCE_TEXT[uiState.source];
  },
};
CG.Setup = SETUP;

const LINEUP = {
  timer: 0, t: 0, count: 3000,
  enter() {
    clearInterval(LINEUP.timer);
    LINEUP.t = 0;
    LINEUP.count = 3000;
    $('lvCountdown').classList.add('hidden');
    $('lvHint').textContent = 'Bring the pitcher into the ring';
    $('lvHint').classList.remove('go');
    $('lvChkAngle').classList.remove('done');
    $('lvChkAngleTag').textContent = 'TOO FAR BACK';
    $('lvReadyPattern').textContent = CG.PATTERNS[uiState.key].name;
    $('lvReadySpeed').textContent = '· ' + SPEEDS.find((x) => x[0] === uiState.speed)[1];
    LINEUP.timer = setInterval(LINEUP.tick, 300);
  },
  tick() {
    const cd = $('lvCountdown'), inRange = (LINEUP.t += 300) > 1500;
    $('lvChkAngle').classList.toggle('done', inRange);
    $('lvChkAngleTag').textContent = inRange ? 'GOOD' : 'TOO FAR BACK';
    $('lvHint').classList.toggle('go', inRange);
    $('lvHint').textContent = inRange ? 'Hold it there…' : 'Bring the pitcher into the ring';
    if (!inRange) { LINEUP.count = 3000; cd.classList.add('hidden'); return; }
    if ((LINEUP.count -= 300) <= 0) {
      clearInterval(LINEUP.timer);
      CG.Haptics.fire('push');
      return go('coach');
    }
    cd.textContent = Math.ceil(LINEUP.count / 1000);
    cd.classList.remove('hidden');
  },
  exit() { clearInterval(LINEUP.timer); },
};
CG.Lineup = LINEUP;

const POUR_LAYERS = [['scrim', 'path', 'ln-scrim'], ['body', 'path', 'ln-body'], ['crema', 'path', 'ln-crema', 'lnCrema'], ['rim', 'path', 'ln-rim', 'lnRim'], ['gArt', 'g', 'ln-art', 'lnArt'],
  ['envL', 'path', 'ln-env', 'lnEnvL'], ['envR', 'path', 'ln-env', 'lnEnvR'], ['route', 'path', 'ln-route', 'lnRoute'], ['ahead', 'path', 'ln-ahead', 'lnAhead'], ['trail', 'path', 'ln-trail', 'lnTrail'],
  ['puck', 'circle', 'ln-puck', 'lnPuck', 11], ['dotY', 'circle', 'ln-you', 'lnYou', 7], ['stalkY', 'path', 'ln-stalk-y', 'lnStalkY'], ['stalkT', 'path', 'ln-stalk-t', 'lnStalkT'],
  ['haloY', 'path', 'ln-halo-y', 'lnHaloY'], ['haloT', 'path', 'ln-halo-t', 'lnHaloT'],
  ['progT', 'path', 'ln-prog-t'], ['prog', 'path', 'ln-prog'], ['pickT', 'path', 'ln-pick-t'], ['pick', 'path', 'ln-pick'], ['milk', 'path', 'ln-milk']];

const POUR = {
  built: false, art: [], you: [],
  build() {
    if (POUR.built) return;
    const g = $('lnLayer');
    g.innerHTML = '';
    POUR_LAYERS.forEach(([k, tag, cls, id, r]) => g.appendChild(POUR[k] = svgEl(tag, Object.assign(id ? { id } : {}, { class: cls }, r ? { r } : {}))));
    POUR.built = true;
  },
  draw() {
    const key = CG.Coach.key, env = envelopePaths(key);
    artElements(key).forEach((a, i) => POUR.artNodes[i].setAttribute('d', a.d));
    POUR.scrim.setAttribute('d', MAT.live ? matScrim() : '');
    POUR.body.setAttribute('d', MAT.live && !onRing() ? cupBody() : '');
    POUR.crema.setAttribute('d', rimPath(44.5));
    POUR.rim.setAttribute('d', rimPath(44));
    POUR.route.setAttribute('d', routePath(key));
    POUR.envL.setAttribute('d', env[0] || '');
    POUR.envR.setAttribute('d', env[1] || '');
    POUR.progT.setAttribute('d', MAT.live && onRing() ? ringArc(0, 359.9, 0.455) : '');
    if (!lnScreen().classList.contains('picking')) ['pick', 'pickT'].forEach((k) => POUR[k].setAttribute('d', ''));
  },
  enter() {
    POUR.build();
    const key = uiState.key, pat = CG.PATTERNS[key], G = uiState.guides;
    CG.Coach.key = key;
    POUR.you = [];
    POUR.art = artElements(key);
    POUR.gArt.innerHTML = '';
    POUR.artNodes = POUR.art.map(() => POUR.gArt.appendChild(svgEl('path', { class: 'ln-art-el' })));
    POUR.draw();
    $('lnName').textContent = pat.name;
    [[POUR.trail, 2], [POUR.dotY, 2], [$('lnWordWrap'), 2], [POUR.route, 3], [POUR.envL, 4], [POUR.envR, 4], [POUR.gArt, 4], [POUR.ahead, 5]].forEach(([el, min]) => { el.style.display = G >= min ? '' : 'none'; });
    $('lnPhase').innerHTML = pat.steps.map((s) => `<div class="ln-seg" data-k="${s.key}" style="flex:${(s.t1 - s.t0).toFixed(2)}"><i></i><b>${s.label}</b></div>`).join('');
    CG.Coach.onTick = POUR.tick;
    CG.Coach.onWord = POUR.word;
    MILK.rows = [];
    CG.Coach.onDone = (report) => {
      report.milk = milkSummary(report.key);
      CG.Report = report;
      tlog('pour-done', { pattern: report.key, scores: report.scores, milk: report.milk, taps: MAT.taps });
      buzz('success', true);
      go('forensics');
    };
    CG.Coach.onState = POUR.state;
    if (!MAT.armed) startPour();
  },
  exit() { CG.Coach.stop(); },
  state() {
    const C = CG.Coach, scr = lnScreen(), lead = C.lead > 0, speed = SPEEDS.find((x) => x[0] === C.speed);
    scr.classList.toggle('lead', lead);
    scr.classList.toggle('watching', C.watch);
    scr.classList.toggle('holding', !!C.hold);
    const n = lead ? String(Math.ceil(C.lead)) : '';
    if ($('lnCountNum').textContent !== n) {
      $('lnCountNum').textContent = n;
      if (n) buzz('tick', true);
      if (n) $('lnCountNum').animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    $('lnCountSub').textContent = C.range ? 'Practise this part' : C.watch ? 'Watch the route once' : 'Get ready to pour';
    $('lnMode').textContent = (C.range ? 'Practice · ' : C.watch ? 'Watch · ' : '') + (speed ? speed[1] : '');
    if (C.hold && $('lnNextStep').textContent !== C.hold.label) buzz('select', true);
    if (C.hold) {
      $('lnNextStep').textContent = C.hold.label;
      $('lnNextWhy').textContent = C.hold.cue;
      $('lnNext').style.setProperty('--p', clamp(C.holdT / PAUSE.max[C.speed]).toFixed(3));
      $('lnNextIn').textContent = C.holdOk > 0 ? 'In position' : 'Get in position';
      C.word = '';
      POUR.word({ word: '', hint: '' });
    }
  },
  word(w) {
    $('lnWord').textContent = w.word;
    $('lnHint2').textContent = w.hint;
    $('lnWordWrap').classList.toggle('show', !!w.word);
  },
  tick(g, r, j, t) {
    const key = CG.Coach.key, [tx, ty] = P0(g.x, g.y), [rx, ry] = P0(r.x, r.y), hOff = j.e.height >= 1;
    setAttrs(POUR.puck, { cx: tx, cy: ty, r: g.hz > 0 ? 9 + 3 * Math.abs(Math.sin(Math.PI * g.hz * t)) : 11 });
    setAttrs(POUR.dotY, { cx: rx, cy: ry });
    POUR.haloT.setAttribute('d', ringPath(g.x, g.y, g.heightMm, SPOUT_R));
    POUR.haloY.setAttribute('d', ringPath(r.x, r.y, r.heightMm, SPOUT_R));
    POUR.stalkT.setAttribute('d', stalkPath(g.x, g.y, g.heightMm));
    POUR.stalkY.setAttribute('d', stalkPath(r.x, r.y, r.heightMm));
    POUR.dotY.classList.toggle('off', j.e.pos >= 1);
    POUR.haloY.classList.toggle('off', hOff);
    POUR.stalkY.classList.toggle('off', hOff);
    POUR.ahead.setAttribute('d', routePath(key, t, Math.min(CG.PATTERNS[key].dur, t + 1.2)));
    const C = CG.Coach;
    if (!(C.lead > 0 || C.watch || C.hold)) POUR.you.push([r.x, r.y, t]);
    while (POUR.you.length && t - POUR.you[0][2] > 0.9) POUR.you.shift();
    POUR.trail.setAttribute('d', POUR.you.map((p, i) => (i ? 'L' : 'M') + fx(P0(p[0], p[1]))).join(' '));
    POUR.art.forEach((a, i) => { POUR.artNodes[i].style.opacity = (clamp((t - a.t) / 0.5) * 0.58).toFixed(3); });
    const live = MAT.live && onRing(), still = !(C.lead > 0 || C.watch || C.hold);
    POUR.prog.setAttribute('d', live ? ringArc(MAT.turn, 359.9 * clamp(t / CG.PATTERNS[key].dur), 0.455) : '');
    milkRead();
    const seen = live && MILK.area > 0.03;
    if (seen && still) MILK.rows.push([t, MILK.x, MILK.y, MILK.area]);
    POUR.milk.setAttribute('d', seen ? poly(Array.from({ length: 28 }, (_, i) => { const a = i / 28 * Math.PI * 2, r = 39 * Math.sqrt(MILK.area); return P0(MILK.x + r * Math.cos(a), MILK.y + r * Math.sin(a)); }), true) : '');
    [...$('lnPhase').children].forEach((seg, i) => seg.classList.toggle('on', i === g.stepIndex));
    $('lnStepName').textContent = g.step.label;
    $('lnClock').textContent = Math.max(0, ((C.range ? C.range[1] : CG.PATTERNS[key].dur) - t) / C.speed).toFixed(1) + 's';
  },
};
CG.Pour = POUR;

const FX_NAMES = { pos: ['Line', 'Where the milk landed'], height: ['Height', 'How high the jug was'], flow: ['Flow', 'How much you poured'], hz: ['Rhythm', 'How even the rocking was'] };

function practiseRange(key, step) {
  const pat = CG.PATTERNS[key], s = pat.steps.find((x) => x.key === step) || pat.steps[0];
  return [Math.max(0, s.t0 - 0.5), Math.min(pat.dur, s.t1 + 0.3)];
}

function speedTip(overall, speed) {
  const i = SPEEDS.findIndex((x) => x[0] === speed), up = SPEEDS[i + 1], name = (SPEEDS[i] || SPEEDS[2])[2].toLowerCase();
  if (overall >= 85 && up) return ['Clean at ' + name, 'You are ready for ' + up[1] + '.', 'Try ' + up[1], up[0]];
  if (overall < 65 && i > 0) return ['Hard to follow at ' + name, 'Slow it down and try again.', 'Try ' + SPEEDS[0][1], SPEEDS[0][0]];
  return null;
}

function milkText(m) {
  const where = [Math.abs(m.dx) >= 2 && Math.round(Math.abs(m.dx)) + ' mm ' + (m.dx < 0 ? 'left' : 'right'), Math.abs(m.dy) >= 2 && Math.round(Math.abs(m.dy)) + ' mm ' + (m.dy < 0 ? 'toward the far rim' : 'toward you')].filter(Boolean);
  const size = 'It covered ' + Math.round(m.area * 100) + '% of the cup.';
  return (where.length ? 'Seen by the camera: the centre of your pattern was ' + where.join(' and ') + '. ' : 'Seen by the camera: your pattern sat right in the centre. ') + size;
}

const FOR = {
  enter() {
    const rep = CG.Report;
    $('fxNext').innerHTML = '';
    if (!rep || !rep.rows.length) { $('fxFaults').innerHTML = '<div class="fx-empty">No pour recorded yet.</div>'; return; }
    const key = rep.key, cs = rep.scores, overall = Math.round((cs.pos + cs.height + cs.flow + cs.hz) / 4), svg = $('fxTrace'), speed = rep.speed || 1, tip = speedTip(overall, speed);
    const trace = (rows, cls) => svg.appendChild(svgEl('path', { d: poly(rows.map((r) => P0(r.rx, r.ry)), false), class: cls }));
    $('fxTitle').textContent = CG.PATTERNS[key].name;
    $('fxScore').textContent = overall;
    $('fxVerdict').textContent = overall >= 85 ? 'Clean pour' : overall >= 65 ? 'Close, with a wobble' : 'The shape did not hold';
    $('fxSub').textContent = 'How much of the pour stayed on track, at ' + SPEEDS.find((x) => x[0] === speed)[2].toLowerCase();
    $('fxBars').innerHTML = ['pos', 'height', 'flow', 'hz'].map((c) => `
      <div class="fx-bar">
        <div class="fx-bar-top"><b>${FX_NAMES[c][0]}</b><i>${cs[c]}%</i></div>
        <div class="fx-bar-track"><span style="width:${cs[c]}%" class="${cs[c] >= 85 ? 'good' : cs[c] >= 65 ? 'mid' : 'bad'}"></span></div>
        <div class="fx-bar-sub">${FX_NAMES[c][1]}</div>
      </div>`).join('');
    svg.innerHTML = '';
    svg.appendChild(svgEl('path', { d: rimPath(44), class: 'fx-rim' }));
    svg.appendChild(svgEl('path', { d: routePath(key), class: 'fx-want' }));
    trace(rep.rows, 'fx-got');
    rep.faults.forEach((f) => {
      const seg = rep.rows.filter((r) => r.t >= f.t0 && r.t <= f.t1);
      if (seg.length >= 2) trace(seg, 'fx-bad');
    });
    if (tip) {
      $('fxNext').innerHTML = `<div style="flex:1"><b>${tip[0]}</b>${tip[1]}</div><button type="button">${tip[2]}</button>`;
      $('fxNext').querySelector('button').onclick = () => { uiState.speed = tip[3]; go('getready'); };
    }
    $('fxFaults').innerHTML = rep.faults.length
      ? rep.faults.map((f, i) => {
          const x = CG.explain(f, key);
          return `<div class="fx-card">
            <div class="fx-card-head"><span class="fx-n">${i + 1}</span>
              <div><div class="fx-card-title">${x.title}</div>
              <div class="fx-card-when">During the ${x.step.toLowerCase()}</div></div></div>
            <div class="fx-card-effect">${x.effect}</div>
            <div class="fx-card-fix"><i class="fa-solid fa-lightbulb icon-fa ic-12"></i><span>${x.fix}</span></div>
            <button type="button" class="fx-practice" data-practice="${f.step}"><i class="fa-solid fa-repeat"></i>Practise this part</button>
          </div>`;
        }).join('')
      : '<div class="fx-empty">No problems that lasted long enough to count. Try one guide level lower.</div>';
    if (rep.milk) $('fxFaults').insertAdjacentHTML('afterbegin', `<div class="fx-cam"><i class="fa-solid fa-camera icon-fa ic-12"></i><span>${milkText(rep.milk)}</span></div>`);
    $('fxFaults').querySelectorAll('[data-practice]').forEach((b) => { b.onclick = () => { uiState.range = practiseRange(key, b.dataset.practice); go('coach'); }; });
  },
};
CG.Forensics = FOR;

const CUPR = 78, CUPH = 62, S = 49;
let inst = null, host = null;
const M = { key: 'rosetta', t: 0, playing: true, spin: false, orbit: { x: 42, y: -24 }, drag: null };

function pose(key, t) {
  const g = CG.target(key, t);
  return { x: (g.x - 50) * (CUPR / 44), z: (g.y - 50) * (CUPR / 44), lift: 8 + g.heightMm * 1.35, tilt: flowToTilt(g.flow), roll: g.hz > 0 ? 16 * Math.sin(2 * Math.PI * g.hz * t) : 0, g };
}

function sketch(p) {
  p.setup = () => {
    p.createCanvas(348, 236, p.WEBGL).parent(host);
    p.frameRate(45);
  };
  p.draw = () => {
    p.clear();
    p.background(15, 11, 9, 0);
    if (M.playing) M.t = (M.t + p.deltaTime / 1000 * uiState.speed) % CG.PATTERNS[M.key].dur;
    if (M.spin) M.orbit.y = (M.orbit.y + p.deltaTime * 0.026) % 360;
    p.perspective(p.PI / 3.2, p.width / p.height, 10, 3000);
    p.camera(0, -34, 430, 0, 4, 0, 0, 1, 0);
    p.ambientLight(112, 104, 95);
    p.directionalLight(255, 243, 226, -0.35, 0.85, -0.45);
    p.directionalLight(120, 150, 165, 0.65, -0.15, 0.5);
    p.rotateX(p.radians(-M.orbit.x));
    p.rotateY(p.radians(M.orbit.y));
    const q = pose(M.key, M.t), off = spoutOffset(q);
    q.tip = [q.x, -q.lift, q.z];
    drawCup(p);
    drawGhostRoute(p);
    p.push();
    p.translate(q.x - off[0], -q.lift - off[1], q.z - off[2]);
    p.rotateZ(p.radians(q.roll));
    p.rotateX(p.radians(-q.tilt));
    drawPitcher(p);
    p.pop();
    drawStream(p, q);
  };
  p.mousePressed = () => {
    if (p.mouseX < 0 || p.mouseX > p.width || p.mouseY < 0 || p.mouseY > p.height) return;
    M.drag = { x: p.mouseX, y: p.mouseY, ox: M.orbit.x, oy: M.orbit.y };
    M.spin = false;
    $('lvSpin').classList.remove('on');
  };
  p.mouseDragged = () => {
    if (!M.drag) return;
    M.orbit.y = M.drag.oy + (p.mouseX - M.drag.x) * 0.5;
    M.orbit.x = clamp(M.drag.oy + (p.mouseY - M.drag.y) * 0.4, -4, 72);
    return false;
  };
  p.mouseReleased = () => { M.drag = null; };
}

function matte(p, r, g, b) {
  p.specularMaterial(0, 0, 0);
  p.ambientMaterial(r, g, b);
  p.fill(r, g, b);
}

function drawCup(p) {
  const part = (y, r, h, n, caps, mat) => {
    p.push();
    p.noStroke();
    mat();
    p.translate(0, y, 0);
    p.cylinder(r, h, n, 1, caps, caps);
    p.pop();
  };
  part(CUPH / 2, CUPR, CUPH, 40, false, () => { p.specularMaterial(236, 231, 222); p.shininess(20); });
  part(CUPH - 1, CUPR * 0.99, 3, 40, true, () => matte(p, 214, 208, 197));
  part(4, CUPR * 0.98, 4, 40, true, () => matte(p, 138, 80, 42));
  part(CUPH + 1, CUPR * 1.5, 1, 34, true, () => matte(p, 34, 22, 14));
}

function drawGhostRoute(p) {
  const K = CUPR / 44, Y = -1.4, g = CG.target(M.key, M.t), trace = (to, w, col, side) => {
    p.push();
    p.noFill();
    p.stroke(...col);
    p.strokeWeight(w);
    p.beginShape();
    for (let t = 0; t <= to; t += 0.06) {
      const q = spineAt(M.key, t);
      if (side && q.amp <= 1.5) continue;
      p.vertex((side ? q.x + side * q.amp - 50 : q.x - 50) * K, Y, (q.y - 50) * K);
    }
    p.endShape();
    p.pop();
  };
  trace(CG.PATTERNS[M.key].dur, 2.2, [240, 234, 222, 80]);
  trace(CG.PATTERNS[M.key].dur, 1.8, [238, 232, 220, 95], -1);
  trace(CG.PATTERNS[M.key].dur, 1.8, [238, 232, 220, 95], 1);
  if (M.t > 0.12) trace(M.t, 4, [29, 185, 137, 240]);
  p.push();
  p.noStroke();
  p.translate((g.x - 50) * K, Y - 2, (g.y - 50) * K);
  p.emissiveMaterial(29, 158, 117);
  p.cylinder(7, 3, 18, 1, true, true);
  p.pop();
}

function drawPitcher(p) {
  const part = (fn) => { p.push(); fn(); p.pop(); };
  p.noStroke();
  p.specularMaterial(232, 228, 221);
  p.shininess(52);
  part(() => p.cylinder(S * 0.50, S * 1.30, 32, 1, true, false));
  part(() => { p.translate(0, S * 0.65, 0); p.ellipsoid(S * 0.50, S * 0.22, S * 0.50, 24, 10); });
  part(() => { p.translate(0, -S * 0.58, S * 0.46); p.rotateX(p.radians(150)); p.cone(S * 0.20, S * 0.68, 4, 1, false); });
  part(() => { p.translate(0, -S * 0.08, -S * 0.62); p.rotateY(p.HALF_PI); p.specularMaterial(196, 133, 82); p.shininess(30); p.torus(S * 0.30, S * 0.09, 22, 10); });
}

function drawStream(p, q) {
  const tip = q.tip;
  if (q.g.flow < 0.6 || -tip[1] < 4) return;
  p.push();
  p.noStroke();
  p.emissiveMaterial(240, 236, 228);
  p.translate(tip[0], tip[1] / 2, tip[2]);
  p.cylinder(1.3 + q.g.flow * 0.40, -tip[1], 12, 1, false, false);
  p.pop();
  p.push();
  p.noStroke();
  p.translate(tip[0], -3, tip[2]);
  p.emissiveMaterial(246, 243, 236);
  p.cylinder(Math.max(5, 30 - q.g.heightMm * 0.42), 2, 20, 1, true, true);
  p.pop();
}

function spoutOffset(q) {
  const r = (d) => d * Math.PI / 180, y = -S * 0.62, z = S * 1.00;
  let c = Math.cos(r(-q.tilt)), s = Math.sin(r(-q.tilt));
  const v = [0, y * c - z * s, y * s + z * c];
  c = Math.cos(r(q.roll));
  s = Math.sin(r(q.roll));
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

CG.Model = {
  mount() {
    host = $('lvModel');
    if (!host || inst) return;
    if (typeof p5 === 'undefined') return host.classList.add('no-webgl');
    try { inst = new p5(sketch); } catch (e) { host.classList.add('no-webgl'); }
  },
  remove() { if (inst) inst.remove(); inst = null; },
  setPattern(k) { M.key = k; M.t = 0; },
  seek(t) { M.t = t; M.playing = false; CG.Model.syncPlayUI(); },
  toggle() { M.playing = !M.playing; CG.Model.syncPlayUI(); },
  toggleSpin: () => (M.spin = !M.spin),
  syncPlayUI() { $('lvPlay').innerHTML = '<i class="fa-solid fa-' + (M.playing ? 'pause' : 'play') + ' icon-fa ic-13"></i>'; },
};

const PP_S = 236, PP_R = PP_S * 0.4, PP_C = PP_S / 2, PP_STEP = 0.018;
const pp = { key: 'rosetta', ctx: null, start: null, raf: 0, on: false, cache: {} };
const ppX = (v) => PP_C + (v - 50) * (PP_R / 44);

function ppArc(c, r, x = PP_C, y = PP_C) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function ppRadial(c, x, y, r0, r1, stops) {
  const g = c.createRadialGradient(x, y, r0, PP_C, PP_C, r1);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

function ppText(c, font, color, text, y) {
  c.save();
  Object.assign(c, { textAlign: 'center', font, fillStyle: color });
  c.fillText(text, PP_C, y);
  c.restore();
}

function ppTrace(c, to, style, width, dash) {
  const pts = [];
  for (let t = 0; t <= to + PP_STEP * 0.5; t += PP_STEP) pts.push(CG.target(pp.key, Math.min(t, to)));
  if (pts.length < 2) return;
  c.save();
  Object.assign(c, { strokeStyle: style, lineWidth: width, lineCap: 'round', lineJoin: 'round' });
  if (dash) c.setLineDash(dash);
  c.beginPath();
  pts.forEach((g, i) => c[i ? 'lineTo' : 'moveTo'](ppX(g.x), ppX(g.y)));
  c.stroke();
  c.restore();
}

function ppFinale(key) {
  const dur = CG.PATTERNS[key].dur, oc = document.createElement('canvas');
  oc.width = oc.height = PP_S;
  const c = oc.getContext('2d');
  ppArc(c, PP_R + 10);
  c.fillStyle = ppRadial(c, PP_C - PP_R * 0.2, PP_C - PP_R * 0.25, 0, PP_R + 10, [[0, '#F5F0E8'], [1, '#D8CEBC']]);
  c.fill();
  c.save();
  ppArc(c, PP_R);
  c.clip();
  c.fillStyle = ppRadial(c, PP_C - PP_R * 0.1, PP_C - PP_R * 0.15, PP_R * 0.05, PP_R * 1.1, [[0, '#A06840'], [0.35, '#7A4420'], [0.75, '#582E0E'], [1, '#2E1408']]);
  c.fillRect(0, 0, PP_S, PP_S);
  c.restore();
  c.save();
  ppArc(c, PP_R * 0.97);
  c.clip();
  for (let pass = 0; pass < 4; pass++) {
    for (let t = 0; t <= dur; t += 0.005) {
      const g = CG.target(key, Math.min(t, dur)), float = clamp(1 - (g.heightMm - 5) / 30);
      if (float < 0.05 || g.flow < 0.8) continue;
      const x = ppX(g.x), y = ppX(g.y), r = 2.5 + float * 4.5, alpha = float * 0.10 + g.flow * 0.004, grad = c.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,248,234,${Math.min(0.80, alpha * 2.0)})`);
      grad.addColorStop(0.55, `rgba(252,242,224,${Math.min(0.45, alpha)})`);
      grad.addColorStop(1, 'rgba(252,242,224,0)');
      c.fillStyle = grad;
      ppArc(c, r, x, y);
      c.fill();
    }
  }
  c.restore();
  ppArc(c, PP_R);
  c.fillStyle = ppRadial(c, PP_C, PP_C, PP_R * 0.78, PP_R, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.28)']]);
  c.fill();
  [[PP_R + 4, 'rgba(110,70,35,0.55)', 2.5], [PP_R + 9, 'rgba(80,50,20,0.20)', 1.5]].forEach(([r, col, w]) => {
    ppArc(c, r);
    Object.assign(c, { strokeStyle: col, lineWidth: w });
    c.stroke();
  });
  c.beginPath();
  c.arc(PP_C + PP_R + 10, PP_C, 11, -Math.PI * 0.55, Math.PI * 0.55, false);
  Object.assign(c, { strokeStyle: '#D8CEBC', lineWidth: 9, lineCap: 'round' });
  c.stroke();
  Object.assign(c, { strokeStyle: 'rgba(110,70,35,0.30)', lineWidth: 1.5 });
  c.stroke();
  return oc;
}

function ppFrame(now) {
  const c = pp.ctx, pat = CG.PATTERNS[pp.key];
  if (!pp.on || !c) return;
  pp.raf = requestAnimationFrame(ppFrame);
  if (!pat) return;
  const dur = pat.dur, anim = dur / 0.4;
  if (pp.start === null) pp.start = now;
  const real = (now - pp.start) / 1000;
  if (real >= anim + 3.5) { pp.start = now; return; }
  c.clearRect(0, 0, PP_S, PP_S);
  if (real >= anim) {
    c.drawImage(pp.cache[pp.key] || (pp.cache[pp.key] = ppFinale(pp.key)), 0, 0);
    const k = Math.min(1, (real - anim) / 0.5);
    if (k < 1) {
      c.save();
      Object.assign(c, { globalAlpha: 1 - k, fillStyle: '#000' });
      c.fillRect(0, 0, PP_S, PP_S);
      c.restore();
    }
    return ppText(c, '700 11px "Nunito", system-ui, sans-serif', 'rgba(255,244,220,0.80)', (pat.name || pp.key).toUpperCase(), PP_S - 8);
  }
  const t = real * 0.4;
  c.save();
  ppArc(c, PP_R);
  c.clip();
  c.fillStyle = ppRadial(c, PP_C, PP_C - PP_R * 0.08, PP_R * 0.04, PP_R * 1.05, [[0, '#8A5A33'], [0.5, '#5E3318'], [1, '#2C1507']]);
  c.fillRect(0, 0, PP_S, PP_S);
  c.restore();
  c.save();
  [[PP_R + 6, 'rgba(255,240,200,0.07)', 10], [PP_R, 'rgba(255,235,190,0.55)', 2.2]].forEach(([r, col, w]) => {
    ppArc(c, r);
    Object.assign(c, { strokeStyle: col, lineWidth: w });
    c.stroke();
  });
  c.restore();
  c.save();
  ppArc(c, PP_R);
  c.clip();
  ppTrace(c, dur, 'rgba(255,240,200,0.18)', 1.4, [3, 7]);
  c.restore();
  if (t > PP_STEP) {
    c.save();
    ppArc(c, PP_R);
    c.clip();
    Object.assign(c, { shadowColor: 'rgba(29,185,137,0.35)', shadowBlur: 5 });
    ppTrace(c, t, 'rgba(29,185,137,0.92)', 2.6);
    c.restore();
  }
  const g = CG.target(pp.key, t), ahead = CG.target(pp.key, Math.min(t + 0.12, dur - 0.01)), px = ppX(g.x), py = ppX(g.y);
  const dx = ppX(ahead.x) - px, dy = ppX(ahead.y) - py, dist = Math.sqrt(dx * dx + dy * dy), ang = dist > 1 ? Math.atan2(dy, dx) : -Math.PI / 2;
  const ox = px - Math.cos(ang) * 5, oy = py - Math.sin(ang) * 5;
  c.save();
  c.translate(ox, oy);
  c.rotate(ang);
  c.beginPath();
  c.ellipse(0, 0, 15, 9, 0, 0, Math.PI * 2);
  Object.assign(c, { fillStyle: 'rgba(232,226,214,0.96)', strokeStyle: 'rgba(60,38,18,0.20)', lineWidth: 0.8 });
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(13, -4);
  c.lineTo(25, 0);
  c.lineTo(13, 4);
  c.closePath();
  c.fill();
  ppArc(c, 2.5, 25, 0);
  c.fillStyle = 'rgba(29,185,137,0.9)';
  c.fill();
  c.beginPath();
  c.arc(-19, 0, 6, -Math.PI * 0.6, Math.PI * 0.6, true);
  Object.assign(c, { strokeStyle: 'rgba(192,115,48,0.92)', lineWidth: 3 });
  c.stroke();
  c.restore();
  if (dist > 3) {
    const x = ox + Math.cos(ang) * 45, y = oy + Math.sin(ang) * 45, wing = (s) => [x + Math.cos(ang + Math.PI + s * 0.48) * 13, y + Math.sin(ang + Math.PI + s * 0.48) * 13];
    c.save();
    Object.assign(c, { strokeStyle: 'rgba(255,238,180,0.95)', lineWidth: 6, lineCap: 'round', lineJoin: 'round' });
    c.beginPath();
    c.moveTo(...wing(-1));
    c.lineTo(x, y);
    c.lineTo(...wing(1));
    c.stroke();
    c.restore();
  }
  const steps = pat.steps, label = steps ? (steps.find((s) => t >= s.t0 && t < s.t1) || {}).label || steps[steps.length - 1].label || '' : '';
  const bw = PP_R * 1.6, bx = PP_C - bw / 2;
  c.save();
  c.beginPath();
  c.roundRect(bx, PP_S - 14, bw, 3, 2);
  c.fillStyle = 'rgba(255,240,200,0.12)';
  c.fill();
  c.beginPath();
  c.roundRect(bx, PP_S - 14, bw * t / dur, 3, 2);
  c.fillStyle = 'rgba(29,185,137,0.75)';
  c.fill();
  c.restore();
  ppText(c, '700 10px "Nunito", system-ui, sans-serif', 'rgba(255,240,200,0.55)', label.toUpperCase(), PP_S - 22);
}

function ppView(on) {
  if ($('lvPatternView')) $('lvPatternView').style.display = on ? 'flex' : 'none';
  if ($('lvModel')) $('lvModel').style.display = on ? 'none' : '';
}

function ppShow(key) {
  if (key) pp.key = key;
  pp.start = null;
  pp.on = true;
  if (!pp.ctx) {
    const cv = $('lvPatternCanvas');
    if (!cv) return (pp.on = false);
    cv.width = cv.height = PP_S;
    pp.ctx = cv.getContext('2d');
  }
  ppView(true);
  cancelAnimationFrame(pp.raf);
  pp.raf = requestAnimationFrame(ppFrame);
}

function ppHide() {
  pp.on = false;
  cancelAnimationFrame(pp.raf);
  ppView(false);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#lvPattern'), pat = e.target.closest('[data-pat]');
  if (btn) btn.classList.toggle('on') ? ppShow(CG.UI.key || pp.key) : ppHide();
  if (!pat || !pat.dataset.pat || pat.dataset.pat === pp.key) return;
  pp.key = pat.dataset.pat;
  pp.start = null;
  if (pp.on) ppShow(pp.key);
});

const AR = { name: null, sub: null, view: null, i: 0, pos: {}, timer: 0, hold: 0, press: null, sig: '', lent: [], want: [], ask: null, askT: 0, hud: false, morph: false, top: false };
const AR_TASTE_STEP = 0.25;
const AR_SRC = [['scripted', 'Demo'], ['motion', 'Phone'], ['wizard', 'Wizard'], ['ble', 'Clip']];
const AR_TAMP = ['light', 'ideal', 'tight'];
const AR_MEASURE = [['rvInYield', 'g'], ['rvInTime', 's'], ['rvInGrinder', ''], ['rvInClick', 'clicks'], ['rvInBean', ''], ['rvInRoast', 'days'], ['rvInTemp', '°C']];
const AR_HINT = '<b>Swipe</b> to move · <b>Tap</b> to choose · <b>Swipe up</b> for phone view · <b>Hold</b> to go back';
const AR_HINT_TOP = '<b>Tap</b> to switch to phone view · <b>Swipe down</b> to go back to the cards';
const AR_HINT_ADJ = '<b>Swipe up or down</b> to change · <b>Swipe sideways</b> to move · <b>Hold</b> to go back';
const arRoot = () => $('arRoot');
const arPage = () => AR.name + (AR.sub ? ':' + AR.sub : '');
const arFa = (n) => '<i class="fa-solid fa-' + n + '"></i>';
const arChip = (t, c) => t && t !== '—' ? '<span class="ar-chip' + (c ? ' ' + c : '') + '">' + esc(t) + '</span>' : '';
const arDiv = (cls, html) => '<div class="' + cls + '">' + html + '</div>';
const arField = (key, cls) => '<div class="' + cls + '" data-arf="' + key + '"></div>';
const arClick = (sel) => () => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.click(); };
const arKind = (k) => k === 'ok' ? 'ok' : k === 'channel' ? 'stop' : 'warn';
const arStars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const arText = (id) => ($(id) ? $(id).textContent.trim() : '');
const arTone = (ok) => ok ? 'ok' : 'warn';
const arCalm = () => !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches;
const arOpen = (k, ic, t, v, s) => ({ ic: arFa(ic), t, v, s, act: () => arSub(k) });
const AR_DONE = { ic: arFa('check'), t: 'Done', act: () => arSub(null) };

function arLend(el, w, inv, cls) {
  if (!el) return '';
  AR.want.push(el);
  return '<div class="ar-slot' + (inv ? ' inv' : '') + (cls ? ' ' + cls : '') + '" data-lend="' + (AR.want.length - 1) + '" style="--w:' + w + 'px"></div>';
}

function arReturn() {
  AR.lent.forEach(([el, mark]) => { el.style.zoom = ''; if (mark.parentNode) mark.replaceWith(el); });
  AR.lent = [];
}

function arFit() {
  arRoot().querySelectorAll('.ar-slot').forEach((s) => {
    const el = s.firstElementChild;
    if (!el || !s.clientWidth) return;
    el.style.zoom = 1;
    el.style.zoom = Math.min(s.clientWidth / el.offsetWidth, s.clientHeight / el.offsetHeight).toFixed(3);
  });
}

function arAsk(key, o, ask, fn) {
  const armed = AR.ask === key;
  return Object.assign({}, o, { t: armed ? ask : o.t, tone: armed ? 'stop' : o.tone, act: () => {
    clearTimeout(AR.askT);
    if (armed) { AR.ask = null; buzz('confirm', true); fn(); return; }
    buzz('warn', true);
    AR.ask = key;
    AR.askT = setTimeout(() => { AR.ask = null; arRefresh(); }, 3000);
  } });
}

function arTiles2(list) {
  return arTiles(list).replace('ar-tiles', 'ar-tiles two');
}

function arTiles(list) {
  return '<div class="ar-tiles">' + list.map((t) => '<div class="ar-tile ' + (t.tone || '') + '"><span>' + esc(t.k) + '</span><b>' + esc(t.v) + '</b>'
    + (t.bar != null ? '<div class="ar-bar"><i style="width:' + t.bar + '%"></i></div>' : '')
    + (t.s ? '<em>' + esc(t.s) + '</em>' : '') + '</div>').join('') + '</div>';
}

function arCard(o, i) {
  return '<button type="button" class="ar-card' + (o.tone ? ' ' + o.tone : '') + (o.sel ? ' sel' : '') + (o.act || o.adj ? '' : ' info') + '" data-i="' + i + '">'
    + (o.ic ? '<span class="ar-ic">' + o.ic + '</span>' : '')
    + (o.k ? '<span class="ar-k">' + esc(o.k) + '</span>' : '')
    + '<b class="ar-t">' + esc(o.t) + '</b>'
    + (o.v != null && o.v !== '' ? '<span class="ar-v">' + esc(o.v) + '</span>' : '')
    + (o.s ? '<span class="ar-s">' + esc(o.s) + '</span>' : '')
    + (o.adj ? '<span class="ar-adj">' + arFa('chevron-up') + arFa('chevron-down') + '</span>' : '')
    + '</button>';
}

function arSet(key, val) {
  const el = arRoot().querySelector('[data-arf="' + key + '"]');
  if (el && el.innerHTML !== val) el.innerHTML = val;
}

function arVerdict(r) {
  const tiles = verdictTiles(r).filter(Boolean).map((t) => ({ k: t.lab, v: t.fmt(t.v), s: t.sub, tone: arTone(t.v >= t.lo && t.v <= t.hi) }));
  return arDiv('ar-col grow', arDiv('ar-lead', arChip(chipText(r), arKind(r.verdict.kind)) + arChip(fmtDay(r.at), 'plain'))
    + arDiv('ar-mid', esc(r.verdict.title)) + arDiv('ar-sub', esc(r.verdict.cause)) + arTiles(tiles));
}

function arChange(a) {
  if (!a.field) return 'Same recipe';
  return a.field === 'note' ? '' : FIELD_NAME[a.field] + ': ' + fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to);
}

function arAdvice(r, head) {
  const a = r.advice, notes = CG.Advice.notes(r, a), cmp = r.method === 'espresso' && a.predicted && a.next != null
    ? 'This shot ' + r.time.toFixed(1) + ' s · ' + (a.field && Math.abs(a.next - r.time) > 0.4 ? 'next ≈ ' : 'stays ≈ ') + a.next.toFixed(1) + ' s' : '';
  return arDiv('ar-col side', arDiv('ar-sub', head) + arDiv('ar-mid sm ar-crema', esc(a.title))
    + (arChange(a) ? arDiv('ar-txt strong', esc(arChange(a))) : '') + arDiv('ar-txt', esc(a.why || ''))
    + (notes.length ? '<ul class="ar-list">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')
    + (cmp ? arDiv('ar-sub', esc(cmp)) : ''));
}

function arMirrorBox() {
  try {
    const b = $('lnRim').getBBox();
    if (b.width > 10) {
      const w = b.width * 1.35, h = w * 1.1, cx = b.x + b.width / 2, cy = b.y + b.height * 0.35;
      return [cx - w / 2, cy - h / 2, w, h].map((n) => n.toFixed(1)).join(' ');
    }
  } catch (e) {}
  return '20 230 350 420';
}

function arTaste(dx, dy) {
  const rec = RV.rec, t = rec.taste || CG.Taste.predict(rec);
  rec.taste = { x: +clamp(t.x + dx, -1, 1).toFixed(2), y: +clamp(t.y + dy, -1, 1).toFixed(2) };
  rvUpdate();
}

function arMeasure(id, d) {
  const el = $(id);
  if (el.tagName !== 'SELECT') { arClick('[data-adj="' + id + '"][data-by="' + (d > 0 ? 1 : -1) + '"]')(); return; }
  el.selectedIndex = (el.selectedIndex + d + el.options.length) % el.options.length;
  el.dispatchEvent(new Event('change'));
}

function arReplay(id, kicker, rec) {
  const host = document.querySelector('[data-replay=' + id + ']');
  return {
    layout: 'sum', kicker, title: rec.model ? 'Shot replay' : 'Planned vs actual',
    panel: arLend(host, 330, true, 'big'),
    items: [host.querySelector('[data-r=play]') && { ic: arFa('play'), t: 'Play again', act: arClick('[data-replay=' + id + '] [data-r=play]') }, AR_DONE].filter(Boolean),
  };
}

const AR_VIEWS = {
  home() {
    const list = CG.Store.all(), r = list[0], a = (r && r.advice) || {}, act = a.field && a.field !== 'note';
    const esp = list.filter((x) => x.method === 'espresso'), ok = esp.slice(0, 5).filter((x) => x.verdict.kind === 'ok').length;
    const bean = appState.beans.find((b) => b.key === (r ? r.bean : CG.Store.gear().bean)) || appState.beans[0];
    const peak = bean.daysOff >= 7 && bean.daysOff <= 21, post = appState.feed[0], g = CG.Store.gear();
    const repeat = r && (() => repeatRecipe(r));
    const sub = r && (r.method === 'espresso' ? r.dose + ' g → ' + r.yield + ' g · 1:' + (r.yield / r.dose).toFixed(1) : beanName(r.bean) + (r.dose ? ' · ' + r.dose + ' g' : ''));
    return {
      layout: 'deck', kicker: 'Common Ground', title: arText('hmGreet'), lead: arChip(arText('hmSub'), 'plain'),
      items: [
        r && { ic: mi(r.method), k: Date.now() - r.at < 7200000 ? 'Just brewed' : 'Last brew · ' + fmtDay(r.at), t: methodName(r.method), v: timeText(r), s: chipText(r) + ' · ' + sub, tone: arTone(r.verdict.kind === 'ok'), act: () => openBrew(r.id, 'home') },
        r && { ic: arFa('arrow-trend-up'), k: act ? 'Apply and brew' : 'Brew again', t: 'Next: ' + (a.title || 'Keep this recipe'), s: act ? arChange(a) : a.why, act: act ? () => applyAdvice(r) : repeat },
        !r && { ic: arFa('mug-hot'), k: 'No brews yet', t: 'Your first brew', s: 'Pick a method. The app walks you through grind, dose and the pour, then logs it here.', act: () => go('method') },
        { ic: mi('espresso'), k: 'AR · Live X-Ray', t: 'Espresso', s: 'See pressure, flow and channels inside the machine', act: () => openFeature('espresso') },
        { ic: mi('liveart'), k: 'AR · Pour coach', t: 'LiveARt', s: 'Follow the pour route drawn into your cup', act: () => openFeature('liveart') },
        act && { ic: arFa('rotate-right'), k: 'Repeat', t: 'Last ' + methodName(r.method), s: 'Same recipe, no changes', act: repeat },
        { ic: arFa('mug-hot'), k: 'Brew now', t: 'Other methods', s: OTHER.map(methodName).join(', ') + ', or import a recipe', act: () => go('method') },
        { ic: arFa('chart-line'), k: 'Espresso dial-in', t: 'Recent shots on target', v: esp.length ? ok + ' of ' + Math.min(5, esp.length) : 'No shots yet', tone: esp.length ? arTone(ok >= 3) : '', act: () => go('history') },
        { ic: arFa('seedling'), k: 'In the grinder', t: bean.name, v: bean.daysOff + ' days', s: bean.daysOff + ' days off roast · ' + roastState(bean.daysOff), tone: arTone(peak), act: () => go('beans') },
        { ic: arFa('clock-rotate-left'), k: 'Recent brews', t: 'Brew history', v: list.length + ' logged', s: list.slice(1, 4).map((x) => methodName(x.method) + ' ' + timeText(x)).join(' · '), act: () => go('history') },
        post && { ic: '<span class="ar-av">' + esc(post.initials) + '</span>', k: 'From the community · ' + post.method, t: post.user, s: post.notes + ' Tap to try it.', act: () => tryPost(0) },
        { ic: arFa('users'), k: 'Community', t: 'Open the feed', s: appState.feed.length + ' recipes shared', act: () => go('feed') },
        { ic: arFa('sliders'), k: 'Settings', t: 'Grinder and water', s: g.grinder + ' · ' + g.temp + ' °C', act: () => arSub('settings') },
      ].filter(Boolean),
    };
  },

  'home:settings'() {
    const g = CG.Store.gear(), save = (o) => CG.Store.setGear(Object.assign(CG.Store.gear(), o)), on = CG.Tracker.available();
    return {
      layout: 'deck', kicker: 'Settings', title: 'Your gear',
      items: [
        { ic: arFa('gear'), k: 'Grinder', t: g.grinder, s: 'Used for every new brew', adj: (d) => save({ grinder: CG.GRINDERS[(CG.GRINDERS.indexOf(g.grinder) + d + CG.GRINDERS.length) % CG.GRINDERS.length] }) },
        { ic: arFa('temperature-half'), k: 'Espresso water', t: 'Temperature', v: g.temp + ' °C', s: 'Between 85 and 98 °C', adj: (d) => save({ temp: clamp(g.temp + d, 85, 98) }) },
        { ic: arFa('mobile-screen'), k: 'Vibration', t: buzzOn ? 'On' : 'Off', s: 'A small buzz on every tap', act: () => setBuzz(!buzzOn) },
        { ic: arFa('crosshairs'), k: 'Tracking', t: on ? 'Ready' : 'Off', s: on ? 'Point at Plate 01 or Pour Mat 02.' : CG.Tracker.why(true), tone: arTone(on) },
        arAsk('reset', { ic: arFa('rotate'), k: 'Demo', t: 'Reset demo data', s: 'Brings back the five sample brews' }, 'Tap again to reset', () => { CG.Store.reset(); renderHome(); arSub(null); }),
      ],
    };
  },

  method() {
    return {
      layout: 'deck', kicker: 'Brew · Step 1 of 4', title: 'Choose a method',
      items: QUICK.concat('import').map((k) => {
        const m = METHOD_DATA[k];
        return k === 'import'
          ? { ic: mi(k), k: 'From the community', t: 'Import a recipe', s: 'Bring in a saved or shared method', act: () => quickMethod(k) }
          : { ic: mi(k), k: k === 'espresso' ? 'AR · Live X-Ray' : m.dose + ' · ' + m.yield, t: m.name, s: k === 'espresso' ? 'Pressure, flow and channels shown live on Plate 01' : m.grind, sel: k === appState.method, act: () => quickMethod(k) };
      }),
      start: Math.max(0, QUICK.indexOf(appState.method)),
    };
  },

  grind() {
    const m = METHOD_DATA[appState.method] || METHOD_DATA.pourover, gs = grindState();
    const grindCard = { ic: arFa('circle-dot'), t: 'Grind', v: 'Setting ' + (gs.g + 1), tone: arTone(gs.g === gs.target), adj: (d) => { appState.grind = clamp(appState.grind + d, 0, CG.GRIND.scale.length - 1); renderPrep(); }, focus: () => appState.method === 'espresso' && goStep('grind') };
    if (appState.method !== 'espresso') {
      return {
        layout: 'sum', kicker: 'Grind and dose · Step 2 of 4', title: m.name,
        lead: arChip(m.grind, 'plain') + arChip(m.dose) + arChip(m.yield) + arChip(m.temp),
        panel: arLend($('ppGrindCard'), 340, true) + arDiv('ar-col grow', arField('val', 'ar-mid') + arField('note', 'ar-txt ar-note-txt') + arDiv('ar-sub', arFa('clock') + ' ' + esc(m.tips))),
        items: [grindCard, { ic: arFa('play'), t: 'Start brewing', act: arClick('#startBrewingBtn') }],
        live() {
          arSet('val', esc(arText('ppGrindLike')) + '<span class="ar-sub"> · ' + esc(arText('ppGrindVal')) + '</span>');
          arSet('note', $('ppGrindNote').innerHTML);
        },
      };
    }
    const f = CG.Puck.forecast(prepState()), note = (step) => stepNote(step, f, gs)[0] === 'ok';
    const src = CG.Wizard && CG.Wizard.on;
    return {
      layout: 'sum', kicker: 'Espresso · Puck prep · Step 2 of 4', title: 'Set up the shot',
      panel: arLend($('pxHero'), 340, true) + arDiv('ar-col grow', arField('step', 'ar-sub') + arField('note', 'ar-txt ar-note-txt') + arField('why', 'ar-sub ar-clamp')
        + arLend(document.querySelector('.px-fc'), 330, true, 'fill')),
      items: [
        grindCard,
        { ic: arFa('weight-scale'), t: 'Dose', v: appState.dose.toFixed(1) + ' g', tone: arTone(note('dose')), adj: (d) => { appState.dose = clamp(appState.dose + d * 0.5, 14, 22); renderPrep(); }, focus: () => goStep('dose') },
        { ic: arFa('wand-magic-sparkles'), t: 'WDT', v: appState.wdt ? 'Stirred' : 'Skipped', tone: arTone(appState.wdt), adj: () => { appState.wdt = !appState.wdt; renderPrep(); }, focus: () => goStep('wdt') },
        { ic: arFa('compress'), t: 'Tamp', v: TAMP_NAME[appState.tamp], tone: arTone(appState.tamp !== 'light'), adj: (d) => { appState.tamp = AR_TAMP[clamp(AR_TAMP.indexOf(appState.tamp) + d, 0, 2)]; renderPrep(); }, focus: () => goStep('tamp') },
        { ic: arFa('ruler-horizontal'), t: 'Surface', v: appState.level === 'level' ? 'Level' : 'Tilted', tone: arTone(appState.level === 'level'), adj: () => { appState.level = appState.level === 'level' ? 'tilted' : 'level'; renderPrep(); }, focus: () => goStep('tamp') },
        { ic: arFa('satellite-dish'), t: 'Shot data', v: src ? 'Wizard' : 'Demo', adj: arClick('#pxSrc'), act: arClick('#pxSrc') },
        { ic: arFa('play'), t: 'Start brewing', act: arClick('#pxStart') },
      ],
      live() {
        const step = appState.step;
        arSet('step', esc(STEP_NAME[step]) + (step === 'grind' ? ' · ' + esc(arText('pxGrindVal')) : step === 'dose' ? ' · ' + esc(arText('pxRatio')) : ''));
        arSet('note', $('pxNote').innerHTML);
        arSet('why', esc(arText('pxWhyText')));
      },
    };
  },

  brew() {
    if (appState.method === 'espresso') return { layout: 'native' };
    const m = brewMethod || METHOD_DATA.pourover;
    return {
      layout: 'sum', kicker: m.name + ' · Live brew · Step 3 of 4', title: 'Brewing',
      panel: arDiv('ar-col grow', arField('phase', 'ar-sub') + arField('time', 'ar-big') + arField('cue', 'ar-txt') + arDiv('ar-segs', m.phases.map((p) => '<div class="ar-seg"><i></i>' + esc(p.name) + '</div>').join('')))
        + arDiv('ar-col side', arField('hubs', 'ar-hubs')),
      items: [
        { ic: arFa(brewRunning ? 'pause' : 'play'), t: brewRunning ? 'Pause' : 'Resume', act: arClick('#brewPlayPauseBtn') },
        { ic: arFa('forward-step'), t: 'Next step', act: () => Brew.skipPhase() },
        { ic: arFa('flag-checkered'), t: 'Finish', act: arClick('#brewFinishBtn') },
        { ic: arFa('circle'), t: 'Record', v: appState.recording ? 'On' : 'Off', tone: appState.recording ? 'stop' : '', act: arClick('#recToggleBtn') },
      ],
      sig: () => String(brewRunning) + appState.recording,
      live() {
        const p = currentPhase();
        arSet('phase', esc(p.name) + (brewRunning ? '' : ' · paused'));
        arSet('time', esc(arText('brewPhasePillTime').replace('·', '').trim()));
        arSet('cue', esc(p.cue));
        arSet('hubs', [...document.querySelectorAll('#brewStage .hub-card')].filter((h) => h.style.display !== 'none')
          .map((h) => '<div><span>' + esc(h.querySelector('.hub-label').textContent) + '</span><b>' + esc(h.querySelector('.hub-value').textContent) + '</b></div>').join(''));
        arRoot().querySelectorAll('.ar-seg').forEach((s, i) => { s.classList.toggle('on', i === brewIndex); s.classList.toggle('done', i < brewIndex); });
      },
    };
  },

  review() {
    const rec = RV.rec;
    if (!rec) return AR_VIEWS.fallback();
    const esp = rec.method === 'espresso', edited = rec.time !== RV.tracked.time || rec.yield !== RV.tracked.yield;
    return {
      layout: 'sum', kicker: 'Review and log · ' + methodName(rec.method), title: timeText(rec) + (esp ? ' · ' + rec.yield + ' g' : ''),
      panel: arVerdict(rec) + arAdvice(rec, 'Next brew · one change at a time'),
      items: [
        arOpen('taste', 'mug-hot', 'Taste', rec.taste ? CG.Taste.label(rec.taste) : 'Not set'),
        { ic: arFa('star'), t: 'Rating', v: arStars(appState.rating), adj: (d) => { appState.rating = clamp(appState.rating + d, 0, 5); renderStars(); } },
        arOpen('replay', 'chart-area', esp && rec.model ? 'Shot replay' : 'Planned vs actual'),
        arOpen('measure', 'ruler', 'Measurements', edited ? 'Edited' : ''),
        arOpen('notes', 'pen', 'Notes', $('reviewNotes').value.trim() ? 'Added' : ''),
        { ic: arFa('arrow-trend-up'), t: arText('rvApply'), act: arClick('#rvApply') },
        !RV.saved && { ic: arFa('arrow-up-from-bracket'), t: 'Save and share', act: arClick('#shareReviewBtn') },
        !RV.saved && { ic: arFa('floppy-disk'), t: 'Save to history', act: arClick('#saveReviewBtn') },
      ].filter(Boolean),
    };
  },

  'review:taste'() {
    const rec = RV.rec, t = rec.taste || CG.Taste.predict(rec), side = (v, a, b) => v < -0.15 ? a : v > 0.15 ? b : 'Even';
    return {
      layout: 'sum', kicker: 'Review · How did it taste?', title: rec.taste ? CG.Taste.label(rec.taste) : 'Move the dot',
      panel: arLend(document.querySelector('[data-compass=rv]').closest('.rv-card'), 330, true, 'big') + arDiv('ar-col grow', arField('note', 'ar-txt ar-note-txt')),
      items: [
        { ic: arFa('left-right'), t: 'Sour or bitter', v: side(t.x, 'Sour', 'Bitter'), adj: (d) => arTaste(d * AR_TASTE_STEP, 0) },
        { ic: arFa('up-down'), t: 'Weak or strong', v: side(t.y, 'Weak', 'Strong'), adj: (d) => arTaste(0, d * AR_TASTE_STEP) },
        { ic: arFa('bullseye'), t: 'Balanced', act: () => { rec.taste = { x: 0, y: 0 }; rvUpdate(); } },
        AR_DONE,
      ],
      live() { arSet('note', $('rvTasteNote').innerHTML); },
    };
  },

  'review:replay': () => arReplay('rv', 'Review', RV.rec),

  'review:measure'() {
    return {
      layout: 'deck', kicker: 'Review · Saved with this brew', title: 'Log what you measured', lead: arChip(arText('rvMeasNote'), 'plain'),
      items: AR_MEASURE.map(([id, unit]) => {
        const el = $(id), sel = el.tagName === 'SELECT';
        return { ic: arFa(sel ? 'list' : 'sliders'), k: el.closest('.rv-f').firstElementChild.textContent, t: sel ? el.options[el.selectedIndex].text : el.value + ' ' + unit, s: el.classList.contains('edited') ? 'Your reading' : '', adj: (d) => arMeasure(id, d) };
      }),
    };
  },

  'review:notes'() {
    return {
      layout: 'sum', kicker: 'Review', title: 'Notes',
      panel: '<textarea class="ar-notes" id="arNotes" placeholder="Anything worth remembering about this brew"></textarea>',
      items: [
        { ic: arFa('keyboard'), t: 'Type on the phone', act: () => $('arNotes').focus() },
        AR_DONE,
      ],
    };
  },

  history() {
    const all = CG.Store.all(), esp = all.filter((r) => r.method === 'espresso'), ok = esp.filter((r) => r.verdict.kind === 'ok').length, rated = all.filter((r) => r.rating);
    const methods = ['all'].concat([...new Set(all.map((r) => r.method))]), list = all.filter((r) => HS.filter === 'all' || r.method === HS.filter);
    const label = (k) => (k === 'all' ? 'All' : methodName(k)) + ' · ' + (k === 'all' ? all.length : all.filter((r) => r.method === k).length);
    return {
      layout: 'deck', kicker: 'Brew history', title: 'Your brews',
      lead: arChip(all.length + ' brews logged', 'plain') + arChip((esp.length ? Math.round(100 * ok / esp.length) : 0) + '% of shots on target', esp.length ? arTone(ok * 2 >= esp.length) : 'plain') + arChip('Average rating ' + (rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : '0.0'), 'plain'),
      items: [
        { ic: arFa('filter'), k: 'Show', t: label(HS.filter), adj: (d) => { HS.filter = methods[(methods.indexOf(HS.filter) + d + methods.length) % methods.length]; renderHistory(); } },
        arOpen('trend', 'chart-line', 'Espresso dial-in', esp.length ? 'Last ' + Math.min(10, esp.length) + ' shots' : 'No shots yet'),
      ].concat(list.length ? list.map((r) => ({
        ic: mi(r.method), k: fmtDay(r.at), t: methodName(r.method), v: timeText(r), tone: arTone(r.verdict.kind === 'ok'),
        s: [chipText(r), r.method === 'espresso' ? r.dose + ' g → ' + r.yield + ' g' : r.yield ? r.yield + ' g water' : '', beanName(r.bean) + ' · ' + r.roastDays + ' d', r.rating ? arStars(r.rating) : '', r.notes].filter(Boolean).join(' · '),
        act: () => openBrew(r.id, 'history'),
      })) : [{ ic: arFa('mug-hot'), t: 'No brews logged yet', s: 'Finish a brew and save it from the review.' }]).concat(
        arAsk('reset', { ic: arFa('rotate'), k: 'Demo', t: 'Reset demo data', s: 'Brings back the five sample brews' }, 'Tap again to reset all brews', () => { CG.Store.reset(); HS.filter = 'all'; renderHistory(); renderHome(); })),
      start: list.length ? 2 : 0,
    };
  },

  'history:trend'() {
    const all = CG.Store.all(), esp = all.filter((r) => r.method === 'espresso'), shots = esp.slice(0, 10), rated = all.filter((r) => r.rating);
    return {
      layout: 'sum', kicker: 'Brew history · Band 25–32 s', title: 'Espresso dial-in',
      panel: arLend(document.querySelector('.hs-trend'), 340, true, 'big') + arDiv('ar-col grow', arTiles([
        { k: 'Brews logged', v: String(all.length) },
        { k: 'Shots on target', v: (esp.length ? Math.round(100 * esp.filter((r) => r.verdict.kind === 'ok').length / esp.length) : 0) + '%' },
        { k: 'Average rating', v: rated.length ? (rated.reduce((a, r) => a + r.rating, 0) / rated.length).toFixed(1) : '0.0' },
      ]) + arDiv('ar-sub', 'On target, fast, long and channeled shots are marked in the chart. Pick a shot below to open it.')),
      items: shots.map((r) => ({ ic: mi('espresso'), t: fmtDay(r.at, true), v: r.time.toFixed(1) + ' s', tone: arTone(r.verdict.kind === 'ok'), act: () => openBrew(r.id, 'history') })).concat(AR_DONE),
    };
  },

  brewdetail() {
    const r = CG.Store.get(BD.id);
    if (!r) return AR_VIEWS.fallback();
    const act = r.advice.field && r.advice.field !== 'note';
    return {
      layout: 'sum', kicker: 'Brew · ' + fmtDay(r.at), title: methodName(r.method) + ' · ' + timeText(r),
      panel: arVerdict(r) + arAdvice(r, 'Advice for the next brew'),
      items: [
        act && { ic: arFa('arrow-trend-up'), t: 'Try the advice', act: arClick('#bdApply') },
        { ic: arFa('rotate-right'), t: 'Brew again', act: arClick('#bdAgain') },
        arOpen('recipe', 'list', 'Recipe and notes', r.rating ? arStars(r.rating) : ''),
        arOpen('replay', 'chart-area', r.model ? 'Shot replay' : 'Planned vs actual'),
        arOpen('taste', 'mug-hot', 'Taste', CG.Taste.label(r.taste)),
        arAsk('del', { ic: arFa('trash'), t: 'Delete' }, 'Tap again to delete', () => { CG.Store.remove(BD.id); renderHome(); go($('bdBack').dataset.nav); }),
      ].filter(Boolean),
    };
  },

  'brewdetail:recipe'() {
    const r = CG.Store.get(BD.id), rows = [...$('bdRecipe').children].map((row) => ({ k: row.children[0].textContent, v: row.children[1].textContent }));
    return {
      layout: 'sum', kicker: 'Brew · ' + arText('bdWhen'), title: 'Recipe',
      panel: arDiv('ar-col grow', arDiv('ar-grid wide', rows.map((x) => '<div><span>' + esc(x.k) + '</span><b>' + esc(x.v) + '</b></div>').join('')))
        + arDiv('ar-col side', arDiv('ar-sub', 'Notes · ' + arStars(r.rating)) + arDiv('ar-txt', esc(arText('bdNotes')))),
      items: [AR_DONE],
    };
  },

  'brewdetail:replay': () => arReplay('bd', 'Brew · ' + arText('bdWhen'), CG.Store.get(BD.id)),

  'brewdetail:taste'() {
    return {
      layout: 'sum', kicker: 'Brew · ' + arText('bdWhen'), title: 'Taste · ' + arText('bdTasteLab'),
      panel: arLend(document.querySelector('[data-compass=bd]').closest('.rv-card'), 330, true, 'big'),
      items: [AR_DONE],
    };
  },

  shared() {
    return {
      layout: 'sum', kicker: 'Community', title: 'Shared to the community',
      panel: '<div class="ar-frame sm"><b class="ar-ok">' + arFa('check') + '</b></div>' + arDiv('ar-col grow', arDiv('ar-mid sm', esc(arText('sharedMessage') || 'Your brew is saved and posted to the feed.'))),
      items: [
        { ic: arFa('users'), t: 'View community feed', act: () => go('feed') },
        { ic: arFa('clock-rotate-left'), t: 'Open brew history', act: () => go('history') },
        { ic: arFa('house'), t: 'Back to home', act: () => go('home') },
      ],
    };
  },

  feed() {
    return {
      layout: 'deck', kicker: 'Community feed', title: 'Try a recipe',
      items: appState.feed.map((p, i) => ({ ic: '<span class="ar-av">' + esc(p.initials) + '</span>', k: p.method + ' · ' + p.duration + ' · ' + p.time, t: p.user, v: arStars(p.rating), s: p.notes, act: () => tryPost(i) })),
    };
  },

  beans() {
    return {
      layout: 'deck', kicker: 'Beans', title: 'Bean inventory',
      items: [{ ic: arFa('camera'), k: 'Scan', t: 'Scan a bag', s: 'Auto-fill origin, process and roast date', act: () => go('beanscan') }]
        .concat(appState.beans.map((b) => {
          const peak = b.daysOff >= 7 && b.daysOff <= 21, day = new Date(Date.now() - b.daysOff * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          return { ic: arFa('seedling'), k: b.origin + ' · ' + b.process, t: b.name, v: b.daysOff + ' days', s: 'Roasted ' + day + ' · ' + roastState(b.daysOff) + '. Tap to brew.', tone: arTone(peak), act: () => brewBean(b.key) };
        })),
      start: appState.beans.length ? 1 : 0,
    };
  },

  beanscan() {
    return {
      layout: 'sum', kicker: 'Beans', title: 'Scan a bag',
      panel: '<div class="ar-frame"><i></i><i></i><i></i><i></i><b>' + arFa('camera') + '</b></div>' + arDiv('ar-col grow', arDiv('ar-mid ar-pulse', 'Point the phone at your coffee bag') + arDiv('ar-sub', 'The label fills in origin, process and roast date. You can also pick a bag below.')),
      items: [...document.querySelectorAll('.scan-chips [data-bag]')].map((b) => ({ ic: arFa('tag'), t: b.textContent.trim(), act: () => b.click() })),
    };
  },

  bagdetail() {
    const bag = scannedBag();
    return {
      layout: 'sum', kicker: 'Match found', title: bag.name,
      panel: arDiv('ar-col grow', arDiv('ar-lead', arChip(bag.roastLabel, 'plain')) + arDiv('ar-mid sm', esc(bag.context)) + arDiv('ar-sub', 'Tasting notes') + arDiv('ar-lead', bag.notes.map((n) => arChip(n)).join('')) + arDiv('ar-sub', esc(bag.roastedIn))),
      items: [
        { ic: arFa('mug-hot'), t: 'Brew this bag', act: arClick('#brewThisBagBtn') },
        { ic: arFa('location-dot'), t: 'Origin story', act: arClick('#bagPhoto') },
      ],
    };
  },

  originstory() {
    const bag = scannedBag();
    return {
      layout: 'sum', kicker: 'Origin', title: bag.name,
      panel: arDiv('ar-col grow', arDiv('ar-sub', arFa('location-dot') + ' ' + esc(bag.roastedIn)) + arDiv('ar-mid sm', esc(bag.originFact)) + (bag.originExplainer ? arDiv('ar-txt', esc(bag.originExplainer)) : '')),
      items: [
        { ic: arFa('mug-hot'), t: 'Brew this bag', act: arClick('#brewThisBagBtn') },
        { ic: arFa('chevron-left'), t: 'Back to the bag', act: arClick('[data-screen=originstory] .back-circle') },
      ],
    };
  },

  studio() {
    const pat = CG.PATTERNS[uiState.key], src = Math.max(0, AR_SRC.findIndex((s) => s[0] === uiState.source)), keys = Object.keys(CG.PATTERNS);
    const steps = [...document.querySelectorAll('#lvSteps .lv-step')], si = Math.max(0, steps.findIndex((n) => n.classList.contains('on')));
    return {
      layout: 'sum', kicker: 'LiveARt · Before you pour', title: 'What are we making?',
      panel: arLend(document.querySelector('.lv-model-card'), 348, false)
        + arDiv('ar-col grow', arDiv('ar-mid sm', esc(pat.name) + '<span class="ar-sub"> · ' + patSecs(pat) + ' · ' + LEVELS[pat.level] + '</span>') + arDiv('ar-txt', esc(pat.blurb))
          + arDiv('ar-segs', pat.steps.map((s) => '<div class="ar-seg"><i></i>' + esc(s.label) + '</div>').join(''))
          + arField('step', 'ar-sub ar-crema') + arField('why', 'ar-txt')),
      items: keys.map((k) => ({ ic: mi('liveart'), t: CG.PATTERNS[k].name, sel: k === uiState.key, act: arClick('#lvPatterns [data-pat="' + k + '"]') })).concat([
        { ic: arFa('list-ol'), t: 'Step', v: pat.steps[si].label, adj: (d) => steps[(si + d + steps.length) % steps.length].click(), act: () => steps[(si + 1) % steps.length].click() },
        { ic: arFa(M.playing ? 'pause' : 'play'), t: M.playing ? 'Pause' : 'Play', act: arClick('#lvPlay') },
        { ic: arFa('arrows-rotate'), t: 'Orbit', v: M.spin ? 'On' : 'Off', act: arClick('#lvSpin') },
        { ic: arFa('circle-dot'), t: '2D view', v: $('lvPattern').classList.contains('on') ? 'On' : 'Off', act: arClick('#lvPattern') },
        { ic: arFa('gauge-simple'), t: 'Speed', v: SPEEDS.find((x) => x[0] === uiState.speed)[1], adj: (d) => arClick('#lvSpeed [data-speed="' + SPEEDS[clamp(SPEEDS.findIndex((x) => x[0] === uiState.speed) + d, 0, 2)][0] + '"]')() },
        { ic: arFa('eye'), t: 'Watch first', v: uiState.watch ? 'On' : 'Off', act: arClick('#lvPractice [data-opt="watch"]') },
        { ic: arFa('pause'), t: 'Short pauses', v: uiState.stops ? 'On' : 'Off', act: arClick('#lvPractice [data-opt="stops"]') },
        { ic: arFa('music'), t: 'Beat sound', v: uiState.sound ? 'On' : 'Off', act: arClick('#lvPractice [data-opt="sound"]') },
        { ic: arFa('layer-group'), t: 'Guides', v: 'Level ' + uiState.guides, adj: (d) => arClick('#lvGuides [data-g="' + clamp(uiState.guides + d, 1, 5) + '"]')() },
        { ic: arFa('satellite-dish'), t: 'Input', v: AR_SRC[src][1], adj: (d) => { arClick('#lvSource [data-src="' + AR_SRC[(src + d + 4) % 4][0] + '"]')(); setTimeout(arRefresh, 500); } },
        { ic: arFa('camera'), t: 'Open the camera', act: () => go('getready') },
      ]),
      start: keys.indexOf(uiState.key),
      live() {
        arSet('step', esc(arText('lvWhyStep')));
        arSet('why', esc(arText('lvWhy')) + '<span class="ar-sub"> · ' + esc(arText('lvGuidesText')) + '</span>');
        const on = steps.findIndex((n) => n.classList.contains('on'));
        arRoot().querySelectorAll('.ar-seg').forEach((s, i) => s.classList.toggle('on', i === Math.max(0, on)));
      },
    };
  },

  getready() {
    return {
      layout: 'sum', kicker: 'LiveARt · Line it up', title: 'Pouring a ' + arText('lvReadyPattern'), lead: arChip(SPEEDS.find((x) => x[0] === uiState.speed)[2], 'plain'),
      panel: arDiv('ar-col side', arField('hint', 'ar-mid sm') + arField('count', 'ar-count')) + arDiv('ar-col grow', arField('checks', 'ar-checks')),
      items: [{ ic: arFa('play'), t: 'Start now', act: () => go('coach') }, { ic: arFa('sliders'), t: 'Change setup', act: () => go('studio') }],
      live() {
        const cd = $('lvCountdown');
        arSet('hint', esc(arText('lvHint')));
        arSet('count', cd.classList.contains('hidden') ? '' : esc(cd.textContent));
        arSet('checks', [...document.querySelectorAll('.lv-check')].map((c) => '<div class="ar-check' + (c.classList.contains('done') ? ' done' : '') + '"><i></i><div><b>' + esc(c.querySelector('.lv-check-title').textContent) + '</b><span>' + esc(c.querySelector('.lv-check-desc').textContent) + '</span></div><em>' + esc(c.querySelector('.lv-check-tag').textContent) + '</em></div>').join(''));
      },
    };
  },

  coach() {
    const scr = document.querySelector('.ln-screen'), fail = scr.classList.contains('track-fail');
    const wait = !fail && scr.classList.contains('pinned') && !scr.classList.contains('found') && MAT.armed;
    const pat = CG.PATTERNS[CG.Coach.key || uiState.key];
    const body = fail ? arDiv('ar-mid sm ar-warn', 'Tracking is off') + arDiv('ar-txt', esc(scr.querySelector('[data-why]').textContent))
      : wait ? arDiv('ar-mid sm ar-pulse', 'Look down at the cup ring or Pour Mat 02') + arDiv('ar-sub', 'The route appears on the cup once one is found.')
        : CG.Coach.hold ? arDiv('ar-sub', 'Next') + arDiv('ar-mid sm ar-crema', esc(CG.Coach.hold.label)) + arDiv('ar-txt', esc(CG.Coach.hold.cue)) + arField('nextin', 'ar-sub')
          : arField('stepn', 'ar-sub') + arField('clock', 'ar-big') + arField('word', 'ar-mid sm ar-crema') + arField('hint2', 'ar-txt');
    return {
      layout: 'sum', kicker: 'LiveARt · ' + pat.name, title: fail ? 'Tracking is off' : wait ? 'Find the cup' : 'Pour',
      lead: arChip('Wristband', 'ok') + arChip(arText('lnMode'), 'plain'),
      panel: (fail || wait ? '<div class="ar-frame"><i></i><i></i><i></i><i></i><b>' + arFa(fail ? 'eye-slash' : 'crosshairs') + '</b></div>' : '<div class="ar-mirror"><svg viewBox="' + arMirrorBox() + '"><use href="#lnLayer"/></svg></div>')
        + arDiv('ar-col grow', body + arDiv('ar-segs', pat.steps.map((s) => '<div class="ar-seg"><i></i>' + esc(s.label) + '</div>').join(''))),
      items: [
        CG.Coach.hold && { ic: arFa('play'), t: 'Start now', act: () => CG.Coach.go() },
        fail && { ic: arFa('eye-slash'), t: 'Show without tracking', act: arClick('.ln-screen [data-skip]') },
        wait && { ic: arFa('play'), t: 'Pour without the mat', act: () => { MAT.armed = false; CG.Tracker.stop(); scr.classList.remove('pinned', 'found'); startPour(); } },
        { ic: arFa('sliders'), t: 'Change setup', act: () => go('studio') },
      ].filter(Boolean),
      sig: () => ['track-fail', 'found', 'pinned'].map((c) => scr.classList.contains(c)).join() + MAT.armed + !!CG.Coach.hold,
      live() {
        arSet('nextin', esc(arText('lnNextIn')));
        arSet('stepn', esc(arText('lnStepName')));
        arSet('clock', esc(CG.Coach.lead > 0 ? String(Math.ceil(CG.Coach.lead)) : arText('lnClock')));
        arSet('word', esc(arText('lnWord')));
        arSet('hint2', esc(arText('lnHint2')));
        const on = [...$('lnPhase').children].findIndex((c) => c.classList.contains('on'));
        arRoot().querySelectorAll('.ar-seg').forEach((s, i) => { s.classList.toggle('on', i === on); s.classList.toggle('done', on > i); });
      },
    };
  },

  forensics() {
    const rep = CG.Report, items = [
      { ic: arFa('rotate-right'), t: 'Pour again', act: () => go('getready') },
      { ic: arFa('sliders'), t: 'Change setup', act: () => go('studio') },
    ];
    if (!rep || !rep.rows.length) return { layout: 'sum', kicker: 'LiveARt · Just poured', title: 'No pour yet', panel: arDiv('ar-col grow', arDiv('ar-mid sm', 'No pour recorded yet.')), items };
    const cs = rep.scores, score = Math.round((cs.pos + cs.height + cs.flow + cs.hz) / 4), tip = speedTip(score, rep.speed || 1);
    if (tip) items.unshift({ ic: arFa('gauge-simple'), k: tip[0], t: tip[2], s: tip[1], act: () => { uiState.speed = tip[3]; go('getready'); } });
    return {
      layout: 'sum', kicker: 'LiveARt · Just poured', title: CG.PATTERNS[rep.key].name,
      panel: arDiv('ar-col side', arDiv('ar-big ' + (score >= 85 ? 'ar-ok' : score >= 65 ? 'ar-warn' : 'ar-stop'), score + '<small>%</small>') + arDiv('ar-mid sm', esc(arText('fxVerdict'))) + arDiv('ar-sub', 'How much of the pour stayed on track'))
        + arLend(document.querySelector('.fx-trace-card'), 300, false)
        + arDiv('ar-col grow', arTiles2(Object.keys(FX_NAMES).map((c) => ({ k: FX_NAMES[c][0], v: cs[c] + '%', s: FX_NAMES[c][1], bar: cs[c], tone: arTone(cs[c] >= 85) })))),
      items: [arOpen('faults', 'triangle-exclamation', 'What to work on', rep.faults.length ? String(rep.faults.length) : 'Nothing')].concat(items),
    };
  },

  'forensics:faults'() {
    const rep = CG.Report;
    return {
      layout: 'deck', kicker: 'LiveARt · ' + CG.PATTERNS[rep.key].name, title: 'What to work on',
      items: rep.faults.length ? rep.faults.map((f, i) => {
        const x = CG.explain(f, rep.key);
        return { ic: '<span class="ar-av">' + (i + 1) + '</span>', k: 'During the ' + x.step.toLowerCase(), t: x.title, s: x.effect + ' ' + x.fix + ' Tap to practise it.', tone: 'warn', act: () => { uiState.range = practiseRange(rep.key, f.step); go('coach'); } };
      }) : [{ ic: arFa('check'), t: 'Nothing to report', s: 'No problems that lasted long enough to count. Try one guide level lower.' }],
    };
  },

  fallback() {
    const h = document.querySelector('.screen.active .header-title');
    return { layout: 'deck', kicker: 'Common Ground', title: h ? h.textContent : 'Common Ground', items: [{ ic: arFa('house'), t: 'Home', act: () => go('home') }] };
  },
};

function arBuild() {
  AR.want = [];
  const v = (AR_VIEWS[arPage()] || AR_VIEWS[AR.name] || AR_VIEWS.fallback)();
  if (AR.sub && !AR_VIEWS[arPage()]) AR.sub = null;
  AR.sig = v.sig ? v.sig() : '';
  return v;
}

function arRender() {
  const v = AR.view, root = arRoot();
  arReturn();
  AR.hud = v.layout === 'native';
  if (AR.hud) { root.className = 'ar'; root.innerHTML = ''; arFocus(AR.pos[arPage()] ?? arHudStart()); return; }
  root.className = 'ar on ar-' + v.layout + (arCalm() && !AR.morph ? ' enter' : '');
  root.innerHTML = '<div class="ar-safe"><div class="ar-head"><div class="ar-head-txt"><div class="ar-kicker">' + esc(v.kicker || '') + '</div><h1 class="ar-title">' + esc(v.title) + '</h1></div><div class="ar-step" data-arf="pager"></div>'
    + '<button type="button" class="ar-phone" aria-label="Phone view">' + arFa('mobile-screen-button') + '<span>Phone view</span></button></div>'
    + (v.lead ? '<div class="ar-lead">' + v.lead + '</div>' : '')
    + '<div class="ar-body">' + (v.panel ? '<div class="ar-panel">' + v.panel + '</div>' : '')
    + '<div class="ar-row ' + (v.layout === 'deck' ? 'big' : 'small') + '"><div class="ar-track">' + v.items.map(arCard).join('') + '</div></div></div>'
    + '<div class="ar-hint" data-arf="hint"></div><div class="ar-toast" data-arf="toast"></div></div>';
  AR.lent = AR.want.map((el, i) => {
    const mark = document.createComment('ar');
    el.before(mark);
    root.querySelector('[data-lend="' + i + '"]').appendChild(el);
    return [el, mark];
  });
  const notes = $('arNotes');
  if (notes) { notes.value = $('reviewNotes').value; notes.oninput = () => { $('reviewNotes').value = notes.value; }; }
  arFocus(AR.pos[arPage()] ?? v.start ?? 0);
  if (v.live) v.live();
  arToast();
  arFit();
  setTimeout(arFit, 450);
}

function arHudButtons() {
  return [...document.querySelectorAll('#glHud .gl-bar button')].filter((b) => b.offsetParent);
}

function arHudStart() {
  return Math.max(0, arHudButtons().indexOf($('glPlayBtn')));
}

function arFocus(i) {
  if (AR.hud) {
    const btns = arHudButtons();
    AR.i = clamp(i, 0, btns.length - 1);
    AR.pos[arPage()] = AR.i;
    btns.forEach((b, k) => b.classList.toggle('ar-on', k === AR.i));
    return;
  }
  const v = AR.view, root = arRoot(), cards = root.querySelectorAll('.ar-card');
  if (!v || !cards.length) return;
  arTop(false);
  AR.i = clamp(i, 0, cards.length - 1);
  AR.pos[arPage()] = AR.i;
  cards.forEach((c, k) => c.classList.toggle('on', k === AR.i));
  const row = root.querySelector('.ar-row'), track = row.firstChild, c = cards[AR.i];
  const x = clamp(c.offsetLeft + c.offsetWidth / 2 - row.clientWidth / 2, 0, Math.max(0, track.scrollWidth - row.clientWidth));
  track.style.transform = 'translateX(' + (-x).toFixed(1) + 'px)';
  const it = v.items[AR.i];
  arSet('pager', cards.length > 3 ? (AR.i + 1) + ' / ' + cards.length : '');
  arSet('hint', it.adj ? AR_HINT_ADJ : AR_HINT);
  if (it.focus) it.focus();
}

function arMove(i) {
  const was = AR.i;
  arFocus(i);
  if (AR.i !== was) buzz('tick');
}

function arTop(on) {
  AR.top = on;
  arRoot().classList.toggle('top', on);
  const b = arRoot().querySelector('.ar-phone');
  if (b) b.classList.toggle('on', on);
  const it = AR.view && AR.view.items[AR.i];
  arSet('hint', on ? AR_HINT_TOP : it && it.adj ? AR_HINT_ADJ : AR_HINT);
}

function arToast() {
  const t = $('applyToast'), on = t.classList.contains('on');
  arSet('toast', on ? arFa('check') + ' ' + esc(t.textContent) : '');
  const el = arRoot().querySelector('.ar-toast');
  if (el) el.classList.toggle('on', on);
}

function arMorph(kind, fn) {
  if (AR.morph || arCalm()) { fn(); return; }
  AR.morph = true;
  document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { AR.morph = false; delete document.documentElement.dataset.vt; });
}

function arShow(name) {
  clearInterval(AR.timer);
  if (!name) {
    Object.assign(AR, { name: null, sub: null, hud: false });
    arReturn();
    arRoot().className = 'ar';
    arRoot().innerHTML = '';
    return arHudButtons().forEach((b) => b.classList.remove('ar-on'));
  }
  if (name !== AR.name) { AR.sub = null; AR.ask = null; }
  const kind = AR.name ? 'step' : 'in';
  AR.name = name;
  arMorph(kind, arRedraw);
  AR.timer = setInterval(arLive, 250);
}

function arRedraw() {
  AR.view = arBuild();
  arRender();
}

function arRefresh() {
  if (AR.name) arRedraw();
}

function arLive() {
  const v = AR.view;
  if (!v || AR.hud) return;
  if (v.sig && v.sig() !== AR.sig) { arRefresh(); return; }
  if (v.live) v.live();
  arToast();
}

function arSub(k) {
  AR.sub = k;
  AR.ask = null;
  arMorph('step', arRedraw);
}

function arAct() {
  if (AR.hud) { const b = arHudButtons()[AR.i]; if (b) { buzz('tap'); b.click(); } return; }
  if (AR.top) { buzz('tap'); setGlasses(false); return; }
  const it = AR.view && AR.view.items[AR.i], before = arPage();
  if (!it || !(it.act || it.adj)) return;
  buzz('tap');
  if (it.act) it.act(); else it.adj(1);
  setTimeout(() => { if (arPage() === before && AR.view && !AR.hud) arRefresh(); }, 60);
}

function arAdj(d) {
  const it = !AR.hud && AR.view && AR.view.items[AR.i];
  if (AR.top) { if (d < 0) arTop(false); return; }
  if (it && !it.adj && d > 0) { buzz('tick'); arTop(true); return; }
  if (!it || !it.adj) return;
  buzz('select');
  it.adj(d);
  arRefresh();
}

function arBack() {
  buzz('select');
  if (AR.sub) { arSub(null); return; }
  const b = document.querySelector('.screen.active .back-circle[data-nav]');
  if (b) b.click();
}

function arOnKey(e) {
  if (!AR.name || !(AR.hud || arRoot().classList.contains('on'))) return;
  const k = e.key, field = e.target.closest('input, select, textarea');
  if (field) {
    if (k === 'Escape') { field.blur(); arBack(); e.preventDefault(); }
    return;
  }
  if (AR.hud && k === 'x') glToggleView();
  else if (k === 'p') setGlasses(false);
  else if (k === 'ArrowRight') arMove(AR.i + 1);
  else if (k === 'ArrowLeft') arMove(AR.i - 1);
  else if (k === 'ArrowUp') arAdj(1);
  else if (k === 'ArrowDown') arAdj(-1);
  else if (k === 'Enter' || k === ' ') arAct();
  else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') arBack();
  else return;
  e.preventDefault();
}

function arPointer(el) {
  const end = () => { AR.press = null; clearTimeout(AR.hold); };
  el.addEventListener('pointerdown', (e) => {
    if (!AR.name || e.target.closest('textarea')) return;
    AR.press = { x: e.clientX, y: e.clientY, moved: false, done: false, mouse: e.pointerType === 'mouse', card: e.target.closest('.ar-card'), btn: e.target.closest('.gl-bar button'), phone: e.target.closest('.ar-phone') };
    clearTimeout(AR.hold);
    AR.hold = setTimeout(() => { if (AR.press && !AR.press.moved) { AR.press.done = true; arBack(); } }, 600);
  });
  el.addEventListener('pointermove', (e) => {
    const p = AR.press;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 14) { p.moved = true; clearTimeout(AR.hold); }
  });
  el.addEventListener('pointerup', (e) => {
    const p = AR.press;
    end();
    if (!p || p.done) return;
    if (p.phone) { buzz('tap'); setGlasses(false); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y, s = el.clientHeight * 0.06;
    if (Math.abs(dx) > s && Math.abs(dx) > Math.abs(dy)) arMove(AR.i + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > s) arAdj(dy < 0 ? 1 : -1);
    else if (p.btn) buzz('tap');
    else if (p.mouse && p.card) { arFocus(+p.card.dataset.i); arAct(); }
    else arAct();
  });
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function arInit() {
  arPointer(arRoot());
  arPointer($('glHud'));
  document.addEventListener('keydown', arOnKey);
  window.addEventListener('resize', () => { if (AR.name) arFit(); });
  CG.AR = { show: arShow };
  if (appState.glasses) applyGlasses(document.querySelector('.screen.active').dataset.screen);
}

arInit();
