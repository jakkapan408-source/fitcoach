// ===== FitCoach main app =====
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (n) => Math.round(n);
const todayKey = (d = new Date()) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return todayKey(d); };
const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmtDate = (key) => { const d = new Date(key + 'T12:00:00'); return `${TH_DAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]}`; };

// ---------- Storage ----------
const STORE_KEY = 'fitcoach.v1';
const DEFAULT_STATE = () => ({
  profile: null,
  settings: { voice: true, rate: 1.0, voiceName: '', restSec: 60, beep: true },
  nutrition: { kcalAdjust: 0 },
  foodLog: {}, customFoods: [], water: {},
  weights: [], waists: [],
  program: null, nextDay: 0,
  exState: {}, patternProgress: {},
  history: [], mealSeed: {}, notes: [],
  lastCheck: null,
});
let S;
try { S = Object.assign(DEFAULT_STATE(), JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { S = DEFAULT_STATE(); }
S.settings = Object.assign(DEFAULT_STATE().settings, S.settings || {});
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('บันทึกข้อมูลไม่สำเร็จ: พื้นที่เต็ม?'); } };
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Body & nutrition math ----------
const ACTIVITY = [
  { v: 1.2, t: 'นั่งทำงานเป็นหลัก', d: 'ออฟฟิศ เดินน้อย' },
  { v: 1.375, t: 'เดินบ้าง', d: 'เดินวันละ 5,000–7,500 ก้าว' },
  { v: 1.5, t: 'ขยับตัวเยอะ', d: 'ยืน/เดินทั้งวัน' },
  { v: 1.65, t: 'ใช้แรงมาก', d: 'งานใช้แรงกาย' },
];
function body(p = S.profile) {
  const hM = p.height / 100;
  const bmi = p.weight / (hM * hM);
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const trainDays = (p.days || []).length;
  const tdee = bmr * p.activity + (trainDays * 250) / 7;
  const bf = p.waist ? (p.sex === 'm' ? 64 : 76) - 20 * (p.height / p.waist) : null; // RFM estimate
  let def;
  if (bf != null) def = (p.sex === 'm' ? bf > 25 : bf > 32) ? 0.2 : (p.sex === 'm' ? bf < 15 : bf < 23) ? 0.1 : 0.15;
  else def = bmi > 27 ? 0.2 : bmi < 22 ? 0.1 : 0.15;
  const floor = Math.max(bmr, p.sex === 'm' ? 1500 : 1200);
  const kcal = Math.max(floor, Math.round((tdee * (1 - def) + (S.nutrition.kcalAdjust || 0)) / 10) * 10);
  const refW = bmi > 27 ? 25 * hM * hM : p.weight;
  const protein = Math.round(refW * 2.0);
  const fat = Math.round(Math.max(refW * 0.8, (kcal * 0.25) / 9));
  const carb = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const water = Math.round(p.weight * 35 / 250) * 250;
  return { bmi, bmr: r0(bmr), tdee: r0(tdee), bf, def, kcal, protein, fat, carb, water };
}
const bmiLabel = (b) => b < 18.5 ? 'น้ำหนักน้อย' : b < 23 ? 'ปกติ' : b < 25 ? 'ท้วม' : b < 30 ? 'อ้วนระดับ 1' : 'อ้วนระดับ 2';

// ---------- Food helpers ----------
const allFoods = () => FOODS.concat(S.customFoods || []);
const foodById = (id) => allFoods().find((f) => f.id === id);
const foodByName = (n) => FOODS.find((f) => f.name === n);
function dayTotals(key) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const it of S.foodLog[key] || []) { const f = foodById(it.foodId); if (!f) continue; t.kcal += f.kcal * it.qty; t.p += f.p * it.qty; t.c += f.c * it.qty; t.f += f.f * it.qty; }
  return t;
}
const MEALS = [{ k: 'b', t: 'มื้อเช้า', share: 0.25 }, { k: 'l', t: 'มื้อกลางวัน', share: 0.35 }, { k: 'd', t: 'มื้อเย็น', share: 0.3 }, { k: 's', t: 'ของว่าง', share: 0.1 }];

function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
function comboStats(combo) { const t = { kcal: 0, p: 0, c: 0, f: 0, items: [] }; for (const [n, q] of combo) { const f = foodByName(n); if (!f) continue; t.kcal += f.kcal * q; t.p += f.p * q; t.c += f.c * q; t.f += f.f * q; t.items.push({ foodId: f.id, qty: q }); } return t; }
function mealPlan(key) {
  const B = body();
  const seed = [...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + (S.mealSeed[key] || 0) * 977;
  const rnd = seeded(seed);
  const plan = {};
  let pSum = 0, kSum = 0;
  for (const m of MEALS) {
    const pool = m.k === 'b' ? MEAL_COMBOS.b : m.k === 's' ? MEAL_COMBOS.s : MEAL_COMBOS.m;
    const budget = B.kcal * m.share, pBudget = B.protein * m.share;
    const scored = pool.map((c) => { const st = comboStats(c); const score = Math.abs(st.kcal - budget) / budget + Math.max(0, pBudget - st.p) / Math.max(10, pBudget) * 0.8 + rnd() * 0.35; return { st, score }; })
      .sort((a, b) => a.score - b.score);
    plan[m.k] = scored[Math.floor(rnd() * Math.min(3, scored.length))].st;
    pSum += plan[m.k].p; kSum += plan[m.k].kcal;
  }
  // top up protein in snack
  const addOns = ['เวย์โปรตีน', 'อกไก่พร้อมทาน', 'กรีกโยเกิร์ตไม่หวาน', 'ไข่ต้ม', 'นมจืดพร่องมันเนย'];
  let guard = 0;
  while (B.protein - pSum > 15 && guard++ < 3) {
    const f = foodByName(addOns[Math.floor(rnd() * addOns.length)]);
    plan.s.items.push({ foodId: f.id, qty: 1 }); plan.s.kcal += f.kcal; plan.s.p += f.p; plan.s.c += f.c; plan.s.f += f.f; pSum += f.p; kSum += f.kcal;
  }
  return { plan, kcal: kSum, p: pSum };
}

// ---------- Program generation ----------
const WEEK_TEMPLATES = {
  fbA: { name: 'Full Body A', slots: ['squat', 'push', 'pull', 'hinge', 'core', 'cond'] },
  fbB: { name: 'Full Body B', slots: ['lunge', 'pushv', 'pull2', 'hinge', 'core2', 'cond'] },
  fbC: { name: 'Full Body C', slots: ['squat', 'push', 'pull', 'lunge', 'core', 'cond'] },
  up: { name: 'ช่วงบน (Upper)', slots: ['push', 'pull', 'pushv', 'pull2', 'core'] },
  lo: { name: 'ช่วงล่าง (Lower)', slots: ['squat', 'hinge', 'lunge', 'core2', 'cond'] },
};
const SPLITS = { 1: ['fbA'], 2: ['fbA', 'fbB'], 3: ['fbA', 'fbB', 'fbC'], 4: ['up', 'lo', 'up', 'lo'], 5: ['up', 'lo', 'fbC', 'up', 'lo'], 6: ['up', 'lo', 'fbA', 'up', 'lo', 'fbB'], 7: ['up', 'lo', 'fbA', 'up', 'lo', 'fbB', 'fbC'] };
function exAllowed(id, p = S.profile) {
  const e = EXERCISES[id];
  if (!e) return false;
  if (e.equip !== 'none' && !(p.equip || []).includes(e.equip)) return false;
  if ((e.avoid || []).some((a) => (p.injuries || []).includes(a))) return false;
  return true;
}
function pickForPattern(pat, p = S.profile) {
  const lv = (id) => EXERCISES[id].level || 1;
  const cands = (PATTERNS[pat] || []).filter((id) => exAllowed(id, p));
  const fb = (FALLBACK[pat] || []).filter((id) => exAllowed(id, p));
  const prog = S.patternProgress[pat] || 0;
  let base = -1, best = 0;
  cands.forEach((id, i) => { if (lv(id) <= p.level && lv(id) > best) { base = i; best = lv(id); } });
  if (base === -1) {
    if (!cands.length || (fb.length && prog === 0)) return fb[0] || cands[0] || null;
    return cands[Math.min(Math.max(0, prog - 1), cands.length - 1)];
  }
  let idx = base;
  for (let k = 0; k < prog; k++) { const j = cands.findIndex((id, i) => i > idx && lv(id) > lv(cands[idx])); if (j < 0) break; idx = j; }
  return cands[idx];
}
function buildProgram() {
  const p = S.profile;
  const n = Math.max(1, Math.min(7, (p.days || []).length || 3));
  const keys = SPLITS[n];
  const maxSlots = p.minutes <= 25 ? 4 : p.minutes <= 40 ? 5 : 6;
  S.program = { days: keys.map((k) => ({ key: k, name: WEEK_TEMPLATES[k].name, slots: WEEK_TEMPLATES[k].slots.slice(0, maxSlots) })), built: todayKey() };
  if (S.nextDay >= S.program.days.length) S.nextDay = 0;
  save();
}
function rangeFor(id) {
  const e = EXERCISES[id];
  if (e.type === 'time') return e.group === 'cond' ? [20, 45, 5] : [20, 60, 5];
  return e.perSide ? [6, 12, 1] : [8, 15, 1];
}
function exTarget(id) {
  if (!S.exState[id]) { const [mn] = rangeFor(id); const e = EXERCISES[id]; S.exState[id] = { target: e.type === 'time' ? (e.group === 'cond' ? 30 : 30) : mn + 2 }; }
  return S.exState[id].target;
}
function setsFor(id) { const e = EXERCISES[id]; if (e.group === 'cond') return 3; return S.profile.level >= 2 ? 4 : 3; }
function buildSession(dayIdx) {
  const p = S.profile, day = S.program.days[dayIdx];
  const steps = [];
  const warm = ['march', 'arm_circles', exAllowed('bw_good_morning') ? 'bw_good_morning' : null, exAllowed('jumping_jack') ? 'jumping_jack' : 'march'].filter(Boolean);
  warm.forEach((id, i) => steps.push({ kind: 'warm', ex: id, secs: i === 0 ? 60 : 30 }));
  const used = new Set();
  for (const pat of day.slots) {
    let id = pickForPattern(pat);
    if (!id || used.has(id)) { const alt = (PATTERNS[pat] || []).concat(FALLBACK[pat] || []).find((x) => exAllowed(x) && !used.has(x)); id = alt || null; }
    if (!id) continue;
    used.add(id);
    const n = setsFor(id);
    for (let s = 1; s <= n; s++) steps.push({ kind: 'main', ex: id, set: s, sets: n, target: exTarget(id) });
  }
  const cool = ['hamstring_stretch', 'quad_stretch', 'child_pose', exAllowed('cobra') ? 'cobra' : null].filter(Boolean);
  cool.forEach((id) => steps.push({ kind: 'cool', ex: id, secs: 30 }));
  return { dayIdx, name: day.name, steps };
}
function todayPlanned() {
  if (!S.program) return false;
  return (S.profile.days || []).includes(new Date().getDay());
}
const doneToday = () => S.history.some((h) => h.date === todayKey());

// ---------- Voice coach & sounds ----------
const Voice = {
  voice: null,
  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find((v) => v.name === S.settings.voiceName) || vs.find((v) => /th/i.test(v.lang) && /premium|enhanced/i.test(v.name)) || vs.find((v) => /^th/i.test(v.lang)) || null;
    };
    pick(); speechSynthesis.onvoiceschanged = pick;
  },
  list() { return ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter((v) => /^th/i.test(v.lang)) : []; },
  unlock() { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} Sound.ctx(); },
  say(text, interrupt = false) {
    if (!S.settings.voice || !('speechSynthesis' in window) || !text) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH'; if (this.voice) u.voice = this.voice;
    u.rate = S.settings.rate || 1; u.pitch = 1;
    speechSynthesis.speak(u);
  },
  busy() { return 'speechSynthesis' in window && speechSynthesis.speaking; },
};
const Sound = {
  _c: null,
  ctx() { if (!this._c) { try { this._c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this._c && this._c.state === 'suspended') this._c.resume(); return this._c; },
  beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!S.settings.beep) return;
    const c = this.ctx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq; o.type = 'sine'; g.gain.value = vol;
    o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  },
};

// ---------- UI shell ----------
let TAB = 'home', FOOD_DAY = todayKey();
const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  food: '<path d="M7 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v6M4 3v6a3 3 0 0 0 3 3M17 21V3c-2 0-4 2-4 6v5h4"/>',
  train: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
};
const icon = (k, sz = 24) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(html, opts = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${opts.full ? 'full' : ''}"><div class="grab"></div>${html}</div>`;
  m.classList.add('show');
  m.onclick = (e) => { if (e.target === m && !opts.locked) closeModal(); };
  return m.firstElementChild;
}
function closeModal() { const m = $('#modal'); m.classList.remove('show'); m.innerHTML = ''; }

function render() {
  if (!S.profile) { renderOnboarding(); return; }
  $('#app').innerHTML = `<main id="view" class="view"></main>
  <nav class="tabbar">${[['home', 'วันนี้'], ['food', 'อาหาร'], ['train', 'ออกกำลัง'], ['progress', 'ความคืบหน้า'], ['me', 'ฉัน']].map(([k, t]) => `<button data-tab="${k}" class="${TAB === k ? 'on' : ''}">${icon(k)}<span>${t}</span></button>`).join('')}</nav>`;
  $$('.tabbar button').forEach((b) => b.onclick = () => { TAB = b.dataset.tab; render(); window.scrollTo(0, 0); });
  ({ home: viewHome, food: viewFood, train: viewTrain, progress: viewProgress, me: viewMe })[TAB]();
}

// ---------- Rings & bars ----------
function ring(val, max, color, size = 132, label = '', sub = '') {
  const r = size / 2 - 10, c = 2 * Math.PI * r, pct = Math.min(1, max ? val / max : 0);
  const over = val > max;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(255,255,255,.08)" stroke-width="11" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${over ? '#ff6b6b' : color}" stroke-width="11" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
    <div class="ring-in"><b>${label}</b><small>${sub}</small></div></div>`;
}
const bar = (name, v, max, color, unit = 'g') => `<div class="mbar"><div class="mbar-top"><span>${name}</span><span>${r0(v)} / ${max}${unit}</span></div><div class="track"><i style="width:${Math.min(100, (v / max) * 100)}%;background:${color}"></i></div></div>`;

// ---------- HOME ----------
function viewHome() {
  const B = body(), key = todayKey(), T = dayTotals(key);
  const name = S.profile.name ? ` ${esc(S.profile.name)}` : '';
  const hr = new Date().getHours();
  const greet = hr < 11 ? 'อรุณสวัสดิ์' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const day = S.program.days[S.nextDay];
  const planned = todayPlanned(), done = doneToday();
  const water = S.water[key] || 0, wGlasses = B.water / 250;
  const streak = calcStreak();
  const lastW = S.weights.length ? S.weights[S.weights.length - 1] : null;
  const sug = adaptiveSuggestion();
  const burned = S.history.filter((h) => h.date === key).reduce((a, h) => a + (h.kcal || 0), 0);
  $('#view').innerHTML = `
  <header class="top"><div><small>${fmtDate(key)}</small><h1>${greet}${name}</h1></div><div class="streak" title="วันที่ออกกำลังกายต่อเนื่อง">🔥 ${streak}</div></header>
  <section class="card hero ${done ? 'done' : ''}">
    <div class="hero-l">
      <small>${done ? 'วันนี้ออกกำลังกายแล้ว ✓' : planned ? 'โปรแกรมวันนี้' : 'วันพัก (เริ่มได้ถ้าอยากทำ)'}</small>
      <h2>${esc(day.name)}</h2>
      <p>${day.slots.map((s) => { const id = pickForPattern(s); return id ? EXERCISES[id].name : ''; }).filter(Boolean).slice(0, 4).join(' • ')}</p>
      <button class="btn primary" id="startW">${done ? 'ทำเพิ่มอีกรอบ' : 'เริ่มออกกำลังกาย'}</button>
    </div>
    <canvas id="heroAnim" width="120" height="120"></canvas>
  </section>
  ${!planned && !done ? `<section class="card tip"><b>💡 วันพักก็สำคัญ</b><p>กล้ามเนื้อซ่อมแซมและโตในวันพัก วันนี้ลองเดินให้ได้ 8,000–10,000 ก้าว ช่วยเผาผลาญไขมันโดยไม่กระทบการฟื้นตัว</p></section>` : ''}
  ${sug ? `<section class="card tip warn"><b>🧠 โค้ชแนะนำ</b><p>${sug.text}</p>${sug.action ? `<button class="btn small" id="sugApply">${sug.action}</button>` : ''}<button class="btn small ghost" id="sugDismiss">ไว้ทีหลัง</button></section>` : ''}
  <section class="card">
    <div class="row between"><h3>แคลอรี่วันนี้</h3><button class="link" data-go="food">บันทึกอาหาร ›</button></div>
    <div class="cal">
      ${ring(T.kcal, B.kcal, '#7cf5c4', 132, r0(Math.max(0, B.kcal - T.kcal)), T.kcal > B.kcal ? 'เกินเป้า' : 'kcal คงเหลือ')}
      <div class="cal-r">
        ${bar('โปรตีน', T.p, B.protein, '#7cf5c4')}${bar('คาร์บ', T.c, B.carb, '#7aa7ff')}${bar('ไขมัน', T.f, B.fat, '#ffb547')}
        <small class="muted">กินแล้ว ${r0(T.kcal)} / ${B.kcal} kcal${burned ? ` • เผาผลาญจากออกกำลัง ~${r0(burned)}` : ''}</small>
      </div>
    </div>
  </section>
  <section class="card">
    <div class="row between"><h3>น้ำดื่ม</h3><small class="muted">${water * 250} / ${B.water} ml</small></div>
    <div class="glasses">${Array.from({ length: Math.max(wGlasses, water) }, (_, i) => `<button class="glass ${i < water ? 'on' : ''}" data-g="${i}">💧</button>`).join('')}</div>
  </section>
  <section class="card">
    <div class="row between"><h3>น้ำหนักวันนี้</h3><small class="muted">${lastW ? `ล่าสุด ${lastW.kg} kg (${fmtDate(lastW.date)})` : 'ชั่งตอนเช้าหลังเข้าห้องน้ำ'}</small></div>
    <div class="row gap"><input id="wIn" type="number" inputmode="decimal" step="0.1" placeholder="${lastW ? lastW.kg : S.profile.weight}" class="inp"><span>kg</span><button class="btn" id="wSave">บันทึก</button></div>
  </section>
  <section class="card stats3">
    <div><b>${B.kcal}</b><small>kcal/วัน</small></div><div><b>${B.protein}g</b><small>โปรตีน/วัน</small></div><div><b>${S.history.length}</b><small>ครั้งที่ฝึก</small></div>
  </section>`;
  $('#startW').onclick = () => startSession(S.nextDay);
  $$('[data-go]').forEach((b) => b.onclick = () => { TAB = b.dataset.go; render(); });
  $$('.glass').forEach((g) => g.onclick = () => { const i = +g.dataset.g; S.water[key] = (S.water[key] || 0) === i + 1 ? i : i + 1; save(); viewHome(); });
  $('#wSave').onclick = () => { const v = parseFloat($('#wIn').value); if (!(v > 25 && v < 300)) return toast('ใส่น้ำหนักให้ถูกต้อง'); logWeight(v); toast('บันทึกน้ำหนักแล้ว'); viewHome(); };
  if (sug) { $('#sugDismiss').onclick = () => { S.lastCheck = todayKey(); save(); viewHome(); }; if (sug.action) $('#sugApply').onclick = () => { sug.apply(); S.lastCheck = todayKey(); save(); toast('ปรับแผนแล้ว'); viewHome(); }; }
  startHeroAnim(pickForPattern(day.slots[0]) || 'squat');
}
let heroRaf;
function startHeroAnim(id) {
  cancelAnimationFrame(heroRaf);
  const c = $('#heroAnim'); if (!c) return;
  const ctx = c.getContext('2d'), t0 = performance.now();
  const dpr = window.devicePixelRatio || 1; c.width = 120 * dpr; c.height = 120 * dpr;
  const loop = (t) => { if (!document.body.contains(c)) return; drawDemo(ctx, EXERCISES[id].anim, (t - t0) / 1000, c.width, c.height, { noBg: false, bg: 'rgba(0,0,0,0)' }); heroRaf = requestAnimationFrame(loop); };
  heroRaf = requestAnimationFrame(loop);
}
function logWeight(kg) {
  const k = todayKey();
  S.weights = S.weights.filter((w) => w.date !== k); S.weights.push({ date: k, kg }); S.weights.sort((a, b) => a.date.localeCompare(b.date));
  S.profile.weight = kg; save();
}
function calcStreak() {
  const days = new Set(S.history.map((h) => h.date));
  let n = 0, k = todayKey();
  if (!days.has(k)) k = addDays(k, -1);
  // count consecutive weeks rule is complex; simple: consecutive scheduled days not missed
  for (let i = 0; i < 400; i++) {
    const d = new Date(k + 'T12:00:00').getDay();
    if (days.has(k)) n++;
    else if ((S.profile.days || []).includes(d)) break;
    k = addDays(k, -1);
    if (k < (S.profile.created || '2000')) break;
  }
  return n;
}
function avgWeight(fromKey, toKey) {
  const ws = S.weights.filter((w) => w.date >= fromKey && w.date <= toKey);
  return ws.length >= 2 ? ws.reduce((a, w) => a + w.kg, 0) / ws.length : null;
}
function adaptiveSuggestion() {
  if (S.lastCheck && S.lastCheck > addDays(todayKey(), -7)) return null;
  const t = todayKey();
  const first = S.weights[0];
  if (!first || first.date > addDays(t, -14)) return null;
  const now = avgWeight(addDays(t, -6), t), prev = avgWeight(addDays(t, -20), addDays(t, -14));
  if (!now || !prev) return null;
  const ratePerWk = ((prev - now) / prev) * 100 / 2; // % per week, positive = losing
  if (ratePerWk < 0.2) {
    return { text: `2 สัปดาห์ที่ผ่านมาน้ำหนักเฉลี่ยแทบไม่ลง (${prev.toFixed(1)} → ${now.toFixed(1)} kg) ถ้ารอบเอวไม่ลดด้วย แนะนำลดแคลอรี่ลง 150 kcal/วัน และเดินเพิ่ม (ถ้ารอบเอวลดแต่น้ำหนักนิ่ง แปลว่ากำลังสร้างกล้าม ไม่ต้องปรับ)`, action: 'ลด 150 kcal', apply: () => { S.nutrition.kcalAdjust = (S.nutrition.kcalAdjust || 0) - 150; } };
  }
  if (ratePerWk > 1.1) {
    return { text: `น้ำหนักลงเร็วเกินไป (~${ratePerWk.toFixed(1)}%/สัปดาห์) เสี่ยงเสียกล้ามเนื้อ แนะนำเพิ่มแคลอรี่ 150 kcal/วัน`, action: 'เพิ่ม 150 kcal', apply: () => { S.nutrition.kcalAdjust = (S.nutrition.kcalAdjust || 0) + 150; } };
  }
  return null;
}

// ---------- FOOD ----------
function viewFood() {
  const B = body(), key = FOOD_DAY, T = dayTotals(key), log = S.foodLog[key] || [];
  const mp = mealPlan(key);
  $('#view').innerHTML = `
  <header class="top"><h1>อาหาร</h1></header>
  <div class="daynav"><button id="dPrev">‹</button><b>${key === todayKey() ? 'วันนี้ · ' : ''}${fmtDate(key)}</b><button id="dNext" ${key >= todayKey() ? 'disabled' : ''}>›</button></div>
  <section class="card">
    <div class="cal">
      ${ring(T.kcal, B.kcal, '#ffb547', 120, r0(T.kcal), `/ ${B.kcal} kcal`)}
      <div class="cal-r">${bar('โปรตีน', T.p, B.protein, '#7cf5c4')}${bar('คาร์บ', T.c, B.carb, '#7aa7ff')}${bar('ไขมัน', T.f, B.fat, '#ffb547')}</div>
    </div>
  </section>
  ${MEALS.map((m) => {
    const items = log.map((it, i) => ({ it, i })).filter(({ it }) => it.meal === m.k);
    const kc = items.reduce((a, { it }) => a + (foodById(it.foodId)?.kcal || 0) * it.qty, 0);
    return `<section class="card meal"><div class="row between"><h3>${m.t}</h3><small class="muted">${r0(kc)} kcal</small></div>
      ${items.map(({ it, i }) => { const f = foodById(it.foodId); if (!f) return ''; return `<div class="fitem"><div><b>${esc(f.name)}</b><small>${it.qty !== 1 ? it.qty + ' × ' : ''}${esc(f.serving)} · P ${r0(f.p * it.qty)}g</small></div><span>${r0(f.kcal * it.qty)}</span><button class="x" data-del="${i}">✕</button></div>`; }).join('')}
      <button class="btn ghost add" data-add="${m.k}">+ เพิ่มอาหาร</button></section>`;
  }).join('')}
  <section class="card plan">
    <div class="row between"><h3>🍱 แผนอาหารแนะนำ</h3><button class="link" id="reroll">สุ่มใหม่ ↻</button></div>
    <p class="muted">คำนวณจากเป้า ${B.kcal} kcal และโปรตีน ${B.protein}g · แผนนี้ได้ ~${r0(mp.kcal)} kcal, P ${r0(mp.p)}g</p>
    ${MEALS.map((m) => { const pl = mp.plan[m.k]; return `<div class="pmeal"><div><small>${m.t} · ${r0(pl.kcal)} kcal</small><b>${pl.items.map((it) => { const f = foodById(it.foodId); return (it.qty !== 1 ? it.qty + '× ' : '') + f.name; }).join(' + ')}</b></div><button class="btn small" data-plan="${m.k}">กินแล้ว</button></div>`; }).join('')}
  </section>
  <section class="card tip"><b>เคล็ดลับลดไขมัน + เพิ่มกล้าม</b><p>• กินโปรตีนให้ถึงเป้าทุกวัน (สำคัญที่สุด)<br>• เลือกเมนูต้ม/ย่าง/นึ่ง แทนทอด ลดน้ำหวาน ชานม<br>• ข้าวมื้อละ 1 ทัพพีพอ เพิ่มผักให้อิ่ม<br>• นอน 7–8 ชม. ช่วยคุมความหิวและสร้างกล้าม</p></section>`;
  $('#dPrev').onclick = () => { FOOD_DAY = addDays(FOOD_DAY, -1); viewFood(); };
  $('#dNext').onclick = () => { if (FOOD_DAY < todayKey()) { FOOD_DAY = addDays(FOOD_DAY, 1); viewFood(); } };
  $$('[data-del]').forEach((b) => b.onclick = () => { log.splice(+b.dataset.del, 1); S.foodLog[key] = log; save(); viewFood(); });
  $$('[data-add]').forEach((b) => b.onclick = () => openFoodPicker(b.dataset.add));
  $('#reroll').onclick = () => { S.mealSeed[key] = (S.mealSeed[key] || 0) + 1; save(); viewFood(); };
  $$('[data-plan]').forEach((b) => b.onclick = () => { const m = b.dataset.plan; S.foodLog[key] = (S.foodLog[key] || []).concat(mp.plan[m].items.map((it) => ({ foodId: it.foodId, qty: it.qty, meal: m }))); save(); toast('บันทึกมื้อแล้ว'); viewFood(); });
}
function openFoodPicker(meal) {
  let q = '', cat = 'all';
  const sh = modal(`<h3>เพิ่มอาหาร · ${MEALS.find((m) => m.k === meal).t}</h3>
    <input id="fq" class="inp wide" placeholder="ค้นหา เช่น กะเพรา, ไข่, นม" autocomplete="off">
    <div class="chips" id="fcat">${[['all', 'ทั้งหมด'], ['m', 'จานหลัก'], ['p', 'โปรตีนสูง'], ['f', 'ผัก/ผลไม้'], ['d', 'เครื่องดื่ม'], ['my', 'ของฉัน']].map(([k, t]) => `<button data-c="${k}" class="chip ${k === 'all' ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="flist" class="flist"></div>
    <button class="btn ghost wide" id="fCustom">+ สร้างอาหารเอง</button>`, { full: true });
  const list = () => {
    const ql = q.trim().toLowerCase();
    const arr = allFoods().filter((f) => (!ql || f.name.toLowerCase().includes(ql)) && (cat === 'all' || (cat === 'my' ? f.id.startsWith('c') : f.tags.includes(cat))));
    $('#flist').innerHTML = arr.map((f) => `<button class="frow" data-f="${f.id}"><div><b>${esc(f.name)}</b><small>${esc(f.serving)} · P ${f.p} · C ${f.c} · F ${f.f}</small></div><span>${f.kcal}<small>kcal</small></span></button>`).join('') || '<p class="muted center">ไม่พบ ลองสร้างอาหารเอง</p>';
    $$('[data-f]', sh).forEach((b) => b.onclick = () => qtyPicker(b.dataset.f, meal));
  };
  $('#fq').oninput = (e) => { q = e.target.value; list(); };
  $$('#fcat .chip').forEach((c) => c.onclick = () => { cat = c.dataset.c; $$('#fcat .chip').forEach((x) => x.classList.toggle('on', x === c)); list(); });
  $('#fCustom').onclick = () => customFoodForm(meal);
  list();
}
function qtyPicker(fid, meal) {
  const f = foodById(fid); let qty = 1;
  const draw = () => { $('#qv').textContent = qty; $('#qk').textContent = `${r0(f.kcal * qty)} kcal · โปรตีน ${r0(f.p * qty)}g`; };
  modal(`<h3>${esc(f.name)}</h3><p class="muted">${esc(f.serving)}</p>
    <div class="stepper"><button id="qm">−</button><b id="qv">1</b><button id="qp">+</button></div>
    <p class="center" id="qk"></p><button class="btn primary wide" id="qok">เพิ่ม</button>`);
  $('#qm').onclick = () => { qty = Math.max(0.5, qty - 0.5); draw(); };
  $('#qp').onclick = () => { qty += 0.5; draw(); };
  $('#qok').onclick = () => { (S.foodLog[FOOD_DAY] = S.foodLog[FOOD_DAY] || []).push({ foodId: fid, qty, meal }); save(); closeModal(); toast(`เพิ่ม ${f.name} แล้ว`); if (TAB === 'food') viewFood(); };
  draw();
}
function customFoodForm(meal) {
  modal(`<h3>สร้างอาหารเอง</h3>
    <label>ชื่อ<input id="cn" class="inp wide" placeholder="เช่น ข้าวกล่องร้านประจำ"></label>
    <label>ปริมาณ<input id="cs" class="inp wide" placeholder="1 กล่อง"></label>
    <div class="grid2"><label>แคลอรี่ (kcal)<input id="ck" type="number" inputmode="decimal" class="inp"></label><label>โปรตีน (g)<input id="cp" type="number" inputmode="decimal" class="inp"></label>
    <label>คาร์บ (g)<input id="cc" type="number" inputmode="decimal" class="inp"></label><label>ไขมัน (g)<input id="cf" type="number" inputmode="decimal" class="inp"></label></div>
    <p class="muted">ดูได้จากฉลากโภชนาการหลังซอง</p>
    <button class="btn primary wide" id="cok">บันทึกและเพิ่ม</button>`);
  $('#cok').onclick = () => {
    const n = $('#cn').value.trim(), k = +$('#ck').value;
    if (!n || !(k >= 0)) return toast('ใส่ชื่อและแคลอรี่');
    const f = { id: 'c' + Date.now(), name: n, serving: $('#cs').value.trim() || '1 ที่', kcal: k, p: +$('#cp').value || 0, c: +$('#cc').value || 0, f: +$('#cf').value || 0, tags: 's' };
    S.customFoods.push(f); (S.foodLog[FOOD_DAY] = S.foodLog[FOOD_DAY] || []).push({ foodId: f.id, qty: 1, meal }); save(); closeModal(); toast('บันทึกแล้ว'); viewFood();
  };
}

// ---------- TRAIN ----------
function viewTrain() {
  const days = S.program.days;
  $('#view').innerHTML = `
  <header class="top"><h1>ออกกำลังกาย</h1></header>
  <section class="card"><h3>ตารางสัปดาห์นี้</h3>
    <div class="week">${[1, 2, 3, 4, 5, 6, 0].map((d) => { const on = (S.profile.days || []).includes(d); const isT = new Date().getDay() === d; return `<div class="wd ${on ? 'on' : ''} ${isT ? 'today' : ''}"><small>${TH_DAYS[d]}</small><i>${on ? '💪' : '·'}</i></div>`; }).join('')}</div>
    <p class="muted">ฝึก ${days.length} วัน/สัปดาห์ · ครั้งละ ~${S.profile.minutes} นาที · วันที่ไม่ฝึกให้เดิน 8,000+ ก้าว</p>
  </section>
  ${days.map((d, i) => `<section class="card day ${i === S.nextDay ? 'next' : ''}">
    <div class="row between"><div><small>${i === S.nextDay ? 'ครั้งถัดไป' : 'วันที่ ' + (i + 1)}</small><h3>${esc(d.name)}</h3></div><button class="btn small ${i === S.nextDay ? 'primary' : ''}" data-start="${i}">เริ่ม</button></div>
    <div class="exlist">${d.slots.map((s) => { const id = pickForPattern(s); if (!id) return ''; const e = EXERCISES[id]; const tg = exTarget(id); return `<button class="exrow" data-ex="${id}"><canvas data-anim="${e.anim}" width="56" height="56"></canvas><div><b>${e.name}</b><small>${setsFor(id)} เซ็ต × ${tg}${e.type === 'time' ? ' วินาที' : ' ครั้ง'}${e.perSide ? '/ข้าง' : ''} ${e.check ? '· 📷 ตรวจท่าได้' : ''}</small></div></button>`; }).join('')}</div>
  </section>`).join('')}
  <section class="card"><h3>คลังท่าทั้งหมด</h3><div class="exlist">${Object.entries(EXERCISES).filter(([id]) => exAllowed(id)).map(([id, e]) => `<button class="exrow" data-ex="${id}"><canvas data-anim="${e.anim}" width="56" height="56"></canvas><div><b>${e.name}</b><small>${e.muscles}${e.check ? ' · 📷' : ''}</small></div></button>`).join('')}</div></section>
  <section class="card"><h3>ประวัติล่าสุด</h3>${S.history.slice(-8).reverse().map((h) => `<div class="hist"><b>${esc(h.name)}</b><small>${fmtDate(h.date)} · ${h.min} นาที · ~${h.kcal} kcal${h.form != null ? ` · ฟอร์มดี ${h.form}%` : ''}</small></div>`).join('') || '<p class="muted">ยังไม่มี เริ่มครั้งแรกเลย!</p>'}</section>`;
  $$('[data-start]').forEach((b) => b.onclick = () => startSession(+b.dataset.start));
  $$('[data-ex]').forEach((b) => b.onclick = () => exerciseInfo(b.dataset.ex));
  animateThumbs();
}
let thumbRaf;
function animateThumbs() {
  cancelAnimationFrame(thumbRaf);
  const cs = $$('canvas[data-anim]'); const dpr = window.devicePixelRatio || 1;
  cs.forEach((c) => { c.width = 56 * dpr; c.height = 56 * dpr; });
  const t0 = performance.now();
  const loop = (t) => { if (!cs.length || !document.body.contains(cs[0])) return; cs.forEach((c) => drawDemo(c.getContext('2d'), c.dataset.anim, (t - t0) / 1000, c.width, c.height, { bg: '#1b2130' })); thumbRaf = requestAnimationFrame(loop); };
  thumbRaf = requestAnimationFrame(loop);
}
function exerciseInfo(id) {
  const e = EXERCISES[id];
  modal(`<canvas id="exBig" class="demo-big"></canvas><h3>${e.name}</h3><p class="muted">${e.muscles}</p>
    <ol class="how">${e.how.map((h) => `<li>${h}</li>`).join('')}</ol>
    ${e.check ? `<p class="pill">📷 ตรวจท่าด้วยกล้องได้ · วางมือถือ${e.view === 'side' ? 'ด้านข้างลำตัว' : 'ด้านหน้า'} ห่าง 2–3 เมตร</p>` : ''}
    <button class="btn wide" id="exSay">🔊 ฟังคำแนะนำ</button>`);
  const c = $('#exBig'); const dpr = window.devicePixelRatio || 1; c.width = 300 * dpr; c.height = 220 * dpr;
  const t0 = performance.now();
  const loop = (t) => { if (!document.body.contains(c)) return; drawDemo(c.getContext('2d'), e.anim, (t - t0) / 1000, c.width, c.height); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  $('#exSay').onclick = () => { Voice.unlock(); Voice.say(e.name + '. ' + e.how.join('. '), true); };
}

// ---------- WORKOUT PLAYER ----------
let SES = null;
let trainer = null;
async function startSession(dayIdx) {
  Voice.unlock();
  const sess = buildSession(dayIdx);
  SES = { ...sess, i: 0, t0: Date.now(), results: {}, cam: false, phase: 'intro', wake: null, formGood: 0, formTotal: 0, events: [] };
  try { if ('wakeLock' in navigator) SES.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  $('#player').classList.add('show');
  document.body.classList.add('noscroll');
  Voice.say(`เริ่ม ${sess.name} เริ่มจากวอร์มอัพก่อนนะ`, true);
  stepIntro();
}
function endSessionUI() {
  clearInterval(SES && SES.timer);
  cancelAnimationFrame(SES && SES.demoRaf);
  if (trainer) { trainer.stop(); }
  if (SES && SES.wake) try { SES.wake.release(); } catch (e) {}
  $('#player').classList.remove('show'); $('#player').innerHTML = '';
  document.body.classList.remove('noscroll');
  SES = null; render();
}
const curStep = () => SES.steps[SES.i];
function progressPct() { return Math.round((SES.i / SES.steps.length) * 100); }
function playerFrame(inner, opts = {}) {
  const st = curStep();
  $('#player').innerHTML = `
  <div class="ptop"><button class="pclose" id="pClose">✕</button><div class="pprog"><i style="width:${progressPct()}%"></i></div><span>${SES.i + 1}/${SES.steps.length}</span></div>
  <div class="pbody ${opts.cam ? 'cam' : ''}">${inner}</div>`;
  $('#pClose').onclick = () => confirmBox('จบการออกกำลังกายตอนนี้?', 'ข้อมูลที่ทำไปแล้วจะถูกบันทึก', 'จบเลย', () => finishSession(true));
}
function confirmBox(title, msg, okText, ok) {
  modal(`<h3>${title}</h3><p class="muted">${msg}</p><div class="row gap"><button class="btn wide" id="cbNo">ยกเลิก</button><button class="btn primary wide" id="cbOk">${okText}</button></div>`);
  $('#cbNo').onclick = closeModal; $('#cbOk').onclick = () => { closeModal(); ok(); };
}
function runDemo(canvasSel, anim) {
  cancelAnimationFrame(SES.demoRaf);
  const c = $(canvasSel); if (!c) return;
  const dpr = window.devicePixelRatio || 1; const r = c.getBoundingClientRect();
  c.width = Math.max(100, r.width) * dpr; c.height = Math.max(100, r.height) * dpr;
  const t0 = performance.now();
  const loop = (t) => { if (!SES || !document.body.contains(c)) return; drawDemo(c.getContext('2d'), anim, (t - t0) / 1000, c.width, c.height, { bg: c.dataset.bg || '#151a24' }); SES.demoRaf = requestAnimationFrame(loop); };
  SES.demoRaf = requestAnimationFrame(loop);
}
const unitOf = (e) => e.type === 'time' ? 'วินาที' : 'ครั้ง';
function stepIntro() {
  const st = curStep(); if (!st) return finishSession();
  const e = EXERCISES[st.ex];
  const prev = SES.steps[SES.i - 1];
  const sameAsPrev = prev && prev.ex === st.ex;
  if (st.kind !== 'main' || sameAsPrev) return stepGo(sameAsPrev ? SES.lastMode : 'manual');
  const tgt = st.target;
  playerFrame(`
    <div class="pkind">ท่าที่ ${new Set(SES.steps.slice(0, SES.i + 1).filter((s) => s.kind === 'main').map((s) => s.ex)).size} · ${st.sets} เซ็ต</div>
    <h2>${e.name}</h2>
    <canvas id="pDemo" class="demo-big"></canvas>
    <div class="target">${tgt} <small>${unitOf(e)}${e.perSide ? ' / ข้าง' : ''} × ${st.sets} เซ็ต</small></div>
    <ol class="how">${e.how.map((h) => `<li>${h}</li>`).join('')}</ol>
    ${e.check ? `<p class="pill">📷 วางมือถือ${e.view === 'side' ? '<b>ด้านข้าง</b>ลำตัว' : '<b>ด้านหน้า</b>'} ห่าง 2–3 เมตร ให้กล้องเห็นตั้งแต่หัวจรดเท้า</p>` : ''}
    <div class="pbtns">
      ${e.check ? `<button class="btn primary big" id="goCam">📷 เริ่มพร้อมโค้ชกล้อง</button>` : ''}
      <button class="btn ${e.check ? '' : 'primary'} big" id="goMan">${e.check ? 'เริ่มแบบไม่ใช้กล้อง' : 'เริ่ม'}</button>
      <button class="link" id="skip">ข้ามท่านี้</button>
    </div>`);
  runDemo('#pDemo', e.anim);
  Voice.say(`ท่าต่อไป ${e.name} ${st.sets} เซ็ต เซ็ตละ ${tgt} ${unitOf(e)}${e.perSide ? 'ต่อข้าง' : ''}. ${e.how[0]}`, true);
  if (e.check) $('#goCam').onclick = () => stepGo('cam');
  $('#goMan').onclick = () => stepGo('manual');
  $('#skip').onclick = () => { while (curStep() && curStep().ex === st.ex) SES.i++; stepIntro(); };
}
async function stepGo(mode) {
  const st = curStep(); if (!st) return finishSession();
  const e = EXERCISES[st.ex];
  SES.lastMode = mode;
  if (st.kind !== 'main') return timedStep(st, e, false);
  if (mode === 'cam' && e.check) {
    const ok = await ensureCamera();
    if (!ok) mode = 'manual';
  }
  if (e.type === 'time') return timedStep(st, e, mode === 'cam');
  return repStep(st, e, mode === 'cam');
}
async function ensureCamera() {
  if (trainer && trainer.stream && trainer.landmarker) return true;
  playerFrame(`<div class="loading"><div class="spin"></div><p>กำลังเปิดกล้องและโหลด AI ตรวจท่า…<br><small class="muted">ครั้งแรกอาจใช้เวลา 5–20 วินาที (ต้องต่อเน็ต)</small></p></div>`);
  try {
    if (!trainer) trainer = new CameraTrainer(document.createElement('video'), document.createElement('canvas'));
    await trainer.start(S.settings.facing || 'user');
    return true;
  } catch (err) {
    console.error(err);
    toast(String(err && err.name) === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตใช้กล้อง: ไปที่ ตั้งค่า > Safari > กล้อง' : 'เปิดกล้อง/โหลด AI ไม่สำเร็จ ใช้โหมดนับเองแทน', 4000);
    if (trainer) trainer.stopStream();
    return false;
  }
}
function camLayout(st, e, counterHtml) {
  return `
  <div class="camwrap" id="camWrap"></div>
  <div class="hud">
    <div class="hud-top"><div><small>${esc(e.name)} · เซ็ต ${st.set}/${st.sets}</small><div class="hud-count" id="hudCount">${counterHtml}</div></div><canvas id="pip" class="pip" data-bg="rgba(10,14,22,.7)"></canvas></div>
    <div class="fb" id="fb">เข้าตำแหน่งให้กล้องเห็นทั้งตัว</div>
    <div class="hud-bot"><button class="btn" id="flip">🔄 สลับกล้อง</button><button class="btn primary" id="doneSet">จบเซ็ต</button></div>
  </div>`;
}
function mountCamera() {
  const w = $('#camWrap'); if (!w || !trainer) return;
  trainer.video.className = 'camvid'; trainer.canvas.className = 'camcv';
  w.appendChild(trainer.video); w.appendChild(trainer.canvas);
  trainer.video.play().catch(() => {});
  $('#flip').onclick = async () => { trainer.pause(); S.settings.facing = trainer.facing === 'user' ? 'environment' : 'user'; save(); try { await trainer.start(S.settings.facing); } catch (e) { toast('สลับกล้องไม่สำเร็จ'); } mountCamera(); trainer.run(); };
}
function repStep(st, e, cam) {
  const target = st.target;
  let reps = 0, lastCue = 0, lastSpoken = '', repIssuesAll = [];
  const finish = () => { if (trainer) { trainer.pause(); trainer.onEvent = trainer.onFrame = null; } afterSet(st, e, reps, repIssuesAll, cam); };
  const counter = () => `${reps}<small>/${target}</small>`;
  if (cam) {
    playerFrame(camLayout(st, e, counter()), { cam: true });
    mountCamera(); runDemo('#pip', e.anim);
    trainer.setExercise(e.check);
    let lastLive = 0, seen = false;
    trainer.onFrame = (f) => {
      if (!f.person) { if (performance.now() - lastLive > 1500) setFb('ไม่เห็นตัว · ถอยออกไปให้กล้องเห็นทั้งตัว', 'warn'); return; }
      if (!seen) { seen = true; Voice.say('เห็นตัวแล้ว เริ่มได้เลย', true); setFb('พร้อม! เริ่มได้เลย', 'ok'); }
    };
    trainer.onEvent = (ev, an) => {
      const now = performance.now(); lastLive = now;
      if (ev.rep) {
        reps = an.reps;
        $('#hudCount').innerHTML = counter();
        Sound.beep(ev.repIssues.length ? 520 : 990, 0.09);
        repIssuesAll.push(ev.repIssues);
        let say = String(reps);
        if (ev.repIssues.length) { const m = MSG[ev.repIssues[0]]; setFb(m, 'bad'); if (now - lastCue > 3500 || m !== lastSpoken) { say += ' ' + m; lastCue = now; lastSpoken = m; } }
        else { setFb(PRAISE[reps % PRAISE.length] + ' 👍', 'ok'); if (reps % 4 === 0) say += ' ' + PRAISE[reps % PRAISE.length]; }
        Voice.say(say, true);
        if (reps >= target) { Voice.say('ครบแล้ว เยี่ยมมาก', false); setTimeout(finish, 900); trainer.onEvent = null; }
      } else if (ev.live.length) {
        const m = MSG[ev.live[0]];
        setFb(m, ev.live[0] === 'visibility' || ev.live[0] === 'position' ? 'warn' : 'bad');
        if (now - lastCue > 4500 && ev.live[0] !== 'position') { Voice.say(m, false); lastCue = now; lastSpoken = m; }
      }
    };
    trainer.run();
    $('#doneSet').onclick = finish;
    Voice.say(`เซ็ตที่ ${st.set} พร้อมแล้วเริ่มได้เลย`, true);
  } else {
    playerFrame(`
      <div class="pkind">${e.name} · เซ็ต ${st.set}/${st.sets}</div>
      <canvas id="pDemo" class="demo-mid"></canvas>
      <button class="tapcount" id="tap"><b id="tapN">0</b><small>/ ${target} ${e.perSide ? 'ต่อข้าง' : ''}<br>แตะทุกครั้งที่ทำได้ 1 ครั้ง</small></button>
      <div class="row gap"><button class="btn wide" id="minus">−1</button><button class="btn wide" id="allDone">ทำครบ ${target}</button></div>
      <button class="btn primary big" id="doneSet">จบเซ็ต</button>`);
    runDemo('#pDemo', e.anim);
    Voice.say(`เซ็ตที่ ${st.set} เริ่ม`, true);
    const upd = () => { $('#tapN').textContent = reps; };
    $('#tap').onclick = () => { reps++; upd(); Sound.beep(990, 0.07); Voice.say(String(reps), true); if (reps === target) Voice.say('ครบแล้ว เยี่ยม', false); };
    $('#minus').onclick = () => { reps = Math.max(0, reps - 1); upd(); };
    $('#allDone').onclick = () => { reps = target; finish(); };
    $('#doneSet').onclick = finish;
  }
}
function setFb(msg, kind) { const f = $('#fb'); if (!f) return; f.textContent = msg; f.className = 'fb ' + (kind || ''); }
function timedStep(st, e, cam) {
  const total = st.kind === 'main' ? st.target : st.secs;
  let left = total, paused = false, lastCue = 0, half = false;
  const isMain = st.kind === 'main';
  const finish = () => {
    clearInterval(SES.timer);
    if (trainer) { trainer.pause(); trainer.onEvent = trainer.onFrame = null; }
    if (isMain) {
      const an = trainer && trainer.analyzer;
      const formPct = cam && an && an.holdTotal > 3 ? Math.round((an.holdGood / an.holdTotal) * 100) : null;
      afterSet(st, e, total - left, [], cam, formPct);
    } else { SES.i++; Sound.beep(660, 0.15); stepIntro(); }
  };
  const label = st.kind === 'warm' ? 'วอร์มอัพ' : st.kind === 'cool' ? 'คูลดาวน์/ยืดเหยียด' : `เซ็ต ${st.set}/${st.sets}`;
  if (cam) {
    playerFrame(camLayout(st, e, `<span id="tLeft">${left}</span><small>วิ</small>`), { cam: true });
    mountCamera(); runDemo('#pip', e.anim);
    trainer.setExercise(e.check);
    trainer.onEvent = (ev) => {
      const now = performance.now();
      if (ev.live.length) { const m = MSG[ev.live[0]]; setFb(m, 'bad'); if (now - lastCue > 4000) { Voice.say(m, false); lastCue = now; } }
    };
    trainer.onFrame = (f) => { const an = trainer.analyzer; if (f.person && an && !an.liveIssues.length) setFb('ท่าถูกต้อง ค้างไว้ 👍', 'ok'); };
    trainer.run();
  } else {
    playerFrame(`
      <div class="pkind">${label}</div><h2>${e.name}</h2>
      <canvas id="pDemo" class="demo-big"></canvas>
      <div class="timer"><b id="tLeft">${left}</b><small>วินาที</small></div>
      <p class="muted center">${e.how[0]}</p>
      <div class="row gap"><button class="btn wide" id="pause">⏸ หยุด</button><button class="btn primary wide" id="doneSet">${isMain ? 'จบเซ็ต' : 'ข้าม ›'}</button></div>`);
    runDemo('#pDemo', e.anim);
    $('#pause').onclick = () => { paused = !paused; $('#pause').textContent = paused ? '▶ ต่อ' : '⏸ หยุด'; };
  }
  Voice.say(`${st.kind === 'main' ? '' : label + ' '}${e.name} ${total} วินาที เริ่ม`, true);
  $('#doneSet').onclick = finish;
  clearInterval(SES.timer);
  SES.timer = setInterval(() => {
    if (paused) return;
    left--;
    const el = $('#tLeft'); if (el) el.textContent = Math.max(0, left);
    if (!half && left === Math.floor(total / 2) && total >= 30) { half = true; Voice.say(e.perSide || st.ex === 'quad_stretch' ? 'เปลี่ยนข้าง' : 'ครึ่งทางแล้ว ' + (e.cues[0] || ''), false); }
    if (left === 10 && total > 20) Voice.say('อีก 10 วินาที', false);
    if (left <= 3 && left > 0) { Sound.beep(880, 0.1); }
    if (left <= 0) { Sound.beep(1320, 0.25); Voice.say('หมดเวลา', true); finish(); }
  }, 1000);
}
function afterSet(st, e, reps, issues, cam, formPct) {
  SES.results[st.ex] = SES.results[st.ex] || { sets: [] };
  const flat = issues.flat();
  const goodReps = issues.filter((x) => !x.length).length;
  if (cam && issues.length) { SES.formGood += goodReps; SES.formTotal += issues.length; }
  if (formPct != null) { SES.formGood += formPct; SES.formTotal += 100; }
  const topIssue = Object.entries(flat.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1])[0];
  playerFrame(`
    <div class="pkind">${e.name} · เซ็ต ${st.set}/${st.sets} เสร็จ</div>
    <div class="target">${reps} <small>${unitOf(e)}${cam && issues.length ? ` · ท่าถูก ${goodReps}/${issues.length}` : ''}${formPct != null ? ` · ฟอร์มดี ${formPct}%` : ''}</small></div>
    ${topIssue ? `<p class="pill bad">จุดที่ควรแก้: ${MSG[topIssue[0]]}</p>` : cam ? '<p class="pill">ฟอร์มดีมาก 👏</p>' : ''}
    <h3 class="center">เซ็ตนี้รู้สึกอย่างไร?</h3>
    <div class="rpe">
      <button data-r="1">😌<b>ง่ายไป</b><small>ทำต่อได้อีกเยอะ</small></button>
      <button data-r="2">💪<b>พอดี</b><small>เหลือแรงอีก 2–3 ครั้ง</small></button>
      <button data-r="3">🥵<b>หนัก</b><small>เกือบหมดแรง</small></button>
      <button data-r="4">😵<b>ไม่ไหว</b><small>ทำไม่ครบ/เจ็บ</small></button>
    </div>
    ${!cam ? `<div class="row gap center"><span>จำนวนที่ทำได้</span><div class="stepper sm"><button id="rm">−</button><b id="rv">${reps}</b><button id="rp">+</button></div></div>` : ''}`);
  Voice.say(topIssue ? `เซ็ตนี้ ${reps} ${unitOf(e)} ครั้งหน้า ${MSG[topIssue[0]]}` : `เยี่ยมมาก ${reps} ${unitOf(e)} เซ็ตนี้เหนื่อยแค่ไหน`, true);
  if (!cam) { const step = e.type === 'time' ? 5 : 1; $('#rm').onclick = () => { reps = Math.max(0, reps - step); $('#rv').textContent = reps; }; $('#rp').onclick = () => { reps += step; $('#rv').textContent = reps; }; }
  $$('.rpe button').forEach((b) => b.onclick = () => {
    const rpe = +b.dataset.r;
    SES.results[st.ex].sets.push({ reps, target: st.target, rpe });
    if (rpe === 4) Voice.say('ไม่เป็นไร ถ้ารู้สึกเจ็บให้หยุดท่านี้นะ', true);
    SES.i++;
    if (!curStep()) return stepIntro();
    restStep();
  });
}
function restStep() {
  const nxt = curStep();
  if (!nxt || nxt.kind !== 'main') { Voice.say('ดีมาก ไปยืดเหยียดกัน', true); return stepIntro(); }
  const e = EXERCISES[nxt.ex];
  let left = e.group === 'cond' ? 30 : S.settings.restSec;
  playerFrame(`
    <div class="pkind">พัก</div>
    <div class="timer big"><b id="rLeft">${left}</b><small>วินาที</small></div>
    <div class="nextup"><canvas id="pDemo"></canvas><div><small>ถัดไป · เซ็ต ${nxt.set}/${nxt.sets}</small><b>${e.name}</b><small>${nxt.target} ${unitOf(e)}${e.perSide ? '/ข้าง' : ''}</small></div></div>
    <p class="muted center">💧 จิบน้ำ หายใจลึก ๆ</p>
    <div class="row gap"><button class="btn wide" id="plus">+15 วิ</button><button class="btn primary wide" id="skipRest">ข้ามพัก ›</button></div>`);
  runDemo('#pDemo', e.anim);
  Voice.say(`พัก ${left} วินาที ต่อไป ${e.name}${nxt.set > 1 ? ' เซ็ตที่ ' + nxt.set : ''}`, false);
  const go = () => { clearInterval(SES.timer); stepIntro(); };
  $('#plus').onclick = () => { left += 15; $('#rLeft').textContent = left; };
  $('#skipRest').onclick = go;
  clearInterval(SES.timer);
  SES.timer = setInterval(() => {
    left--; const el = $('#rLeft'); if (el) el.textContent = Math.max(0, left);
    if (left === 10) Voice.say('อีก 10 วินาที เตรียมตัว', false);
    if (left <= 3 && left > 0) Sound.beep(880, 0.1);
    if (left <= 0) { Sound.beep(1320, 0.25); go(); }
  }, 1000);
}
function finishSession(early) {
  clearInterval(SES.timer); cancelAnimationFrame(SES.demoRaf);
  if (trainer) trainer.pause();
  const min = Math.max(1, Math.round((Date.now() - SES.t0) / 60000));
  const kcal = Math.round(5 * S.profile.weight * (min / 60));
  const form = SES.formTotal ? Math.round((SES.formGood / SES.formTotal) * 100) : null;
  const msgs = [];
  // Progressive overload
  for (const [id, r] of Object.entries(SES.results)) {
    if (!r.sets.length) continue;
    const e = EXERCISES[id], [mn, mx, stp] = rangeFor(id);
    const st = S.exState[id] || { target: exTarget(id) };
    const tgt = st.target;
    const allHit = r.sets.every((s) => s.reps >= s.target);
    const avg = r.sets.reduce((a, s) => a + s.rpe, 0) / r.sets.length;
    const fail = r.sets.some((s) => s.rpe === 4 || s.reps < s.target - 2 * stp);
    if (fail) st.target = Math.max(mn, tgt - stp);
    else if (allHit && avg <= 2.2) st.target = tgt + (avg <= 1.5 ? 2 * stp : stp);
    S.exState[id] = st;
    if (st.target > mx) {
      const pat = Object.keys(PATTERNS).find((p) => S.program.days.some((d) => d.slots.includes(p)) && pickForPattern(p) === id);
      const before = pat && pickForPattern(pat);
      if (pat) { S.patternProgress[pat] = (S.patternProgress[pat] || 0) + 1; const after = pickForPattern(pat); if (after !== before) { msgs.push(`🎉 เลื่อนขั้น! ${e.name} → ${EXERCISES[after].name}`); S.exState[after] = { target: rangeFor(after)[0] }; st.target = mx; } else { st.target = mx; msgs.push(`🏆 ${e.name} ทำได้สูงสุดของช่วงแล้ว ลองทำช้าลง (ลง 3 วิ) เพื่อเพิ่มความยาก`); } }
      else st.target = mx;
    } else if (st.target !== tgt) msgs.push(`${e.name}: ครั้งหน้า ${st.target} ${unitOf(e)}${st.target > tgt ? ' ⬆' : ' ⬇'}`);
  }
  const did = Object.keys(SES.results).length;
  if (did) {
    S.history.push({ date: todayKey(), name: SES.name, min, kcal, form, ex: Object.fromEntries(Object.entries(SES.results).map(([k, v]) => [k, v.sets])) });
    if (!early || did >= 2) S.nextDay = (SES.dayIdx + 1) % S.program.days.length;
  }
  save();
  playerFrame(`
    <div class="done-hero">🎉</div><h2 class="center">${did ? 'จบการฝึกแล้ว!' : 'จบแล้ว'}</h2>
    <div class="stats3 card"><div><b>${min}</b><small>นาที</small></div><div><b>~${kcal}</b><small>kcal</small></div><div><b>${form != null ? form + '%' : '–'}</b><small>ฟอร์มถูกต้อง</small></div></div>
    ${msgs.length ? `<div class="card"><h3>ความคืบหน้า</h3>${msgs.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}
    <div class="card tip"><b>หลังฝึก</b><p>กินโปรตีน 20–40g ภายใน 1–2 ชม. (เช่น อกไก่ ไข่ นม เวย์) และดื่มน้ำ 1–2 แก้ว</p></div>
    <button class="btn primary big" id="fin">กลับหน้าหลัก</button>`);
  Voice.say(did ? `เยี่ยมมาก จบการฝึกแล้ว ใช้เวลา ${min} นาที อย่าลืมกินโปรตีนและดื่มน้ำนะ` : 'จบแล้ว', true);
  $('#fin').onclick = endSessionUI;
  $('#pClose').onclick = endSessionUI;
}

// ---------- PROGRESS ----------
function viewProgress() {
  const B = body();
  const lastWaist = S.waists.length ? S.waists[S.waists.length - 1].cm : S.profile.waist;
  const first = S.weights[0], last = S.weights[S.weights.length - 1];
  const prs = {};
  for (const h of S.history) for (const [id, sets] of Object.entries(h.ex || {})) for (const s of sets) prs[id] = Math.max(prs[id] || 0, s.reps);
  $('#view').innerHTML = `
  <header class="top"><h1>ความคืบหน้า</h1></header>
  <section class="card"><div class="row between"><h3>น้ำหนัก</h3><small class="muted">${first && last ? `${(last.kg - first.kg >= 0 ? '+' : '')}${(last.kg - first.kg).toFixed(1)} kg ตั้งแต่เริ่ม` : ''}</small></div>
    <canvas id="wChart" class="chart"></canvas><small class="muted">เส้นทึบ = ค่าเฉลี่ย 7 วัน (ดูแนวโน้ม ไม่ต้องกังวลน้ำหนักขึ้นลงรายวัน)</small></section>
  <section class="card"><div class="row between"><h3>รอบเอว</h3><small class="muted">${lastWaist ? lastWaist + ' cm' : 'ยังไม่ได้วัด'}</small></div>
    <p class="muted">วัดระดับสะดือ ทุกสัปดาห์ · เอวลด = ไขมันลด แม้น้ำหนักจะนิ่ง</p>
    <div class="row gap"><input id="waIn" type="number" inputmode="decimal" step="0.5" class="inp" placeholder="cm"><button class="btn" id="waSave">บันทึก</button></div>
    ${S.waists.length > 1 ? `<canvas id="waChart" class="chart sm"></canvas>` : ''}</section>
  <section class="card stats3"><div><b>${B.bmi.toFixed(1)}</b><small>BMI · ${bmiLabel(B.bmi)}</small></div><div><b>${B.bf != null ? B.bf.toFixed(0) + '%' : '–'}</b><small>ไขมันโดยประมาณ</small></div><div><b>${B.tdee}</b><small>TDEE kcal</small></div></section>
  <section class="card"><h3>สถิติสูงสุด (ต่อเซ็ต)</h3>${Object.keys(prs).length ? Object.entries(prs).map(([id, v]) => `<div class="hist"><b>${EXERCISES[id]?.name || id}</b><small>${v} ${EXERCISES[id] ? unitOf(EXERCISES[id]) : ''}</small></div>`).join('') : '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
  <section class="card"><div class="row between"><h3>รูปเปรียบเทียบ</h3><label class="btn small">+ เพิ่มรูป<input type="file" accept="image/*" id="phIn" hidden></label></div>
    <p class="muted">ถ่ายทุก 2–4 สัปดาห์ ที่เดิม แสงเดิม ท่าเดิม · รูปเก็บในเครื่องนี้เท่านั้น</p><div class="photos" id="photos"></div></section>
  <section class="card"><h3>กิจกรรม 8 สัปดาห์</h3><div class="heat" id="heat"></div></section>`;
  drawLineChart($('#wChart'), S.weights.map((w) => ({ d: w.date, v: w.kg })), '#7cf5c4', 'kg');
  if ($('#waChart')) drawLineChart($('#waChart'), S.waists.map((w) => ({ d: w.date, v: w.cm })), '#ffb547', 'cm', false);
  $('#waSave').onclick = () => { const v = parseFloat($('#waIn').value); if (!(v > 40 && v < 250)) return toast('ใส่รอบเอวให้ถูกต้อง'); const k = todayKey(); S.waists = S.waists.filter((w) => w.date !== k); S.waists.push({ date: k, cm: v }); S.profile.waist = v; save(); toast('บันทึกแล้ว'); viewProgress(); };
  $('#phIn').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await Photos.add(f); toast('เพิ่มรูปแล้ว'); } catch (er) { toast('บันทึกรูปไม่สำเร็จ'); } viewProgress(); };
  Photos.render($('#photos'));
  const days = new Set(S.history.map((h) => h.date));
  let html = ''; let k = addDays(todayKey(), -55);
  for (let i = 0; i < 56; i++) { html += `<i class="${days.has(k) ? 'on' : ''}" title="${k}"></i>`; k = addDays(k, 1); }
  $('#heat').innerHTML = html;
}
function drawLineChart(c, pts, color, unit, avg = true) {
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth || 320, H = c.clientHeight || 160;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.font = '11px -apple-system, sans-serif';
  if (pts.length < 2) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.textAlign = 'center'; ctx.fillText('บันทึกอย่างน้อย 2 วันเพื่อดูกราฟ', W / 2, H / 2); return; }
  pts = pts.slice(-90);
  const vs = pts.map((p) => p.v), mn = Math.min(...vs) - 0.5, mx = Math.max(...vs) + 0.5;
  const t0 = new Date(pts[0].d).getTime(), t1 = new Date(pts[pts.length - 1].d).getTime() || t0 + 1;
  const X = (d) => 34 + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 44), Y = (v) => 10 + (1 - (v - mn) / (mx - mn)) * (H - 30);
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) { const v = mn + (mx - mn) * i / 3; ctx.beginPath(); ctx.moveTo(34, Y(v)); ctx.lineTo(W - 6, Y(v)); ctx.stroke(); ctx.fillText(v.toFixed(1), 30, Y(v) + 4); }
  ctx.fillStyle = color + '66';
  for (const p of pts) { ctx.beginPath(); ctx.arc(X(p.d), Y(p.v), 2.5, 0, 6.3); ctx.fill(); }
  const line = avg ? pts.map((p, i) => { const win = pts.slice(Math.max(0, i - 6), i + 1); return { d: p.d, v: win.reduce((a, q) => a + q.v, 0) / win.length }; }) : pts;
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
  line.forEach((p, i) => i ? ctx.lineTo(X(p.d), Y(p.v)) : ctx.moveTo(X(p.d), Y(p.v))); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.fillText(fmtDate(pts[0].d), 34, H - 4); ctx.textAlign = 'right'; ctx.fillText(fmtDate(pts[pts.length - 1].d), W - 6, H - 4);
}
const Photos = {
  db() { return new Promise((res, rej) => { const r = indexedDB.open('fitcoach-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async add(file) {
    const img = await createImageBitmap(file).catch(() => null);
    let blob = file;
    if (img) { const sc = Math.min(1, 1080 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82)); }
    const db = await this.db();
    await new Promise((res, rej) => { const tx = db.transaction('p', 'readwrite'); tx.objectStore('p').put({ id: Date.now(), date: todayKey(), blob }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
  async all() { const db = await this.db(); return new Promise((res) => { const tx = db.transaction('p'); const rq = tx.objectStore('p').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }); },
  async del(id) { const db = await this.db(); return new Promise((res) => { const tx = db.transaction('p', 'readwrite'); tx.objectStore('p').delete(id); tx.oncomplete = res; }); },
  async render(el) {
    if (!el) return;
    try {
      const all = (await this.all()).sort((a, b) => b.id - a.id);
      el.innerHTML = all.map((p) => `<figure data-id="${p.id}"><img src="${URL.createObjectURL(p.blob)}"><figcaption>${fmtDate(p.date)}</figcaption></figure>`).join('') || '<p class="muted">ยังไม่มีรูป</p>';
      $$('figure', el).forEach((f) => f.onclick = () => { const src = $('img', f).src; modal(`<img src="${src}" class="photo-big"><div class="row gap"><button class="btn wide" id="phDel">ลบรูป</button><button class="btn primary wide" id="phClose">ปิด</button></div>`); $('#phClose').onclick = closeModal; $('#phDel').onclick = async () => { await this.del(+f.dataset.id); closeModal(); viewProgress(); }; });
    } catch (e) { el.innerHTML = '<p class="muted">เบราว์เซอร์นี้เก็บรูปไม่ได้</p>'; }
  },
};

// ---------- ME / SETTINGS ----------
function viewMe() {
  const p = S.profile, B = body();
  const voices = Voice.list();
  $('#view').innerHTML = `
  <header class="top"><h1>${esc(p.name || 'ฉัน')}</h1></header>
  <section class="card"><h3>ร่างกายและเป้าหมาย</h3>
    <div class="kv"><span>เพศ / อายุ</span><b>${p.sex === 'm' ? 'ชาย' : 'หญิง'} · ${p.age} ปี</b></div>
    <div class="kv"><span>ส่วนสูง / น้ำหนัก</span><b>${p.height} cm · ${p.weight} kg</b></div>
    <div class="kv"><span>BMR (เผาผลาญขณะพัก)</span><b>${B.bmr} kcal</b></div>
    <div class="kv"><span>TDEE (ใช้พลังงานต่อวัน)</span><b>${B.tdee} kcal</b></div>
    <div class="kv"><span>เป้าหมายกิน (ลด ${Math.round(B.def * 100)}%${S.nutrition.kcalAdjust ? `, ปรับ ${S.nutrition.kcalAdjust > 0 ? '+' : ''}${S.nutrition.kcalAdjust}` : ''})</span><b>${B.kcal} kcal</b></div>
    <div class="kv"><span>โปรตีน / คาร์บ / ไขมัน</span><b>${B.protein} / ${B.carb} / ${B.fat} g</b></div>
    <button class="btn wide" id="editP">แก้ไขข้อมูลร่างกาย & ตาราง</button>
  </section>
  <section class="card"><h3>เสียงโค้ช</h3>
    <div class="kv"><span>เปิดเสียงพูด</span><input type="checkbox" class="sw" id="vOn" ${S.settings.voice ? 'checked' : ''}></div>
    <div class="kv"><span>เสียงบี๊บนับจังหวะ</span><input type="checkbox" class="sw" id="bOn" ${S.settings.beep ? 'checked' : ''}></div>
    <div class="kv"><span>ความเร็วพูด</span><input type="range" min="0.7" max="1.4" step="0.1" id="vRate" value="${S.settings.rate}"></div>
    ${voices.length > 1 ? `<div class="kv"><span>เสียง</span><select id="vSel" class="inp">${voices.map((v) => `<option ${v.name === S.settings.voiceName ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>` : ''}
    <button class="btn wide" id="vTest">🔊 ทดสอบเสียง</button>
    ${!voices.length ? '<p class="muted">ถ้าไม่มีเสียงภาษาไทย: ตั้งค่า iPhone › การช่วยการเข้าถึง › เนื้อหาที่พูด › เสียง › ไทย แล้วดาวน์โหลดเสียง (แนะนำแบบ "ปรับปรุงแล้ว")</p>' : ''}
  </section>
  <section class="card"><h3>การฝึก</h3>
    <div class="kv"><span>เวลาพักระหว่างเซ็ต</span><select id="rest" class="inp">${[45, 60, 75, 90, 120].map((s) => `<option value="${s}" ${S.settings.restSec === s ? 'selected' : ''}>${s} วินาที</option>`).join('')}</select></div>
    <button class="btn wide" id="regen">สร้างโปรแกรมใหม่</button>
  </section>
  <section class="card"><h3>ข้อมูล & สำรอง</h3>
    <p class="muted">ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ควรสำรองเดือนละครั้ง (ส่งไฟล์เข้า iCloud Drive/Files หรืออีเมลตัวเอง)</p>
    <div class="row gap"><button class="btn wide" id="exp">📤 สำรองข้อมูล</button><label class="btn wide">📥 นำเข้า<input type="file" accept=".json,application/json" id="imp" hidden></label></div>
    <button class="btn wide ghost danger" id="reset">ลบข้อมูลทั้งหมด</button>
  </section>
  <section class="card tip"><b>⚠️ ข้อควรรู้</b><p>แอปนี้เป็นตัวช่วยฝึก ไม่ใช่คำแนะนำทางการแพทย์ ถ้าเจ็บแปลบ เวียนหัว แน่นหน้าอก ให้หยุดทันที การตรวจท่าด้วยกล้องเป็นการประมาณจากภาพ 2 มิติ ทำงานดีที่สุดเมื่อแสงพอและเห็นทั้งตัว</p></section>
  <p class="muted center">FitCoach v1.0 · ใช้งานออฟไลน์ได้</p>`;
  $('#editP').onclick = () => renderOnboarding(true);
  $('#vOn').onchange = (e) => { S.settings.voice = e.target.checked; save(); };
  $('#bOn').onchange = (e) => { S.settings.beep = e.target.checked; save(); };
  $('#vRate').onchange = (e) => { S.settings.rate = +e.target.value; save(); };
  if ($('#vSel')) $('#vSel').onchange = (e) => { S.settings.voiceName = e.target.value; save(); Voice.init(); };
  $('#vTest').onclick = () => { Voice.unlock(); Voice.say('สวัสดีครับ ผมเป็นโค้ชส่วนตัวของคุณ พร้อมลุยกันหรือยัง', true); };
  $('#rest').onchange = (e) => { S.settings.restSec = +e.target.value; save(); };
  $('#regen').onclick = () => confirmBox('สร้างโปรแกรมใหม่?', 'ระดับความก้าวหน้าของแต่ละท่าจะยังเก็บไว้', 'สร้างใหม่', () => { buildProgram(); toast('สร้างโปรแกรมใหม่แล้ว'); render(); });
  $('#exp').onclick = exportData;
  $('#imp').onchange = importData;
  $('#reset').onclick = () => confirmBox('ลบข้อมูลทั้งหมด?', 'ลบแล้วกู้คืนไม่ได้ (ยกเว้นมีไฟล์สำรอง)', 'ลบทั้งหมด', () => { localStorage.removeItem(STORE_KEY); indexedDB.deleteDatabase('fitcoach-photos'); location.reload(); });
}
async function exportData() {
  const json = JSON.stringify(S, null, 1);
  const name = `fitcoach-backup-${todayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'FitCoach backup' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { const d = JSON.parse(rd.result); if (!d.profile) throw 0; S = Object.assign(DEFAULT_STATE(), d); save(); toast('นำเข้าข้อมูลแล้ว'); render(); } catch (er) { toast('ไฟล์ไม่ถูกต้อง'); } };
  rd.readAsText(f);
}

// ---------- ONBOARDING ----------
const INJ = [['knee', 'เข่า'], ['back', 'หลังล่าง'], ['shoulder', 'ไหล่'], ['wrist', 'ข้อมือ']];
const EQUIP = [['db', 'ดัมเบล'], ['band', 'ยางยืด'], ['bar', 'บาร์โหน/ดึงข้อ']];
const PARQ = ['แพทย์เคยบอกว่าคุณมีโรคหัวใจ หรือความดันสูง', 'เคยเจ็บแน่นหน้าอกขณะออกแรงหรือพักผ่อน', 'เคยเวียนหัวจนเสียการทรงตัว หรือหมดสติ', 'มีปัญหากระดูก/ข้อต่อที่แย่ลงเมื่อออกกำลังกาย', 'กำลังกินยาความดัน โรคหัวใจ หรือเบาหวาน', 'ตั้งครรภ์ หรือเพิ่งคลอดภายใน 6 เดือน'];
function renderOnboarding(edit = false) {
  const p = Object.assign({ name: '', sex: 'm', age: 28, height: 170, weight: 70, waist: '', activity: 1.2, level: 1, days: [1, 3, 5], minutes: 40, equip: [], injuries: [], parq: [] }, S.profile || {});
  let step = edit ? 1 : 0;
  const steps = [
    () => `<div class="ob-hero"><div class="logo">💪</div><h1>FitCoach</h1><p>เทรนเนอร์ส่วนตัวในมือถือ<br>ลดไขมัน · เพิ่มกล้าม · หุ่นดี</p>
      <ul class="feat"><li>📷 กล้องตรวจท่า + นับครั้งอัตโนมัติ</li><li>🔊 โค้ชพูดภาษาไทย</li><li>🍱 นับแคลอรี่อาหารไทย + แผนอาหาร</li><li>📈 โปรแกรมปรับความหนักตามความก้าวหน้า</li></ul>
      <p class="muted small">ข้อมูลทั้งหมดเก็บในเครื่องคุณ ไม่ส่งไปที่ไหน</p></div>`,
    () => `<h2>ข้อมูลร่างกาย</h2>
      <label>ชื่อเล่น<input id="o_name" class="inp wide" value="${esc(p.name)}" placeholder="ไม่ใส่ก็ได้"></label>
      <div class="seg" id="o_sex"><button data-v="m" class="${p.sex === 'm' ? 'on' : ''}">ชาย</button><button data-v="f" class="${p.sex === 'f' ? 'on' : ''}">หญิง</button></div>
      <div class="grid2"><label>อายุ (ปี)<input id="o_age" type="number" inputmode="numeric" class="inp" value="${p.age}"></label>
      <label>ส่วนสูง (cm)<input id="o_h" type="number" inputmode="decimal" class="inp" value="${p.height}"></label>
      <label>น้ำหนัก (kg)<input id="o_w" type="number" inputmode="decimal" class="inp" value="${p.weight}"></label>
      <label>รอบเอว (cm)<input id="o_wa" type="number" inputmode="decimal" class="inp" value="${p.waist || ''}" placeholder="แนะนำ"></label></div>
      <p class="muted small">รอบเอววัดระดับสะดือ ใช้ประเมิน % ไขมัน และดูความคืบหน้าได้แม่นกว่าน้ำหนัก</p>`,
    () => `<h2>ไลฟ์สไตล์</h2><p class="muted">นอกเวลาออกกำลังกาย ปกติคุณขยับตัวแค่ไหน?</p>
      <div class="opts" id="o_act">${ACTIVITY.map((a) => `<button data-v="${a.v}" class="${p.activity === a.v ? 'on' : ''}"><b>${a.t}</b><small>${a.d}</small></button>`).join('')}</div>
      <p class="muted">ประสบการณ์ออกกำลังกาย</p>
      <div class="opts" id="o_lvl">${[[1, 'มือใหม่', 'ไม่ค่อยได้ออกกำลัง / วิดพื้นได้ไม่ถึง 5 ครั้ง'], [2, 'ปานกลาง', 'ออกกำลังสม่ำเสมอมาสักพัก'], [3, 'ขั้นสูง', 'ฝึกเวทจริงจังมากกว่า 1 ปี']].map(([v, t, d]) => `<button data-v="${v}" class="${p.level === v ? 'on' : ''}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>`,
    () => `<h2>ตารางฝึก</h2><p class="muted">เลือกวันที่สะดวก (แนะนำ 3–4 วัน)</p>
      <div class="chips days" id="o_days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-v="${d}" class="chip ${p.days.includes(d) ? 'on' : ''}">${TH_DAYS[d]}</button>`).join('')}</div>
      <p class="muted">เวลาต่อครั้ง</p>
      <div class="seg" id="o_min">${[25, 40, 60].map((m) => `<button data-v="${m}" class="${p.minutes === m ? 'on' : ''}">${m} นาที</button>`).join('')}</div>
      <p class="muted">อุปกรณ์ที่มี (ไม่มีเลยก็ได้ ใช้น้ำหนักตัว)</p>
      <div class="chips" id="o_eq">${EQUIP.map(([k, t]) => `<button data-v="${k}" class="chip ${p.equip.includes(k) ? 'on' : ''}">${t}</button>`).join('')}</div>`,
    () => `<h2>สุขภาพ</h2><p class="muted">มีจุดที่เคยบาดเจ็บหรือปวดบ่อยไหม? (โปรแกรมจะเลี่ยงท่าที่เสี่ยง)</p>
      <div class="chips" id="o_inj">${INJ.map(([k, t]) => `<button data-v="${k}" class="chip ${p.injuries.includes(k) ? 'on' : ''}">${t}</button>`).join('')}</div>
      <p class="muted">ข้อไหนตรงกับคุณบ้าง? (แบบคัดกรอง PAR-Q)</p>
      <div class="checks" id="o_parq">${PARQ.map((q, i) => `<label><input type="checkbox" data-v="${i}" ${p.parq.includes(i) ? 'checked' : ''}><span>${q}</span></label>`).join('')}</div>
      <div id="parqWarn"></div>`,
    () => { const tmp = S.profile; S.profile = p; const B = body(p); S.profile = tmp; return `<h2>แผนของคุณพร้อมแล้ว 🎯</h2>
      <div class="card"><div class="kv"><span>เป้าหมาย</span><b>ลดไขมัน + เพิ่มกล้าม (Recomp)</b></div>
      <div class="kv"><span>BMI</span><b>${B.bmi.toFixed(1)} (${bmiLabel(B.bmi)})</b></div>${B.bf != null ? `<div class="kv"><span>ไขมันโดยประมาณ</span><b>${B.bf.toFixed(0)}%</b></div>` : ''}
      <div class="kv"><span>ใช้พลังงาน/วัน</span><b>${B.tdee} kcal</b></div>
      <div class="kv"><span>ควรกิน/วัน</span><b class="hl">${B.kcal} kcal</b></div>
      <div class="kv"><span>โปรตีน</span><b class="hl">${B.protein} g</b></div>
      <div class="kv"><span>คาร์บ / ไขมัน</span><b>${B.carb} / ${B.fat} g</b></div>
      <div class="kv"><span>น้ำ</span><b>${B.water} ml</b></div>
      <div class="kv"><span>ฝึก</span><b>${p.days.length} วัน/สัปดาห์ · ${p.minutes} นาที</b></div></div>
      <p class="muted small">กินน้อยกว่าที่ใช้ ~${Math.round(B.def * 100)}% เพื่อลดไขมัน และกินโปรตีนสูง + ฝึกแรงต้าน เพื่อรักษา/สร้างกล้าม แอปจะปรับแผนให้ตามน้ำหนักจริงทุก 2 สัปดาห์</p>`; },
  ];
  const draw = () => {
    $('#app').innerHTML = `<div class="ob">
      ${step > 0 ? `<div class="ob-prog">${steps.slice(1).map((_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="ob-body">${steps[step]()}</div>
      <div class="ob-nav">${step > (edit ? 1 : 0) ? '<button class="btn" id="obBack">ย้อนกลับ</button>' : edit ? '<button class="btn" id="obCancel">ยกเลิก</button>' : ''}<button class="btn primary big" id="obNext">${step === 0 ? 'เริ่มตั้งค่า' : step === steps.length - 1 ? (edit ? 'บันทึก' : 'เริ่มเลย!') : 'ถัดไป'}</button></div></div>`;
    const segs = (sel, fn) => $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); fn(b.dataset.v); });
    const multi = (sel, arr, num) => $$(sel + ' button').forEach((b) => b.onclick = () => { const v = num ? +b.dataset.v : b.dataset.v; const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); b.classList.toggle('on'); });
    segs('#o_sex', (v) => p.sex = v); segs('#o_act', (v) => p.activity = +v); segs('#o_lvl', (v) => p.level = +v); segs('#o_min', (v) => p.minutes = +v);
    multi('#o_days', p.days, true); multi('#o_eq', p.equip); multi('#o_inj', p.injuries);
    const pw = () => { const w = $('#parqWarn'); if (w) w.innerHTML = p.parq.length ? '<p class="pill bad">แนะนำให้ปรึกษาแพทย์ก่อนเริ่มออกกำลังกาย ระหว่างนี้แอปจะเริ่มจากความหนักเบา ๆ และให้หยุดทันทีถ้ารู้สึกผิดปกติ</p>' : ''; };
    $$('#o_parq input').forEach((c) => c.onchange = () => { const v = +c.dataset.v; p.parq = p.parq.filter((x) => x !== v); if (c.checked) p.parq.push(v); pw(); }); pw();
    if ($('#obBack')) $('#obBack').onclick = () => { collect(); step--; draw(); };
    if ($('#obCancel')) $('#obCancel').onclick = () => render();
    $('#obNext').onclick = () => {
      if (!collect()) return;
      if (step < steps.length - 1) { step++; draw(); window.scrollTo(0, 0); return; }
      if (p.parq.length) p.level = 1;
      const wasNew = !S.profile;
      p.created = p.created || todayKey();
      S.profile = p;
      if (wasNew || !S.weights.length) logWeight(p.weight);
      if (p.waist && !S.waists.length) S.waists.push({ date: todayKey(), cm: p.waist });
      buildProgram(); save();
      Voice.unlock();
      if (wasNew) Voice.say(`ยินดีต้อนรับ${p.name ? ' ' + p.name : ''} แผนของคุณพร้อมแล้ว ไปลุยกัน`, true);
      TAB = 'home'; render();
    };
  };
  const collect = () => {
    if (step === 1) {
      p.name = $('#o_name').value.trim(); p.age = +$('#o_age').value; p.height = +$('#o_h').value; p.weight = +$('#o_w').value; p.waist = +$('#o_wa').value || null;
      if (!(p.age >= 13 && p.age <= 90) || !(p.height >= 120 && p.height <= 230) || !(p.weight >= 30 && p.weight <= 250)) { toast('กรอกอายุ ส่วนสูง น้ำหนักให้ถูกต้อง'); return false; }
    }
    if (step === 3 && !p.days.length) { toast('เลือกอย่างน้อย 1 วัน'); return false; }
    return true;
  };
  draw();
}

// ---------- Boot ----------
Voice.init();
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && SES && SES.wake === null && 'wakeLock' in navigator) navigator.wakeLock.request('screen').then((w) => SES && (SES.wake = w)).catch(() => {}); });
