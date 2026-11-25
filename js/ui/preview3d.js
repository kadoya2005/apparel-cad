'use strict';
// アパレルCAD：立体プレビューの窓（素体にスカートを着せた「だいたいの形」を、回して見る）
// 絵は canvas 2D で描く（ライブラリなし）。面を奥から順に塗る

const P3 = {
  open: false, yaw: 0.5, pitch: 0.18, zoom: 1, meas: null, model: null,
  body: null,          // { waist, hip, hipLen }（mm）
  opt: { stiff: 0.3, folds: 8, color: '#4a6fa5' },
  timer: 0, nodes: null,
};

function p3Load() {
  try {
    const s = JSON.parse(localStorage.getItem('apparelcad.preview3d') || 'null');
    if (s && s.opt) Object.assign(P3.opt, s.opt);
    if (s && s.body && s.body.waist > 0) P3.body = s.body;
  } catch (_) { /* なくてもよい */ }
}
function p3Save() {
  try { localStorage.setItem('apparelcad.preview3d', JSON.stringify({ opt: P3.opt, body: P3.body })); } catch (_) { /* 保存できなくてもよい */ }
}

// 型紙の寸法から、素体の寸法を決める（ウエストは 1cm、ヒップは 4cm のゆとり）
function p3FitBody(meas) {
  const w = meas.widths;
  const hipLen = meas.hipLen || 190;
  const at = (s) => w[Math.min(w.length - 1, Math.max(0, Math.round(s / meas.step)))] || 0;
  const waist = Math.max(500, at(2) - 10);
  const hip = Math.max(waist + 60, at(hipLen) - 40);
  return { waist: Math.round(waist), hip: Math.round(hip), hipLen: Math.round(hipLen) };
}

function p3Rebuild() {
  if (!P3.open) return;
  try {
    P3.meas = drapeMeasure(P3.nodes);
  } catch (err) { P3.meas = null; $('p3Note').textContent = '型紙を測れませんでした：' + err.message; P3.model = null; p3Draw(); return; }
  if (!P3.meas.widths.length) { P3.model = null; $('p3Note').textContent = '型紙（閉じた輪郭）がありません。「見本を開く」で試せます'; p3Draw(); return; }
  if (!P3.body) { P3.body = p3FitBody(P3.meas); p3Save(); }
  p3FillInputs();
  P3.model = drapeBuild(P3.meas, P3.body, P3.opt);
  const inf = P3.model.info;
  const cm = (v) => (Math.round(v / 10 * 10) / 10).toFixed(1);
  let note = `型紙 ${P3.meas.pieces} 枚（半身として 2 倍）　ウエスト ${cm(inf.waist)}cm・裾回り ${cm(inf.hem)}cm・丈 ${cm(inf.length)}cm`;
  if (inf.tight) note += '　※素体より小さいところがあります（きつい）';
  if (P3.meas.warnings.length) note += '　' + P3.meas.warnings[0];
  $('p3Note').textContent = note;
  p3Draw();
}
function p3Schedule() { clearTimeout(P3.timer); P3.timer = setTimeout(p3Rebuild, 120); }

function p3FillInputs() {
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('p3Waist', (P3.body.waist / 10).toFixed(1));
  set('p3Hip', (P3.body.hip / 10).toFixed(1));
  set('p3HipLen', (P3.body.hipLen / 10).toFixed(1));
  set('p3Stiff', Math.round(P3.opt.stiff * 100));
  set('p3Folds', P3.opt.folds);
  set('p3Color', P3.opt.color);
}

// ---- 描く ----
function p3Hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function p3Draw() {
  const cv = $('p3Canvas');
  const dpr = window.devicePixelRatio || 1;
  const Wd = cv.clientWidth, Ht = cv.clientHeight;
  if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Ht * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Ht * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, Ht);
  bg.addColorStop(0, '#f4f2ee'); bg.addColorStop(1, '#d9d5cd');
  g.fillStyle = bg; g.fillRect(0, 0, Wd, Ht);
  if (!P3.model) return;
  const cy = Math.cos(P3.yaw), sy = Math.sin(P3.yaw), cp = Math.cos(P3.pitch), sp = Math.sin(P3.pitch);
  const midY = -(P3.body.hipLen + 160);
  const camD = 3200;
  const scale = (Ht * 0.92 / 1500) * P3.zoom;
  // 回す：y 軸まわりに yaw、x 軸まわりに pitch。z が手前
  const view = (p) => {
    const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
    const y0 = p.y - midY;
    const y1 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
    return { x: x1, y: y1, z: z2 };
  };
  const proj = (v) => { const k = camD / (camD - v.z); return { x: Wd / 2 + v.x * k * scale, y: Ht / 2 - v.y * k * scale }; };
  // 床の影
  const fy = -(P3.body.hipLen + 700);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.beginPath();
  for (let j = 0; j <= 48; j++) {
    const t = (j / 48) * Math.PI * 2;
    const s = proj(view({ x: 260 * Math.cos(t), y: fy, z: 200 * Math.sin(t) }));
    j ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y);
  }
  g.fill();
  // 光（見ている向きの左上から）
  const L = (() => { const v = { x: -0.75, y: 0.5, z: 0.45 }; const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; })();
  const faces = [];
  const bodyC = [226, 220, 212], sk = p3Hex(P3.opt.color);
  for (const m of P3.model.meshes) {
    const V = m.rings.map((r) => r.map(view));
    const isSkirt = m.kind === 'skirt';
    for (let i = 0; i + 1 < V.length; i++) {
      const A = V[i], Bn = V[i + 1], n = A.length;
      // 輪の中心（外向きかどうかの判定に使う）
      const ctr = view({ x: m.rings[i].reduce((s, p) => s + p.x, 0) / n, y: m.rings[i][0].y, z: m.rings[i].reduce((s, p) => s + p.z, 0) / n });
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        const p0 = A[j], p1 = A[k], p2 = Bn[k], p3 = Bn[j];
        const ux = p2.x - p0.x, uy = p2.y - p0.y, uz = p2.z - p0.z;
        const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const cxm = (p0.x + p1.x + p2.x + p3.x) / 4, cym = (p0.y + p1.y + p2.y + p3.y) / 4, czm = (p0.z + p1.z + p2.z + p3.z) / 4;
        // 外向きにそろえる
        if (nx * (cxm - ctr.x) + nz * (czm - ctr.z) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const facing = nz > 0;   // 正投影に近いので z だけで判定
        if (!facing && !isSkirt) continue;
        let col, lit;
        if (isSkirt && !facing) { lit = 0.32 + 0.25 * Math.max(0, -(nx * L.x + ny * L.y + nz * L.z)); col = sk; }
        else {
          const dif = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
          // 少しつや（布は控えめ）
          const hx = L.x, hy2 = L.y, hz = L.z + 1, hl = Math.hypot(hx, hy2, hz);
          const spec = Math.pow(Math.max(0, (nx * hx + ny * hy2 + nz * hz) / hl), isSkirt ? 18 : 30) * (isSkirt ? 0.05 : 0.25);
          lit = 0.3 + 0.75 * dif + spec;
          col = isSkirt ? sk : bodyC;
        }
        const c = col.map((v) => Math.max(0, Math.min(255, Math.round(v * lit))));
        faces.push({ z: czm, pts: [p0, p1, p2, p3], fill: `rgb(${c[0]},${c[1]},${c[2]})` });
        // 裾の線（見えている面のぶんだけ。奥の裾が透けないよう、面と一緒に奥から描く）
        if (isSkirt && facing && i + 1 === V.length - 1) faces.push({ z: czm + 0.01, line: [p2, p3] });
      }
    }
  }
  faces.sort((a, b) => a.z - b.z);
  g.lineJoin = 'round';
  g.lineWidth = 0.6;
  for (const f of faces) {
    if (f.line) {
      const a = proj(f.line[0]), b = proj(f.line[1]);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.lineWidth = 0.6;
      continue;
    }
    g.beginPath();
    f.pts.forEach((p, i) => { const s = proj(p); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
    g.closePath();
    g.fillStyle = f.fill; g.strokeStyle = f.fill;
    g.fill(); g.stroke();
  }
}

// ---- 窓 ----
function openPreview3d() {
  p3Load();
  const pcs = selectedPieceNodes();
  P3.nodes = pcs.length ? pcs : null;
  P3.open = true;
  $('preview3d').hidden = false;
  $('p3Scope').textContent = P3.nodes ? `選んだ型紙 ${P3.nodes.length} 枚` : 'すべての型紙';
  p3Rebuild();
}
function closePreview3d() { P3.open = false; $('preview3d').hidden = true; }

(function initPreview3d() {
  $('btnPreview3d').addEventListener('click', openPreview3d);
  $('p3Close').addEventListener('click', closePreview3d);
  onDocChange(() => { if (P3.open) p3Schedule(); });
  const cv = $('p3Canvas');
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: P3.yaw, pitch: P3.pitch }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    P3.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
    P3.pitch = Math.max(-0.5, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.008));
    p3Draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); P3.zoom = Math.max(0.5, Math.min(3, P3.zoom * Math.exp(-e.deltaY * 0.0015))); p3Draw(); }, { passive: false });
  document.querySelectorAll('[data-p3view]').forEach((b) => b.addEventListener('click', () => {
    P3.yaw = { front: 0, side: Math.PI / 2, back: Math.PI, diag: 0.5 }[b.dataset.p3view];
    P3.pitch = 0.12; p3Draw();
  }));
  const num = (id, f) => $(id).addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v > 0) { f(v); p3Save(); p3Rebuild(); } else p3FillInputs(); });
  num('p3Waist', (v) => { P3.body.waist = v * 10; });
  num('p3Hip', (v) => { P3.body.hip = v * 10; });
  num('p3HipLen', (v) => { P3.body.hipLen = v * 10; });
  $('p3Stiff').addEventListener('input', (e) => { P3.opt.stiff = e.target.value / 100; p3Save(); p3Rebuild(); });
  $('p3Folds').addEventListener('input', (e) => { P3.opt.folds = parseInt(e.target.value, 10); p3Save(); p3Rebuild(); });
  $('p3Color').addEventListener('input', (e) => { P3.opt.color = e.target.value; p3Save(); p3Draw(); });
  $('p3Fit').addEventListener('click', () => { if (P3.meas && P3.meas.widths.length) { P3.body = p3FitBody(P3.meas); p3Save(); p3Rebuild(); } });
  window.addEventListener('resize', () => { if (P3.open) p3Draw(); });
  // 見出しをつかんで窓を動かす
  const box = $('preview3d'), head = box.querySelector('.p3Head');
  let mv = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    mv = { x: e.clientX - r.left, y: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!mv) return;
    box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - mv.x)) + 'px';
    box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - mv.y)) + 'px';
    box.style.right = 'auto'; box.style.bottom = 'auto';
  });
  head.addEventListener('pointerup', () => { mv = null; });
})();
