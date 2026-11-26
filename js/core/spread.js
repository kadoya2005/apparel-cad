'use strict';
// アパレルCAD：パターン展開（切り開き）と縫い代
//
// 切り開き：型紙に「切り開き線」を引き、裾などを開いて広げる（例：タイトスカート → フレアスカート）
//   ・切り開き線は、開く側（裾）から、とめる側（支点・ウエスト）へ向けて引く
//   ・縫い線（なければ輪郭）を切り開き線で区切り、支点のまわりに回して開く
//   ・布目線のある区画は動かさない（なければ端の区画）
//   ・開いた裾や支点のまわりは、なめらかにつなぎ直す
//   ・輪郭（裁断線）は、新しい縫い線から縫い代の幅で作り直す
//
// 縫い代：閉じたパスを、ベジェのまま外側へ平行にずらす（角はマイター）

const SEAM_TOL_MM = 0.1;   // 縫い代の曲線の、許容のずれ（mm）

// ---- ベジェの小道具 ----
function cubicD(a, b, c, e, t) {
  const mt = 1 - t;
  return P(3 * (mt * mt * (b.x - a.x) + 2 * mt * t * (c.x - b.x) + t * t * (e.x - c.x)),
    3 * (mt * mt * (b.y - a.y) + 2 * mt * t * (c.y - b.y) + t * t * (e.y - c.y)));
}
// t の位置の向き（長さ 1）。端で方向線がないときは少し内側で測る
function cubicTan(a, b, c, e, t) {
  let d = cubicD(a, b, c, e, t);
  if (vlen(d) < 1e-9) d = cubicD(a, b, c, e, t < 0.5 ? 0.001 : 0.999);
  if (vlen(d) < 1e-9) d = vsub(e, a);
  const L = vlen(d);
  return L < 1e-12 ? P(1, 0) : vmul(d, 1 / L);
}
const perpL = (v) => P(-v.y, v.x);   // 左に 90°（rotateFn で角度を少し増やしたときに点が動く向き）
function lineX(p, v, q, w) {          // 直線 p+s·v と q+u·w の交点
  const den = v.x * w.y - v.y * w.x;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q.x - p.x) * w.y - (q.y - p.y) * w.x) / den;
  return P(p.x + v.x * s, p.y + v.y * s);
}

// ---- 縫い代（閉じたサブパスを外側へ d pt ずらす） ----
function seamOffsetSub(sb, d) {
  const N = sb.nodes.length;
  if (!sb.closed || N < 2) throw new Error('縫い代は閉じたパスにしか付けられません');
  const tol = SEAM_TOL_MM * PT_PER_MM;
  // 外側の向き：最初の線の途中から少しずらして、内側に入るかどうかで決める
  const poly = polyFromSub(sb);
  const s0 = Geo.seg(sb, 0), m0 = cubicAt(...s0, 0.5), t0 = cubicTan(...s0, 0.5);
  const side = pointInPoly(vadd(m0, vmul(perpL(t0), 0.5)), poly) ? -1 : 1;
  const nrm = (a, b, c, e, t) => vmul(perpL(cubicTan(a, b, c, e, t)), side * d);
  // 線1本をずらす（曲線はずれが大きければ半分に分けて、もう一度）
  const offSeg = (a, b, c, e, line, depth, out) => {
    const n0 = nrm(a, b, c, e, 0), n1 = nrm(a, b, c, e, 1);
    const q = [vadd(a, n0), vadd(b, n0), vadd(c, n1), vadd(e, n1)];
    if (line) { out.push({ q0: q[0], q1: null, q2: null, q3: q[3] }); return; }
    let err = 0;
    for (const t of [0.25, 0.5, 0.75]) err = Math.max(err, vdist(cubicAt(...q, t), vadd(cubicAt(a, b, c, e, t), nrm(a, b, c, e, t))));
    if (err > tol && depth < 6) {
      const [l, r] = splitCubic(a, b, c, e, 0.5);
      offSeg(...l, false, depth + 1, out); offSeg(...r, false, depth + 1, out);
      return;
    }
    out.push({ q0: q[0], q1: vdist(q[1], q[0]) < 1e-9 ? null : q[1], q2: vdist(q[2], q[3]) < 1e-9 ? null : q[2], q3: q[3] });
  };
  const groups = [];
  for (let i = 0; i < N; i++) { const out = []; offSeg(...Geo.seg(sb, i), Geo.isLine(sb, i), 0, out); groups.push(out); }
  // 角のつなぎ：ずらした線どうしが離れていたら、延長して交わる点（マイター）でつなぐ
  const join = [];
  for (let k = 0; k < N; k++) {
    const pl = groups[(k - 1 + N) % N], last = pl[pl.length - 1], first = groups[k][0];
    if (vdist(last.q3, first.q0) < 1e-3) { first.q0 = last.q3; join.push(1); continue; }
    const tin = vsub(last.q3, last.q2 || last.q0), tout = vsub(first.q1 || first.q3, first.q0);
    const M = lineX(last.q3, tin, first.q0, tout);
    if (M && vdist(M, sb.nodes[k]) <= d * 4) {
      const di = vsub(M, last.q3), dout = vsub(M, first.q0);
      if (last.q2) last.q2 = vadd(last.q2, di);
      if (first.q1) first.q1 = vadd(first.q1, dout);
      last.q3 = M; first.q0 = M; join.push(1);
    } else join.push(2);
  }
  const nodes = [];
  for (let k = 0; k < N; k++) {
    const pl = groups[(k - 1 + N) % N], last = pl[pl.length - 1], segs = groups[k];
    if (join[k] === 1) nodes.push(mkNode(segs[0].q0.x, segs[0].q0.y, last.q2, segs[0].q1));
    else { nodes.push(mkNode(last.q3.x, last.q3.y, last.q2, null)); nodes.push(mkNode(segs[0].q0.x, segs[0].q0.y, null, segs[0].q1)); }
    for (let j = 1; j < segs.length; j++) nodes.push(mkNode(segs[j].q0.x, segs[j].q0.y, segs[j - 1].q2, segs[j].q1));
  }
  const out = { nodes: nodes.map((n) => mkNode(n.x, n.y, n.hin ? P(n.hin.x, n.hin.y) : null, n.hout ? P(n.hout.x, n.hout.y) : null)), closed: true };
  normalizeSub(out);
  return out;
}

// ---- 切り開き ----
const patRoleOf = (it) => (it.pat && it.pat.role) || '';

// 型紙（グループ）の中の線と、その上にある切り開き線を集める
function spreadTargets(group) {
  const items = leaves([group]);
  const sew = items.find((it) => patRoleOf(it) === 'sew' && it.subs.some((s) => s.closed));
  const cut = items.find((it) => patRoleOf(it) === 'cut' && it.subs.some((s) => s.closed));
  const base = sew || cut;
  if (!base) return { error: '縫い線か輪郭（閉じたパスで、役割を決めたもの）がありません' };
  const tol = 15 * PT_PER_MM;
  const near = (it) => {
    const sb = it.subs[0];
    if (!sb || sb.nodes.length < 2) return false;
    const a = sb.nodes[0], b = sb.nodes[sb.nodes.length - 1];
    return Geo.nearest(base, a).d <= tol && Geo.nearest(base, b).d <= tol;
  };
  // グループの外に引いた切り開き線も、両端がこの型紙の上にあれば使う
  const slashes = items.filter((it) => patRoleOf(it) === 'slash');
  for (const it of allItems()) if (patRoleOf(it) === 'slash' && !slashes.includes(it) && near(it)) slashes.push(it);
  return { items, sew, cut, base, slashes };
}

// group を切り開く。openPt：切り開き線1本あたりの開く量（開く側の端で、pt）、seamPt：縫い代（pt）
function spreadPiece(group, openPt, seamPt) {
  const tg = spreadTargets(group);
  if (tg.error) throw new Error(tg.error);
  const { base, sew, cut } = tg;
  if (!tg.slashes.length) throw new Error('切り開き線がありません（直線を引いて、役割を「切り開き線」にしてください）');
  if (!(openPt > 0)) throw new Error('開く量を 0 より大きくしてください');
  // 失敗しても型紙が変わらないよう、写しの上で計算し、最後にまとめて書き戻す
  const sb0 = base.subs.find((s) => s.closed);
  const cpP = (q) => (q ? P(q.x, q.y) : null);
  const keepNid = (m, n) => { if (n.nid) m.nid = n.nid; return m; };   // 寸法がくっついているアンカーの目印を引き継ぐ
  const sb = { nodes: sb0.nodes.map((n) => keepNid(mkNode(n.x, n.y, cpP(n.hin), cpP(n.hout), n.smooth), n)), closed: true };
  const tmp = { subs: [sb] };
  const EPS = 0.05 * PT_PER_MM;

  // 切り開き線の両端を縫い線の上に乗せ、そこにアンカーを入れる
  const sl = tg.slashes.map((it) => {
    const n = it.subs[0].nodes;
    return { it, H: P(n[0].x, n[0].y), W: P(n[n.length - 1].x, n[n.length - 1].y) };
  });
  for (const s of sl) {
    for (const k of ['H', 'W']) {
      const nr = Geo.nearest(tmp, s[k]);
      if (nr.d > 15 * PT_PER_MM) throw new Error('切り開き線の端が、縫い線（輪郭）から離れすぎています');
      const hit = sb.nodes.find((nd) => vdist(nd, nr.pt) < EPS);
      if (hit) s[k] = P(hit.x, hit.y);
      else { insertNode(tmp, 0, nr.seg, nr.t); s[k] = P(nr.pt.x, nr.pt.y); }
    }
    if (vdist(s.H, s.W) < 1) throw new Error('切り開き線が短すぎます');
  }
  // 切り開き線の並び順と、どちら側が「先」か
  let dv = P(0, 0);
  for (const s of sl) { let v = vsub(s.W, s.H); v = vmul(v, 1 / vlen(v)); if (dv.x * v.x + dv.y * v.y < 0) v = vmul(v, -1); dv = vadd(dv, v); }
  const u = perpL(vmul(dv, 1 / vlen(dv)));
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  sl.sort((a, b) => dot(vlerp(a.H, a.W, 0.5), u) - dot(vlerp(b.H, b.W, 0.5), u));
  for (const s of sl) {
    let n = perpL(vsub(s.W, s.H)); n = vmul(n, 1 / vlen(n));
    if (dot(n, u) < 0) n = vmul(n, -1);
    s.n = n;
    s.ang = 2 * Math.asin(Math.min(1, openPt / 2 / vdist(s.H, s.W)));
    s.sg = dot(perpL(vsub(s.H, s.W)), n) > 0 ? 1 : -1;   // 「先」の区画を開く向きの回転
  }
  const sectionOf = (p) => sl.reduce((c, s) => c + (dot(vsub(p, s.H), s.n) > 0 ? 1 : 0), 0);
  // 動かさない区画：布目線のあるところ
  const grain = tg.items.find((it) => patRoleOf(it) === 'grain');
  const gm = grain && grain.subs[0] && grain.subs[0].nodes.length ? vlerp(grain.subs[0].nodes[0], grain.subs[0].nodes[grain.subs[0].nodes.length - 1], 0.5) : null;
  const fixed = gm ? sectionOf(gm) : 0;
  // 区画ごとの動かし方
  const T = [];
  T[fixed] = (q) => P(q.x, q.y);
  for (let k = fixed + 1; k <= sl.length; k++) { const s = sl[k - 1], R = rotateFn(s.W, s.sg * s.ang), prev = T[k - 1]; T[k] = (q) => prev(R(q)); }
  for (let k = fixed - 1; k >= 0; k--) { const s = sl[k], R = rotateFn(s.W, -s.sg * s.ang), next = T[k + 1]; T[k] = (q) => next(R(q)); }
  const mapP = (f, q) => (q ? f(q) : null);

  // 縫い線（輪郭）を組み直す
  const N = sb.nodes.length;
  const isPivot = (nd) => sl.some((s) => vdist(s.W, nd) < EPS);
  const segMid = (i) => cubicAt(...Geo.seg(sb, (i + N) % N), 0.5);
  const out = [], smoothIdx = [];
  for (let i = 0; i < N; i++) {
    const nd = sb.nodes[i];
    const sIn = sectionOf(segMid(i - 1)), sOut = sectionOf(segMid(i));
    if (sIn === sOut) {
      const f = T[sIn], p = f(nd);
      out.push(keepNid(mkNode(p.x, p.y, mapP(f, nd.hin), mapP(f, nd.hout), nd.smooth), nd));
    } else if (isPivot(nd)) {
      const p = T[sIn](nd);
      out.push(keepNid(mkNode(p.x, p.y, mapP(T[sIn], nd.hin), mapP(T[sOut], nd.hout)), nd));
      smoothIdx.push(out.length - 1);
    } else {
      const a = T[sIn](nd), b = T[sOut](nd);
      out.push(keepNid(mkNode(a.x, a.y, mapP(T[sIn], nd.hin), null), nd)); smoothIdx.push(out.length - 1);
      out.push(mkNode(b.x, b.y, null, mapP(T[sOut], nd.hout))); smoothIdx.push(out.length - 1);
    }
  }
  // 開いたところと支点を、なめらかにつなぐ
  const M = out.length;
  for (const i of smoothIdx) {
    const nd = out[i], pv = out[(i - 1 + M) % M], nx = out[(i + 1) % M];
    let dir;
    if (nd.hin && nd.hout) {
      const a = vsub(nd, nd.hin), b = vsub(nd.hout, nd);
      dir = vadd(vmul(a, 1 / (vlen(a) || 1)), vmul(b, 1 / (vlen(b) || 1)));
    } else dir = vsub(nx, pv);
    if (vlen(dir) < 1e-9) continue;
    dir = vmul(dir, 1 / vlen(dir));
    const li = nd.hin ? vdist(nd.hin, nd) : vdist(nd, pv) / 3, lo = nd.hout ? vdist(nd.hout, nd) : vdist(nx, nd) / 3;
    nd.hin = vsub(nd, vmul(dir, li)); nd.hout = vadd(nd, vmul(dir, lo));
  }
  const nsb = { nodes: out, closed: true };
  normalizeSub(nsb);
  // 輪郭（裁断線）も、書き戻す前に作っておく（縫い代 0 なら作らない）
  const cutSub = sew && seamPt > 0 ? seamOffsetSub(nsb, seamPt) : null;

  // ---- ここから型紙に書き戻す（この先はエラーにならない） ----
  sb0.nodes = nsb.nodes;

  // ほかの線（内部線・布目線・ノッチ）は、のっている区画ごとそのまま動かす
  for (const it of tg.items) {
    if (it === base || tg.slashes.includes(it) || (sew && it === cut)) continue;
    const pts = it.subs.flatMap((s) => s.nodes);
    if (!pts.length) continue;
    const c = pts.reduce((a, p) => vadd(a, vmul(p, 1 / pts.length)), P(0, 0));
    mapItem(it, T[sectionOf(c)]);
  }
  // 切り開き線は使い終わったので消す
  for (const s of sl) removeItem(s.it.id);
  // 輪郭（裁断線）を、新しい縫い線から作り直す
  //   輪郭がまだなければ、縫い線のすぐ下に新しく作る
  if (cutSub) {
    if (cut) cut.subs = [cutSub];
    else {
      const f = findItem(sew.id);
      if (f) f.parent.splice(f.index, 0, { id: uid(), subs: [cutSub], fill: null, stroke: '#000000', sw: 1, rule: 'nonzero', hidden: false, locked: false, pat: { role: 'cut' } });
    }
  }
  return { count: sl.length, deg: (sl[0].ang * 180) / Math.PI };
}
