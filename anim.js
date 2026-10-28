// ===== Stick-figure demo animator (forward kinematics) =====
const L = { T: 50, NECK: 6, HEAD: 9, TH: 42, SH: 40, UA: 28, FA: 26, FOOT: 11 };
const GROUND = 182;
const rad = (d) => d * Math.PI / 180;
const limb = (a, len) => [Math.sin(rad(a)) * len, Math.cos(rad(a)) * len];
const add = (p, v) => [p[0] + v[0], p[1] + v[1]];
const sub = (p, v) => [p[0] - v[0], p[1] - v[1]];

function lerpPose(a, b, p) {
  const o = {};
  for (const k in a) o[k] = (typeof a[k] === 'number' && typeof b[k] === 'number') ? a[k] + (b[k] - a[k]) * p : (p < 0.5 ? a[k] : b[k]);
  return o;
}
function swapSides(k) {
  return Object.assign({}, k, { th1: k.th2, sh1: k.sh2, th2: k.th1, sh2: k.sh1, ua1: k.ua2, fa1: k.fa2, ua2: k.ua1, fa2: k.fa1, anchor: k.anchor === 'f2' ? 'f1' : k.anchor === 'f1' ? 'f2' : k.anchor });
}

// Returns interpolated keyframe for anim at time t (seconds)
function animPose(key, t) {
  const A = ANIMS[key];
  if (!A) return null;
  const [k0, k1] = A.k;
  if (A.alt) {
    const per = A.dur * 2, ph = (t % per) / per; // 0..1
    const half = ph < 0.5 ? 0 : 1, local = (ph % 0.5) * 2;
    const p = (1 - Math.cos(local * 2 * Math.PI)) / 2;
    return lerpPose(k0, half ? swapSides(k1) : k1, p);
  }
  const p = (1 - Math.cos((t / A.dur) * 2 * Math.PI)) / 2;
  return lerpPose(k0, k1, p);
}

function solveSide(k) {
  const leg = (hip, th, sh) => { const knee = add(hip, limb(th, L.TH)); const ankle = add(knee, limb(sh, L.SH)); const toe = add(ankle, [Math.cos(rad(sh)) * L.FOOT, -Math.sin(rad(sh)) * L.FOOT]); return { knee, ankle, toe }; };
  let hip;
  const gy = k.ay || GROUND;
  if (k.anchor === 'hip') hip = [k.x, k.y];
  else if (k.anchor === 'f1' || k.anchor === 'f2') {
    const th = k.anchor === 'f1' ? k.th1 : k.th2, sh = k.anchor === 'f1' ? k.sh1 : k.sh2;
    const ankle = [k.ax, gy - 4];
    hip = sub(sub(ankle, limb(sh, L.SH)), limb(th, L.TH));
  } else if (k.anchor === 'k1') {
    hip = sub([k.ax, gy - 5], limb(k.th1, L.TH));
  } else if (k.anchor === 'toe') {
    const foot = [Math.cos(rad(k.sh1)) * L.FOOT, -Math.sin(rad(k.sh1)) * L.FOOT];
    const ankle = sub([k.ax, gy], foot);
    hip = sub(sub(ankle, limb(k.sh1, L.SH)), limb(k.th1, L.TH));
  } else hip = [k.x, k.y];
  const tv = [Math.sin(rad(k.t)), -Math.cos(rad(k.t))];
  const sh = add(hip, [tv[0] * L.T, tv[1] * L.T]);
  const neck = add(sh, [tv[0] * L.NECK, tv[1] * L.NECK]);
  const head = add(neck, [tv[0] * L.HEAD, tv[1] * L.HEAD]);
  const arm = (ua, fa) => { const el = add(sh, limb(ua, L.UA)); return { el, wr: add(el, limb(fa, L.FA)) }; };
  return { hip, sh, head, l1: leg(hip, k.th1, k.sh1), l2: leg(hip, k.th2, k.sh2), a1: arm(k.ua1, k.fa1), a2: arm(k.ua2, k.fa2) };
}

function solveFront(k) {
  const kb = rad(k.kb || 0);
  const legLen = (L.TH * Math.cos(kb) + L.SH) * Math.cos(rad(k.la));
  const hy = k.anchor === 'hip' || k.bar ? k.y : GROUND - 4 - legLen;
  const hipC = [100, hy];
  const legs = [-1, 1].map((s) => {
    const hip = [100 + s * 9, hy];
    const knee = [hip[0] + s * Math.sin(rad(k.la)) * L.TH, hip[1] + Math.cos(rad(k.la)) * L.TH * Math.cos(kb)];
    const ankle = [knee[0] + s * Math.sin(rad(k.la)) * L.SH, knee[1] + Math.cos(rad(k.la)) * L.SH];
    return { hip, knee, ankle, toe: [ankle[0] + s * 7, ankle[1] + 2] };
  });
  const sy = hy - L.T;
  const arms = [-1, 1].map((s) => {
    const sh = [100 + s * 15, sy + 4];
    const el = [sh[0] + s * Math.sin(rad(k.ua)) * L.UA, sh[1] + Math.cos(rad(k.ua)) * L.UA];
    const wr = [el[0] + s * Math.sin(rad(k.fa)) * L.FA, el[1] + Math.cos(rad(k.fa)) * L.FA];
    return { sh, el, wr };
  });
  return { hipC, head: [100, sy - L.NECK - L.HEAD], neckY: sy, legs, arms };
}

// Draw onto ctx in a 200x200 design space scaled to w×h
function drawDemo(ctx, key, t, w, h, opts = {}) {
  const A = ANIMS[key];
  if (!A) return;
  const k = animPose(key, t);
  const s = Math.min(w, h) / 200;
  ctx.save();
  if (!opts.noBg) { ctx.fillStyle = opts.bg || '#151a24'; ctx.fillRect(0, 0, w, h); }
  ctx.translate((w - 200 * s) / 2, (h - 200 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const main = opts.color || '#7cf5c4', far = opts.far || 'rgba(124,245,196,0.45)';
  // ground
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, GROUND + 1); ctx.lineTo(190, GROUND + 1); ctx.stroke();
  const line = (pts, col, wdt) => { ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); };
  const dumbbell = (p) => { ctx.fillStyle = '#ffb547'; ctx.fillRect(p[0] - 7, p[1] - 3, 14, 6); ctx.fillRect(p[0] - 9, p[1] - 5, 4, 10); ctx.fillRect(p[0] + 5, p[1] - 5, 4, 10); };
  if (k.view === 'front') {
    const P = solveFront(k);
    if (A.bar) { line([[40, 22], [160, 22]], '#8892a6', 4); }
    for (const lg of P.legs) line([lg.hip, lg.knee, lg.ankle, lg.toe], main, 7);
    line([[P.legs[0].hip[0], P.hipC[1]], [P.legs[1].hip[0], P.hipC[1]]], main, 8);
    line([[100, P.hipC[1]], [100, P.neckY]], main, 9);
    line([P.arms[0].sh, P.arms[1].sh], main, 7);
    for (const a of P.arms) { line([a.sh, a.el, a.wr], main, 6); if (A.db) dumbbell(a.wr); }
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(P.head[0], P.head[1], L.HEAD + 1, 0, Math.PI * 2); ctx.fill();
  } else {
    const P = solveSide(k);
    if (A.bench) {
      ctx.fillStyle = '#3a4255';
      if (A.bench === 'left') ctx.fillRect(2, (k.ay || GROUND) - 2, 40, GROUND - (k.ay || GROUND) + 3);
      else ctx.fillRect(40, 148, 44, 34);
    }
    line([P.hip, P.l2.knee, P.l2.ankle, P.l2.toe], far, 7);
    line([P.sh, P.a2.el, P.a2.wr], far, 6);
    if (A.db && key !== 'goblet_squat') dumbbell(P.a2.wr);
    line([P.hip, P.sh], main, 10);
    line([P.hip, P.l1.knee, P.l1.ankle, P.l1.toe], main, 7);
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(P.head[0], P.head[1], L.HEAD + 1, 0, Math.PI * 2); ctx.fill();
    line([P.sh, P.a1.el, P.a1.wr], main, 6);
    if (A.db) dumbbell(key === 'goblet_squat' ? [(P.a1.wr[0] + P.sh[0]) / 2 + 6, P.a1.wr[1] + 4] : P.a1.wr);
  }
  ctx.restore();
}

if (typeof window !== 'undefined') { window.drawDemo = drawDemo; window.animPose = animPose; }
