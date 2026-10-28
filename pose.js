// ===== Pose detection + form analysis (MediaPipe Pose Landmarker, runs on-device) =====
const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let _landmarkerPromise = null;
function loadLandmarker() {
  if (_landmarkerPromise) return _landmarkerPromise;
  _landmarkerPromise = (async () => {
    const mp = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => mp.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { return await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); return await make('CPU'); }
  })();
  _landmarkerPromise.catch(() => { _landmarkerPromise = null; });
  return _landmarkerPromise;
}

// Landmark indices
const J = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lFt: 31, rFt: 32 };
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];

function ang(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
  const d = Math.hypot(...v1) * Math.hypot(...v2);
  if (!d) return 180;
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
}
// angle of vector a->b from vertical (0 = vertical), degrees
const fromVertical = (a, b) => Math.abs(Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI) > 90 ? 180 - Math.abs(Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI) : Math.abs(Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI);
const fromHorizontal = (a, b) => 90 - fromVertical(a, b);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Signed: is point p below the line a→c (image y grows downward)?
function belowLine(a, p, c) {
  if (Math.abs(c.x - a.x) < 1e-6) return 0;
  const t = (p.x - a.x) / (c.x - a.x);
  const yLine = a.y + t * (c.y - a.y);
  return p.y - yLine; // >0 = below line (sag)
}

function side(P) {
  const L = [11, 13, 15, 23, 25, 27].reduce((s, i) => s + (P[i].v || 0), 0);
  const R = [12, 14, 16, 24, 26, 28].reduce((s, i) => s + (P[i].v || 0), 0);
  return L >= R ? { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27, ft: 31 } : { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28, ft: 32 };
}

const MSG = {
  depth_squat: 'ย่อลงให้ลึกกว่านี้ ให้ต้นขาขนานพื้น',
  lean: 'ยกอกขึ้น หลังตรง อย่าก้มตัวมาก',
  depth_lunge: 'ย่อลงอีก ให้เข่าหลังเกือบแตะพื้น',
  upright: 'ลำตัวตั้งตรง',
  bridge_top: 'ยกสะโพกให้สูงสุด แล้วบีบก้น',
  depth_push: 'ลงให้ลึกกว่านี้ อกเกือบแตะพื้น',
  depth_pike: 'งอศอกลงให้ศีรษะใกล้พื้นกว่านี้',
  sag: 'สะโพกตก เกร็งหน้าท้องให้ลำตัวตรง',
  pike: 'สะโพกสูงไป ลดสะโพกลงให้ลำตัวตรง',
  arms_up: 'ยกแขนให้สุดเหนือศีรษะ',
  uneven: 'ดันสองข้างให้เท่ากัน',
  lockout: 'ดันขึ้นให้สุดแขน',
  knee_bend: 'อย่างอเข่ามาก ดันสะโพกไปด้านหลังแทน',
  depth_rdl: 'ก้มลงอีกนิด จนรู้สึกตึงหลังขา',
  hinge: 'ก้มตัวลงมากกว่านี้ หลังตรง',
  row_depth: 'ดึงศอกไปด้านหลังให้สุด บีบสะบัก',
  tempo: 'ช้าลงหน่อย ควบคุมทุกจังหวะ',
  visibility: 'ถอยออกไปให้กล้องเห็นทั้งตัว',
  position: 'เข้าท่าเตรียมให้พร้อม',
};
const PRAISE = ['ดีมาก', 'สวยงาม', 'ท่าถูกต้อง', 'เยี่ยมเลย', 'แบบนี้แหละ'];

// Analyzer configs. metric(P,s) returns number; rest/active thresholds; dir: 'down' = active when metric < active
const CHECKS = {
  squat: {
    need: (s) => [s.sh, s.hip, s.kn, s.an],
    metric: (P, s) => ang(P[s.hip], P[s.kn], P[s.an]), rest: 155, active: 125, dir: 'down', good: 100, depthIssue: 'depth_squat',
    frame: (P, s, m) => (m < 115 && fromVertical(P[s.hip], P[s.sh]) > 52 ? ['lean'] : []),
    joints: { lean: ['sh', 'hip'], depth_squat: ['hip', 'kn'] },
  },
  lunge: {
    need: (s) => [s.sh, s.hip, 25, 26, 27, 28],
    metric: (P) => Math.min(ang(P[23], P[25], P[27]), ang(P[24], P[26], P[28])), rest: 150, active: 125, dir: 'down', good: 105, depthIssue: 'depth_lunge',
    frame: (P, s, m) => (m < 120 && fromVertical(P[s.hip], P[s.sh]) > 28 ? ['upright'] : []),
    joints: { upright: ['sh', 'hip'], depth_lunge: ['kn'] },
  },
  bridge: {
    need: (s) => [s.sh, s.hip, s.kn],
    metric: (P, s) => ang(P[s.sh], P[s.hip], P[s.kn]), rest: 140, active: 158, dir: 'up', good: 168, depthIssue: 'bridge_top',
    frame: () => [], joints: { bridge_top: ['hip'] },
  },
  pushup: {
    need: (s) => [s.sh, s.el, s.wr, s.hip, s.an],
    metric: (P, s) => ang(P[s.sh], P[s.el], P[s.wr]), rest: 150, active: 120, dir: 'down', good: 95, depthIssue: 'depth_push',
    posture: (P, s) => fromHorizontal(P[s.sh], P[s.an]) < 40,
    frame: (P, s) => lineIssue(P, s.sh, s.hip, s.an), joints: { sag: ['hip'], pike: ['hip'], depth_push: ['el'] },
  },
  knee_pushup: {
    need: (s) => [s.sh, s.el, s.wr, s.hip, s.kn],
    metric: (P, s) => ang(P[s.sh], P[s.el], P[s.wr]), rest: 150, active: 120, dir: 'down', good: 95, depthIssue: 'depth_push',
    posture: (P, s) => fromHorizontal(P[s.sh], P[s.kn]) < 50,
    frame: (P, s) => lineIssue(P, s.sh, s.hip, s.kn), joints: { sag: ['hip'], pike: ['hip'], depth_push: ['el'] },
  },
  pike: {
    need: (s) => [s.sh, s.el, s.wr, s.hip],
    metric: (P, s) => ang(P[s.sh], P[s.el], P[s.wr]), rest: 150, active: 125, dir: 'down', good: 100, depthIssue: 'depth_pike',
    frame: () => [], joints: { depth_pike: ['el'] },
  },
  rdl: {
    need: (s) => [s.sh, s.hip, s.kn, s.an],
    metric: (P, s) => ang(P[s.sh], P[s.hip], P[s.kn]), rest: 160, active: 140, dir: 'down', good: 120, depthIssue: 'depth_rdl',
    frame: (P, s, m) => (m < 140 && ang(P[s.hip], P[s.kn], P[s.an]) < 130 ? ['knee_bend'] : []),
    joints: { knee_bend: ['kn'], depth_rdl: ['hip'] },
  },
  row: {
    need: (s) => [s.sh, s.el, s.wr, s.hip],
    metric: (P, s) => ang(P[s.sh], P[s.el], P[s.wr]), rest: 145, active: 122, dir: 'down', good: 110, depthIssue: 'row_depth',
    frame: () => [], joints: { row_depth: ['el'] },
  },
  press: {
    need: () => [11, 12, 13, 14, 15, 16],
    metric: (P) => (ang(P[11], P[13], P[15]) + ang(P[12], P[14], P[16])) / 2, rest: 110, active: 145, dir: 'up', good: 160, depthIssue: 'lockout',
    frame: (P, s, m) => (m > 120 && Math.abs(ang(P[11], P[13], P[15]) - ang(P[12], P[14], P[16])) > 28 ? ['uneven'] : []),
    joints: { uneven: ['el'], lockout: ['el'] }, front: true,
  },
  jack: {
    need: () => [0, 11, 12, 15, 16, 27, 28],
    metric: (P) => {
      const sw = dist(P[11], P[12]) || 0.1;
      const feet = dist(P[27], P[28]) / sw;
      const armsUp = (P[15].y < P[0].y && P[16].y < P[0].y) ? 1 : 0;
      return feet + armsUp; // closed ≈ <1.2 ; open ≈ >2.2
    }, rest: 1.3, active: 2.1, dir: 'up', good: 2.4, depthIssue: 'arms_up',
    frame: () => [], joints: { arms_up: ['wr'] }, front: true,
  },
  plank: {
    need: (s) => [s.sh, s.hip, s.an],
    hold: true,
    posture: (P, s) => fromHorizontal(P[s.sh], P[s.an]) < 35,
    frame: (P, s) => lineIssue(P, s.sh, s.hip, s.an, 163), joints: { sag: ['hip'], pike: ['hip'] },
  },
};

function lineIssue(P, a, h, c, thr = 158) {
  const la = ang(P[a], P[h], P[c]);
  if (la >= thr) return [];
  return belowLine(P[a], P[h], P[c]) > 0 ? ['sag'] : ['pike'];
}

class FormAnalyzer {
  constructor(checkKey) {
    this.cfg = CHECKS[checkKey];
    this.key = checkKey;
    this.state = 'rest';
    this.reps = 0; this.goodReps = 0;
    this.extreme = null; this.activeFrames = 0; this.issueCounts = {}; this.repStart = 0;
    this.holdGood = 0; this.holdTotal = 0; this.lastT = 0;
    this.metric = null; this.liveIssues = []; this.visible = false; this.inPosition = true;
  }
  // P: smoothed landmarks in pixel space {x,y,v}; returns events
  update(P, t) {
    const ev = { rep: false, repIssues: [], live: [] };
    const c = this.cfg;
    const s = side(P);
    const need = c.need(s);
    this.visible = need.every((i) => (P[i].v || 0) > 0.45);
    if (!this.visible) { this.liveIssues = ['visibility']; this.lastT = t; return ev; }
    this.inPosition = c.posture ? c.posture(P, s) : true;
    if (c.hold) {
      const dt = this.lastT ? Math.min(0.2, (t - this.lastT) / 1000) : 0;
      this.lastT = t;
      if (!this.inPosition) { this.liveIssues = ['position']; return ev; }
      const iss = c.frame(P, s, 0);
      this.holdTotal += dt; if (!iss.length) this.holdGood += dt;
      this.liveIssues = iss; ev.live = iss; ev.side = s;
      return ev;
    }
    this.lastT = t;
    const m = c.metric(P, s);
    this.metric = m;
    const isActive = c.dir === 'down' ? m < c.active : m > c.active;
    const isRest = c.dir === 'down' ? m > c.rest : m < c.rest;
    if (!this.inPosition && this.state === 'rest') { this.liveIssues = ['position']; return ev; }
    const iss = c.frame(P, s, m);
    this.liveIssues = iss; ev.side = s;
    if (this.state === 'rest' && isActive) {
      this.state = 'active'; this.extreme = m; this.activeFrames = 0; this.issueCounts = {}; this.repStart = this.repStart || t;
    }
    if (this.state === 'active') {
      this.activeFrames++;
      this.extreme = c.dir === 'down' ? Math.min(this.extreme, m) : Math.max(this.extreme, m);
      for (const i of iss) this.issueCounts[i] = (this.issueCounts[i] || 0) + 1;
      if (isRest) {
        this.state = 'rest';
        this.reps++;
        const repIssues = [];
        const depthOk = c.dir === 'down' ? this.extreme <= c.good : this.extreme >= c.good;
        if (!depthOk) repIssues.push(c.depthIssue);
        for (const [k, n] of Object.entries(this.issueCounts)) if (n >= Math.max(4, this.activeFrames * 0.3)) repIssues.push(k);
        const dur = (t - this.repStart) / 1000;
        if (dur > 0 && dur < 0.9 && this.key !== 'jack') repIssues.push('tempo');
        if (!repIssues.length) this.goodReps++;
        ev.rep = true; ev.repIssues = repIssues;
        this.repStart = t;
      }
    } else if (isRest) this.repStart = t;
    return ev;
  }
}

// ---------- Camera trainer ----------
class CameraTrainer {
  constructor(video, canvas) {
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.stream = null; this.running = false; this.facing = 'user';
    this.smooth = null; this.analyzer = null; this.onEvent = null; this.onFrame = null;
    this.badJoints = new Set(); this.lastVideoTime = -1;
  }
  async start(facing) {
    if (facing) this.facing = facing;
    this.stopStream();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 } } });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    this.video.style.transform = this.canvas.style.transform = this.facing === 'user' ? 'scaleX(-1)' : 'none';
    this.landmarker = await loadLandmarker();
  }
  stopStream() { if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; } }
  setExercise(checkKey) { this.analyzer = checkKey && CHECKS[checkKey] ? new FormAnalyzer(checkKey) : null; this.smooth = null; }
  run() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  pause() { this.running = false; cancelAnimationFrame(this.raf); }
  stop() { this.pause(); this.stopStream(); }
  tick() {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2) return;
    const W = v.videoWidth, H = v.videoHeight;
    if (this.canvas.width !== W) { this.canvas.width = W; this.canvas.height = H; }
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const now = performance.now();
    let res;
    try { res = this.landmarker.detectForVideo(v, now); } catch (e) { return; }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const lm = res && res.landmarks && res.landmarks[0];
    if (!lm) { this.onFrame && this.onFrame({ person: false }); return; }
    const raw = lm.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility ?? 1 }));
    if (!this.smooth) this.smooth = raw;
    else this.smooth = raw.map((p, i) => ({ x: this.smooth[i].x * 0.45 + p.x * 0.55, y: this.smooth[i].y * 0.45 + p.y * 0.55, v: p.v }));
    const P = this.smooth;
    let ev = null;
    if (this.analyzer) {
      ev = this.analyzer.update(P, now);
      this.badJoints = new Set();
      const jm = this.analyzer.cfg.joints || {};
      const s = ev.side || side(P);
      for (const iss of this.analyzer.liveIssues) for (const jn of (jm[iss] || [])) { if (s[jn] != null) this.badJoints.add(s[jn]); if (this.analyzer.cfg.front) { if (jn === 'el') { this.badJoints.add(13); this.badJoints.add(14); } if (jn === 'wr') { this.badJoints.add(15); this.badJoints.add(16); } } }
      if (ev.rep || ev.live.length) this.onEvent && this.onEvent(ev, this.analyzer);
    }
    this.draw(P);
    this.onFrame && this.onFrame({ person: true, analyzer: this.analyzer });
  }
  draw(P) {
    const ctx = this.ctx, sc = this.canvas.width / 480;
    ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if ((P[a].v || 0) < 0.3 || (P[b].v || 0) < 0.3) continue;
      const bad = this.badJoints.has(a) || this.badJoints.has(b);
      ctx.strokeStyle = bad ? 'rgba(255,90,90,0.95)' : 'rgba(124,245,196,0.9)';
      ctx.lineWidth = 5 * sc;
      ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
    }
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if ((P[i].v || 0) < 0.3) continue;
      ctx.fillStyle = this.badJoints.has(i) ? '#ff5a5a' : '#ffffff';
      ctx.beginPath(); ctx.arc(P[i].x, P[i].y, (this.badJoints.has(i) ? 9 : 5) * sc, 0, Math.PI * 2); ctx.fill();
    }
  }
}

if (typeof window !== 'undefined') Object.assign(window, { CameraTrainer, FormAnalyzer, CHECKS, MSG, PRAISE, loadLandmarker });
