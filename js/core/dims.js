'use strict';
// アパレルCAD：寸法（イラレCAD の寸法ツール・曲線の寸法を、型紙用に移したもの）
//
// 寸法は doc.dims に入る（パスとは別。AAMA DXF・立体プレビュー・切り開きの計算には入らない）
//   文書の中の単位は pt。数字は mm で出す。文字や矢印の大きさは mm で決めて pt に直す
// 直線の寸法 { id, dir: 'h'|'v'|'a', a, b, ra, rb, off }
//   a, b … 測る 2 点（最後に分かった位置）
//   ra, rb … 何にくっついているか
//     { k: 'node', id, s, i, n? } … パスのアンカー（n はアンカーの目印 nid。アンカーを足し引きしても同じアンカーを追う）
//     { k: 'ext', id, s, i, n?, ax, sd } … 曲線のいちばん外側（左右・上下に出っぱったところ）
//     null … どこにもくっついていない
//   off … 寸法線の位置（a からの距離。水平なら y の差、垂直なら x の差、平行なら垂直方向の距離）
// 曲線の長さ { type:'len', ra, rb | whole, off, at, val }   R・φ { type:'rad', ra, dia, ang, ext, at, val }
//   at・val は、くっついている先が消えたときに出す、前の位置と数値

const DIM_K = PT_PER_MM;
const DIM = { text: 3.5 * DIM_K, arrow: 3 * DIM_K, arrowW: 0.6 * DIM_K, gap: 1 * DIM_K, over: 2 * DIM_K, sw: 0.25 * DIM_K, color: '#000' };
const dimMM = (v) => v / DIM_K;
const r3 = (v) => Math.round(v * 1000) / 1000;
const segDist = (q, a, b) => { const ab = vsub(b, a), L2 = ab.x * ab.x + ab.y * ab.y; const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / L2)) : 0; return vdist(q, vadd(a, vmul(ab, t))); };

function allDims() { if (!doc.dims) doc.dims = []; return doc.dims; }
function findDim(id) { return (doc.dims || []).find((d) => d.id === id) || null; }
// くっついている先のパスが見えているか（非表示のレイヤー・パスの上の寸法は出さない）
function refVisible(it) {
  const f = findItem(it.id);
  return !!f && f.layer.visible && !it.hidden && f.ancestors.every((g) => !g.hidden);
}

// アンカーの参照 { id, s, i, n? }：n があればそれで探す。n がなければ番号 s, i で探す
function findNodeRef(ref, it) {
  if (!ref) return null;
  if (!it) { const f = findItem(ref.id); it = f && f.item; }
  if (!it || isGroup(it)) return null;
  if (ref.n) { const f = CurveLen.findNode(it, ref.n); return f ? { it, s: f.s, i: f.i, n: it.subs[f.s].nodes[f.i] } : null; }
  const sb = it.subs[ref.s], n = sb && sb.nodes[ref.i];
  return n ? { it, s: ref.s, i: ref.i, n } : null;
}
const nodeNid = (n) => n.nid || (n.nid = uid());
// 寸法を置くときに、参照するアンカーへ目印を付けて、参照にも書いておく
function stampRef(ref) {
  if (!ref) return ref;
  const f = findNodeRef(ref);
  if (f) { ref.n = nodeNid(f.n); ref.s = f.s; ref.i = f.i; }
  return ref;
}

// ================= 直線の寸法 =================
// くっついている先の、いまの位置（null なら参照切れ）
function refPoint(ref, fallback) {
  if (!ref) return fallback;
  if (ref.k === 'node') {
    const f = findNodeRef(ref);
    if (!f || !refVisible(f.it)) return null;
    return P(f.n.x, f.n.y);
  }
  // 曲線のいちばん外側の点：その区間（アンカー n から次のアンカーまで）の中で、同じ向きの出っぱりを探し直す
  if (ref.k === 'ext') {
    const f = findNodeRef(ref);
    if (!f || !refVisible(f.it)) return null;
    const sb = f.it.subs[f.s];
    if (f.i >= CurveLen.segCount(sb)) return null;
    const es = CurveLen.extrema(CurveLen.seg(sb, f.i)).filter((e) => e.ax === ref.ax && e.sd === ref.sd);
    if (!es.length) return null;
    const fb = fallback || es[0].p;
    es.sort((a, b) => vdist(a.p, fb) - vdist(b.p, fb));
    return P(es[0].p.x, es[0].p.y);
  }
  return fallback;
}
// 寸法の形：{ a, b, p1, p2（寸法線の両端）, len（pt）, ok }
function dimGeom(d) {
  const A = refPoint(d.ra, d.a), B = refPoint(d.rb, d.b);
  const ok = !!(A && B);
  const a = A || d.a, b = B || d.b;
  let p1, p2, len;
  if (d.dir === 'h') { const y = a.y + d.off; p1 = P(a.x, y); p2 = P(b.x, y); len = Math.abs(b.x - a.x); }
  else if (d.dir === 'v') { const x = a.x + d.off; p1 = P(x, a.y); p2 = P(x, b.y); len = Math.abs(b.y - a.y); }
  else {
    const u = vsub(b, a), l = vlen(u) || 1, n = P(-u.y / l, u.x / l);
    p1 = vadd(a, vmul(n, d.off)); p2 = vadd(b, vmul(n, d.off)); len = l;
  }
  return { a, b, p1, p2, len, ok };
}
// 数字は mm（小数 1 けたまで）
const fmtDim = (v) => String(Math.round(dimMM(v) * 10) / 10);
// 寸法 1 つの SVG（文書の座標）
function dimSvg(d, col) {
  if (d.type === 'len') return lenSvg(d, col);
  if (d.type === 'rad') return radSvg(d, col);
  const g = dimGeom(d), c = col || (g.ok ? DIM.color : '#e23');
  const { a, b, p1, p2 } = g;
  const sw = DIM.sw;
  let h = '';
  // 寸法補助線：測る点から少し離して、寸法線の少し先まで
  for (const [q, p] of [[a, p1], [b, p2]]) {
    const v = vsub(p, q), l = vlen(v);
    if (l < 1e-6) continue;
    const u = vmul(v, 1 / l), s = vadd(q, vmul(u, Math.min(DIM.gap, l))), e = vadd(p, vmul(u, DIM.over));
    h += `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${c}" stroke-width="${sw}"/>`;
  }
  h += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${c}" stroke-width="${sw}"/>`;
  const L = vdist(p1, p2);
  if (L > 1e-6) {
    const u = vmul(vsub(p2, p1), 1 / L), n = P(-u.y, u.x), al = Math.min(DIM.arrow, L / 2.5), aw = DIM.arrowW * (al / DIM.arrow);
    for (const [tip, dir] of [[p1, u], [p2, vmul(u, -1)]]) {
      const bse = vadd(tip, vmul(dir, al));
      const l1 = vadd(bse, vmul(n, aw)), l2 = vadd(bse, vmul(n, -aw));
      h += `<path d="M${tip.x} ${tip.y}L${l1.x} ${l1.y}L${l2.x} ${l2.y}Z" fill="${c}"/>`;
    }
  }
  // 数値：寸法線の真ん中の上（読む向きは下か右から）
  let ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  if (ang > 90.001) ang -= 180; else if (ang <= -90.001) ang += 180;
  const m = P((p1.x + p2.x) / 2, (p1.y + p2.y) / 2), r = (ang * Math.PI) / 180, up = P(Math.sin(r), -Math.cos(r));
  const t = vadd(m, vmul(up, 0.8 * DIM_K));
  h += `<text x="${t.x}" y="${t.y}" font-size="${DIM.text}" fill="${c}" text-anchor="middle" transform="rotate(${ang} ${t.x} ${t.y})">${fmtDim(g.len)}${g.ok ? '' : ' ?'}</text>`;
  return `<g data-dim="${d.id}" pointer-events="none">${h}</g>`;
}
function dimsSvg() {
  if (S.hideDims) return '';
  let h = '';
  for (const d of doc.dims || []) h += dimSvg(d);
  return h;
}
// 寸法の当たり判定（文書の点 p）
function hitDim(p) {
  if (S.hideDims) return null;
  const T = tol() * 1.5;
  for (const d of [...(doc.dims || [])].reverse()) {
    if (d.type === 'len' || d.type === 'rad') { if (curveDimHit(d, p, T)) return { d }; continue; }
    const g = dimGeom(d), m = P((g.p1.x + g.p2.x) / 2, (g.p1.y + g.p2.y) / 2);
    if (segDist(p, g.p1, g.p2) <= T || vdist(p, m) <= DIM.text * 1.5 + T) return { d };
  }
  return null;
}
// 3 点目（寸法線の位置 c）から、向きと位置を決める
//   2 点の横の範囲の外（左右）なら垂直、それ以外は水平。Shift で 2 点を結ぶ向き（平行）
function dimFromPlace(a, b, c, aligned) {
  if (aligned) {
    const u = vsub(b, a), l = vlen(u) || 1, n = P(-u.y / l, u.x / l);
    return { dir: 'a', off: (c.x - a.x) * n.x + (c.y - a.y) * n.y };
  }
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const outX = c.x < x0 || c.x > x1, outY = c.y < y0 || c.y > y1;
  let dir;
  if (outX && !outY) dir = 'v';
  else if (outY && !outX) dir = 'h';
  else dir = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'h' : 'v';
  return dir === 'h' ? { dir, off: c.y - a.y } : { dir, off: c.x - a.x };
}
function deleteSelectedDims() {
  if (!S.selDims || !S.selDims.size) return false;
  doc.dims = (doc.dims || []).filter((d) => !S.selDims.has(d.id));
  S.selDims.clear();
  render(); commit();
  return true;
}

// ================= 曲線の寸法 =================
// 曲線の長さ：ra → rb へ、アンカーの並びの前へ進む向きに測る（whole ならパス全体）
function lenGeom(d) {
  const A = findNodeRef(d.ra);
  if (!A || !refVisible(A.it)) return { ok: false };
  const sb = A.it.subs[A.s];
  let segs;
  if (d.whole) {
    segs = [...Array(CurveLen.segCount(sb)).keys()];
  } else {
    const B = findNodeRef(d.rb);
    if (!B || B.it !== A.it || B.s !== A.s || (B.i === A.i && !sb.closed)) return { ok: false };
    segs = CurveLen.range(sb, A.i, B.i);
  }
  if (!segs.length) return { ok: false };
  const len = CurveLen.rangeLength(sb, segs), mid = CurveLen.pointAt(sb, segs, len / 2);
  const nrm = P(-mid.tan.y, mid.tan.x), lab = vadd(mid.p, vmul(nrm, d.off || 0));
  return { ok: true, sb, segs, len, mid: mid.p, nrm, lab, closedLoop: sb.closed && (d.whole || segs.length === CurveLen.segCount(sb)) };
}
// R・φ
function radGeom(d) {
  const A = findNodeRef(d.ra);
  if (!A || !refVisible(A.it)) return { ok: false };
  const sb = A.it.subs[A.s];
  if (A.i >= CurveLen.segCount(sb)) return { ok: false };
  const f = d.dia ? CurveLen.circleOf(sb) : CurveLen.arcFit(CurveLen.seg(sb, A.i));
  if (!f) return { ok: false };
  const u = P(Math.cos(d.ang || 0), Math.sin(d.ang || 0)), c = P(f.c.x, f.c.y);
  const on = vadd(c, vmul(u, f.r)), lab = vadd(c, vmul(u, f.r + (d.ext || 0)));
  return { ok: true, c, r: f.r, u, on, lab, len: d.dia ? f.r * 2 : f.r };
}
const curveDimText = (d, v, ok) => (d.type === 'len' ? '⌒' : d.dia ? 'φ' : 'R') + (ok ? fmtDim(v) : (d.val != null ? fmtDim(d.val) : '') + ' ?');
function dimArrow(tip, dir, c) {
  const n = P(-dir.y, dir.x), b = vadd(tip, vmul(dir, -DIM.arrow));
  const l1 = vadd(b, vmul(n, DIM.arrowW)), l2 = vadd(b, vmul(n, -DIM.arrowW));
  return `<path d="M${tip.x} ${tip.y}L${l1.x} ${l1.y}L${l2.x} ${l2.y}Z" fill="${c}"/>`;
}
const dimLabel = (p, txt, c, anchor = 'middle') => `<text x="${p.x}" y="${p.y + DIM.text * 0.35}" font-size="${DIM.text}" fill="${c}" text-anchor="${anchor}">${txt}</text>`;
function lenSvg(d, col) {
  const g = lenGeom(d), c = col || (g.ok ? DIM.color : '#e23'), sw = DIM.sw;
  if (!g.ok) return d.at ? `<g data-dim="${d.id}" pointer-events="none">${dimLabel(d.at, curveDimText(d, 0, false), c)}</g>` : '';
  let h = '';
  // 測る区間：曲線に重ねて少し太く、両端に短い線
  const pts = CurveLen.polyline(g.sb, g.segs);
  h += `<polyline points="${pts.map((q) => `${r3(q.x)},${r3(q.y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${sw * 2.4}" stroke-opacity="0.45" stroke-linejoin="round"/>`;
  if (!g.closedLoop) {
    for (const L of [0, g.len]) {
      const e = CurveLen.pointAt(g.sb, g.segs, L), n = P(-e.tan.y, e.tan.x);
      const a = vadd(e.p, vmul(n, 1.5 * DIM_K)), b = vadd(e.p, vmul(n, -1.5 * DIM_K));
      h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${c}" stroke-width="${sw * 2}"/>`;
    }
  }
  // 引き出し線と数字
  if (vdist(g.lab, g.mid) > DIM.text) {
    const e = vadd(g.lab, vmul(vsub(g.mid, g.lab), DIM.text * 0.7 / vdist(g.lab, g.mid)));
    h += `<line x1="${g.mid.x}" y1="${g.mid.y}" x2="${e.x}" y2="${e.y}" stroke="${c}" stroke-width="${sw}"/><circle cx="${g.mid.x}" cy="${g.mid.y}" r="${0.5 * DIM_K}" fill="${c}"/>`;
  }
  h += dimLabel(g.lab, curveDimText(d, g.len, true), c);
  return `<g data-dim="${d.id}" pointer-events="none">${h}</g>`;
}
function radSvg(d, col) {
  const g = radGeom(d), c = col || (g.ok ? DIM.color : '#e23'), sw = DIM.sw;
  if (!g.ok) return d.at ? `<g data-dim="${d.id}" pointer-events="none">${dimLabel(d.at, curveDimText(d, 0, false), c)}</g>` : '';
  let h = '';
  const out = (d.ext || 0) >= 0;
  // R：中心から円まで（外に出すときはその先まで）。φ：反対側の円から通して引く
  const s = d.dia ? vadd(g.c, vmul(g.u, -g.r)) : g.c;
  const e = out ? g.lab : g.on;
  h += `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${c}" stroke-width="${sw}"/>`;
  h += dimArrow(g.on, g.u, c);
  if (d.dia) h += dimArrow(s, vmul(g.u, -1), c);
  else h += `<circle cx="${g.c.x}" cy="${g.c.y}" r="${0.4 * DIM_K}" fill="${c}"/>`;
  // 数字：線の先（左向きなら右寄せ）
  const left = g.u.x < -0.2, tp = vadd(g.lab, vmul(g.u, out ? DIM_K : 0));
  h += dimLabel(P(tp.x + (out ? (left ? -0.6 : 0.6) * DIM_K : 0), tp.y - (out ? 0 : DIM.text * 0.6)), curveDimText(d, g.len, true), c, out ? (left ? 'end' : 'start') : 'middle');
  return `<g data-dim="${d.id}" pointer-events="none">${h}</g>`;
}
// 当たり判定：数字のまわりと引き出し線（曲線の上は、パスを選べるように当たりにしない）
function curveDimHit(d, p, T) {
  const near = (q) => q && Math.abs(p.x - q.x) <= DIM.text * 2.2 + T && Math.abs(p.y - q.y) <= DIM.text * 0.8 + T;
  if (d.type === 'len') {
    const g = lenGeom(d);
    if (!g.ok) return near(d.at);
    return near(g.lab) || (vdist(g.lab, g.mid) > DIM.text && segDist(p, g.mid, g.lab) <= T);
  }
  const g = radGeom(d);
  if (!g.ok) return near(d.at);
  const s = d.dia ? vadd(g.c, vmul(g.u, -g.r)) : g.c;
  return near(vadd(g.lab, vmul(g.u, DIM.text))) || segDist(p, s, (d.ext || 0) >= 0 ? g.lab : g.on) <= T;
}
// 数字を動かす（選択ツールのドラッグ）。参照が切れているときは動かさない
function moveCurveDim(d, p) {
  if (d.type === 'len') {
    const g = lenGeom(d);
    if (!g.ok) return;
    { const w = vsub(p, g.mid); d.off = w.x * g.nrm.x + w.y * g.nrm.y; }
    d.at = lenGeom(d).lab; d.val = g.len;
  } else {
    const g = radGeom(d);
    if (!g.ok) return;
    const v = vsub(p, g.c), l = vlen(v);
    if (l < 1e-6) return;
    d.ang = Math.atan2(v.y, v.x); d.ext = l - g.r;
    d.at = radGeom(d).lab; d.val = g.len;
  }
}
