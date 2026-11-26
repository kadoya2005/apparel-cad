'use strict';
// アパレルCAD：寸法ツール・曲線の長さツール・半径直径ツールと、選択ツールでの寸法の選択・移動
//   寸法ツール：1 回目のクリック＝1 点目、2 回目＝2 点目、3 回目＝寸法線の位置（左右に出せば垂直、上下に出せば水平。Shift で斜め）
//   点はアンカーや曲線のいちばん外側に吸着し、そこにくっつく（形を直すと数値も直る）

// 吸着先：アンカーと、曲線のいちばん外側
function dimCands() {
  const out = [];
  for (const it of visibleLeaves()) {
    it.subs.forEach((sb, s) => {
      sb.nodes.forEach((n, i) => out.push({ x: n.x, y: n.y, kind: 'アンカー', ref: { k: 'node', id: it.id, s, i } }));
      for (let i = 0; i < CurveLen.segCount(sb); i++) for (const e of CurveLen.extrema(CurveLen.seg(sb, i)))
        out.push({ x: e.p.x, y: e.p.y, kind: 'いちばん外側', ref: { k: 'ext', id: it.id, s, i, ax: e.ax, sd: e.sd } });
    });
  }
  return out;
}
function dimSnap(p, shift) {
  const cands = dimCands();
  if (shift) return { p, ref: null, viz: null };
  const sn = snapPoint(p, cands);
  const c = cands.find((k) => Math.abs(k.x - sn.p.x) < 1e-9 && Math.abs(k.y - sn.p.y) < 1e-9);
  return { p: sn.p, ref: c ? c.ref : null, viz: sn.viz };
}
function addDim(d) {
  allDims().push(d);
  S.dimDraft = null;
  S.hideDims = false;
  S.selDims = new Set([d.id]);
  render(); commit(); updateUI();
}
Tools.dim = {
  down(e, p) {
    const dr = S.dimDraft;
    if (dr && dr.b) {
      const pl = dimFromPlace(dr.a, dr.b, p, e.shiftKey);
      addDim({ id: uid(), ...pl, a: dr.a, b: dr.b, ra: stampRef(dr.ra), rb: stampRef(dr.rb) });
      return;
    }
    const q = dimSnap(p, false);
    if (!dr || dr.kind) { S.dimDraft = { a: q.p, ra: q.ref }; return; }
    if (vdist(q.p, dr.a) < 1e-6) return;
    dr.b = q.p; dr.rb = q.ref;
  },
  move() {},
  up() {},
};
// 文書の座標の SVG を、画面（overlay）に重ねるための変形
const docToScrTransform = () => `translate(${view.x} ${view.y}) rotate(${((view.r || 0) * 180) / Math.PI}) scale(${view.z})`;
// overlay：作っている途中の寸法と、選んでいる寸法
function dimOverlaySvg(t) {
  let h = '';
  if (!S.hideDims) for (const id of S.selDims || []) { const d = findDim(id); if (d) h += dimSvg(d, '#2f7bff'); }
  h += curveDraftSvg(t);
  const dr = t === 'dim' && S.dimDraft;
  if (dr && !dr.kind && S.mouse) {
    if (!dr.b) {
      const q = dimSnap(S.mouse, S.keys.shift).p;
      h += `<line x1="${dr.a.x}" y1="${dr.a.y}" x2="${q.x}" y2="${q.y}" stroke="#2f7bff" stroke-width="${1 / view.z}" stroke-dasharray="${4 / view.z} ${3 / view.z}"/>`;
    } else {
      const pl = dimFromPlace(dr.a, dr.b, S.mouse, S.keys.shift);
      h += dimSvg({ id: 'draft', ...pl, a: dr.a, b: dr.b, ra: dr.ra, rb: dr.rb }, '#2f7bff');
    }
    h += `<circle cx="${dr.a.x}" cy="${dr.a.y}" r="${3 / view.z}" fill="#2f7bff"/>`;
    if (dr.b) h += `<circle cx="${dr.b.x}" cy="${dr.b.y}" r="${3 / view.z}" fill="#2f7bff"/>`;
  }
  return h ? `<g transform="${docToScrTransform()}" pointer-events="none">${h}</g>` : '';
}

// 選択ツール：寸法をクリックで選ぶ、ドラッグで寸法線（数字）の位置を動かす
(function () {
  const sel = Tools.select, down0 = sel.down, move0 = sel.move, up0 = sel.up;
  sel.down = function (e, p, sp) {
    const hd = !(S.sel.size && (hitBBoxHandle(sp) || (typeof hitBBoxRotate === 'function' && hitBBoxRotate(sp)))) && hitDim(p);
    if (hd) {
      if (!e.shiftKey) S.sel.clear();
      if (!S.selDims) S.selDims = new Set();
      if (e.shiftKey && S.selDims.has(hd.d.id)) S.selDims.delete(hd.d.id);
      else { if (!e.shiftKey) S.selDims.clear(); S.selDims.add(hd.d.id); }
      S.drag = { type: 'dimMove', id: hd.d.id, moved: false, s: sp };
      return;
    }
    if (!e.shiftKey && S.selDims) S.selDims.clear();
    down0.call(this, e, p, sp);
  };
  sel.move = function (e, p, sp) {
    const d = S.drag;
    if (!d || d.type !== 'dimMove') return move0.call(this, e, p, sp);
    if (!d.moved && Math.hypot(sp.x - d.s.x, sp.y - d.s.y) < 3) return;
    d.moved = true;
    const dm = findDim(d.id);
    if (!dm) return;
    if (dm.type === 'len' || dm.type === 'rad') { moveCurveDim(dm, p); renderArt(); return; }
    const g = dimGeom(dm);
    if (dm.dir === 'h') dm.off = p.y - g.a.y;
    else if (dm.dir === 'v') dm.off = p.x - g.a.x;
    else { const u = vsub(g.b, g.a), l = vlen(u) || 1; dm.off = ((p.x - g.a.x) * -u.y + (p.y - g.a.y) * u.x) / l; }
    renderArt();
  };
  sel.up = function (e, p, sp) {
    const d = S.drag;
    if (!d || d.type !== 'dimMove') return up0.call(this, e, p, sp);
    if (d.moved) commit();
  };
})();

// ================= 曲線の長さ・R/φ のツール =================
// マウスの近くのアンカー
function anchorAt(p) {
  const T = tol() * 1.6;
  let best = null;
  for (const it of visibleLeaves()) it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { const d = vdist(n, p); if (d <= T && (!best || d < best.d)) best = { it, s, i, d }; }));
  return best;
}
// マウスの近くのパスの線：{ it, s, seg, t, d, pt }
function pathAt(p) {
  const T = tol() * 1.6;
  let best = null;
  for (const it of visibleLeaves()) {
    const n = Geo.nearest(it, p);
    if (n && n.seg >= 0 && n.d <= T && (!best || n.d < best.d)) best = { it, ...n };
  }
  return best;
}
const nodeRefOf = (it, s, i) => ({ k: 'node', id: it.id, s, i });
// 区間の線とマウスの距離
function lenSectionDist(d, m) {
  const g = lenGeom(d);
  if (!g.ok) return Infinity;
  const pts = CurveLen.polyline(g.sb, g.segs, 12);
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) best = Math.min(best, segDist(m, pts[k], pts[k + 1]));
  return best;
}
// 作っている途中の長さの寸法（閉じたパスでは、マウスに近いほうの回りを測る）
function lenDraftDim(dr, m) {
  let d = { id: 'draft', type: 'len', ra: dr.ra, rb: dr.whole ? null : dr.rb, whole: !!dr.whole, off: 0 };
  if (!d.whole && dr.ra.i !== dr.rb.i) {
    const A = findNodeRef(d.ra);
    if (A && A.it.subs[A.s].closed) { const d2 = { ...d, ra: dr.rb, rb: dr.ra }; if (lenSectionDist(d2, m) < lenSectionDist(d, m)) d = d2; }
  }
  const g = lenGeom(d);
  if (g.ok) { const w = vsub(m, g.mid); d.off = w.x * g.nrm.x + w.y * g.nrm.y; }
  return d;
}
function radDraftDim(dr, m) {
  const d = { id: 'draft', type: 'rad', ra: dr.ra, dia: dr.dia, ang: 0, ext: 0 };
  const g = radGeom(d);
  if (g.ok) { const v = vsub(m, g.c), l = vlen(v); if (l > 1e-6) { d.ang = Math.atan2(v.y, v.x); d.ext = l - g.r; } }
  return d;
}
// 置く：参照に目印を付けて、切れたときのための位置と数値も覚える
function placeCurveDim(d) {
  const g = d.type === 'len' ? lenGeom(d) : radGeom(d);
  if (!g.ok) return;
  const out = { ...d, id: uid(), ra: stampRef({ ...d.ra }), at: g.lab, val: g.len };
  if (d.rb) out.rb = stampRef({ ...d.rb });
  addDim(out);
}
Tools.dimLen = {
  down(e, p) {
    let dr = S.dimDraft;
    if (dr && dr.kind !== 'len') dr = S.dimDraft = null;
    if (dr && dr.ready) { placeCurveDim(lenDraftDim(dr, p)); return; }
    const an = anchorAt(p);
    if (!dr) {
      if (an) { S.dimDraft = { kind: 'len', ra: nodeRefOf(an.it, an.s, an.i) }; return; }
      const pa = pathAt(p);
      if (pa) { S.dimDraft = { kind: 'len', ra: nodeRefOf(pa.it, pa.s, 0), whole: true, ready: true }; return; }
      toast('パスの線（全体の長さ）か、アンカー（区間の長さ）をクリックしてください');
      return;
    }
    if (!an || an.it.id !== dr.ra.id || an.s !== dr.ra.s) { toast('同じパスのアンカーをクリックしてください'); return; }
    if (an.i === dr.ra.i && !an.it.subs[an.s].closed) return;
    dr.rb = nodeRefOf(an.it, an.s, an.i); dr.ready = true;
  },
  move() {},
  up() {},
};
Tools.dimRad = {
  down(e, p) {
    const dr = S.dimDraft;
    if (dr && dr.kind === 'rad') { placeCurveDim(radDraftDim(dr, p)); return; }
    const pa = pathAt(p);
    if (!pa) { toast('円や円弧の線をクリックしてください'); return; }
    const sb = pa.it.subs[pa.s];
    const circle = !e.shiftKey && CurveLen.circleOf(sb), arc = CurveLen.arcFit(CurveLen.seg(sb, pa.seg));
    if (!circle && !arc) { toast('ここは円弧ではありません（円・円弧をクリック）'); return; }
    S.dimDraft = { kind: 'rad', ra: nodeRefOf(pa.it, pa.s, pa.seg), dia: !!circle };
  },
  move() {},
  up() {},
};
// overlay：作っている途中の曲線の寸法（青）
function curveDraftSvg(t) {
  const dr = S.dimDraft, m = S.mouse, B = '#2f7bff';
  if (!dr || !m) return '';
  if (t === 'dimLen' && dr.kind === 'len') {
    if (dr.ready) return lenSvg(lenDraftDim(dr, m), B);
    const A = findNodeRef(dr.ra);
    return A ? `<circle cx="${A.n.x}" cy="${A.n.y}" r="${3 / view.z}" fill="${B}"/>` : '';
  }
  if (t === 'dimRad' && dr.kind === 'rad') return radSvg(radDraftDim(dr, m), B);
  return '';
}
