'use strict';
// 曲線の長さ・いちばん外側の点・円弧の判定（イラレCAD とアパレルCAD で同じ中身を使う。ほかのファイルに頼らない）
//   パスの形：sub = { nodes:[{ x, y, hin:{x,y}|null, hout:{x,y}|null, nid? }], closed }
//   hin / hout は絶対座標の制御点。nid はアンカーの目印（寸法などから参照するときだけ付ける）
const CurveLen = (() => {
  // 5 点の Gauss-Legendre（区間 [0,1] に直したもの）
  const GX = [0.0469100770306680, 0.2307653449471585, 0.5, 0.7692346550528415, 0.9530899229693320];
  const GW = [0.1184634425280945, 0.2393143352496832, 0.2844444444444444, 0.2393143352496832, 0.1184634425280945];
  const PIECES = 8;   // 1 区間を 8 つに分けてそれぞれ積分（ふつうの曲線で 0.001mm より細かい）

  const segCount = (sb) => { const n = sb.nodes.length; return n < 2 ? 0 : sb.closed ? n : n - 1; };
  function seg(sb, i) {
    const n = sb.nodes, a = n[i], b = n[(i + 1) % n.length];
    return [a, a.hout || a, b.hin || b, b];
  }
  const isLine = (q) => q[1] === q[0] && q[2] === q[3];
  function at(q, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * q[0].x + b * q[1].x + c * q[2].x + d * q[3].x, y: a * q[0].y + b * q[1].y + c * q[2].y + d * q[3].y };
  }
  // 1 回微分（接線の向き）
  function d1(q, t) {
    const u = 1 - t;
    return {
      x: 3 * (u * u * (q[1].x - q[0].x) + 2 * u * t * (q[2].x - q[1].x) + t * t * (q[3].x - q[2].x)),
      y: 3 * (u * u * (q[1].y - q[0].y) + 2 * u * t * (q[2].y - q[1].y) + t * t * (q[3].y - q[2].y)),
    };
  }
  // 区間 q の t0〜t1 の長さ
  function lenT(q, t0, t1) {
    if (isLine(q)) return Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) * (t1 - t0);
    let L = 0;
    const h = (t1 - t0) / PIECES;
    for (let k = 0; k < PIECES; k++) {
      const a = t0 + k * h;
      for (let g = 0; g < 5; g++) { const v = d1(q, a + GX[g] * h); L += GW[g] * h * Math.hypot(v.x, v.y); }
    }
    return L;
  }
  const segLength = (q) => lenT(q, 0, 1);
  const subLength = (sb) => { let L = 0; for (let i = 0; i < segCount(sb); i++) L += segLength(seg(sb, i)); return L; };

  // アンカー i から j まで、前へ進む向きの区間の番号。閉じたパスで i === j なら一周
  //   開いたパスで j < i なら入れ替える（長さは同じ）
  function range(sb, i, j) {
    const n = sb.nodes.length, out = [];
    if (!sb.closed) { if (j < i) [i, j] = [j, i]; for (let k = i; k < j; k++) out.push(k); return out; }
    let k = i;
    do { out.push(k); k = (k + 1) % n; } while (k !== j);
    return out;
  }
  const rangeLength = (sb, segs) => segs.reduce((L, k) => L + segLength(seg(sb, k)), 0);
  // 区間をたどって、はじめから長さ L の点と接線（単位ベクトル）
  function pointAt(sb, segs, L) {
    let rest = Math.max(0, L);
    for (let m = 0; m < segs.length; m++) {
      const q = seg(sb, segs[m]), sl = segLength(q);
      if (rest > sl && m < segs.length - 1) { rest -= sl; continue; }
      let lo = 0, hi = 1;
      for (let r = 0; r < 40; r++) { const mid = (lo + hi) / 2; if (lenT(q, 0, mid) < rest) lo = mid; else hi = mid; }
      const t = (lo + hi) / 2, v = d1(q, t), l = Math.hypot(v.x, v.y);
      const tan = l > 1e-12 ? { x: v.x / l, y: v.y / l } : (() => { const w = { x: q[3].x - q[0].x, y: q[3].y - q[0].y }, k = Math.hypot(w.x, w.y) || 1; return { x: w.x / k, y: w.y / k }; })();
      return { p: at(q, t), tan, seg: segs[m], t };
    }
    return null;
  }
  // 区間を折れ線に（表示用）
  function polyline(sb, segs, N = 24) {
    const out = [];
    segs.forEach((k, m) => {
      const q = seg(sb, k);
      const nn = isLine(q) ? 1 : N;
      for (let s = m ? 1 : 0; s <= nn; s++) out.push(at(q, s / nn));
    });
    return out;
  }

  // 区間の中の、x・y がいちばん大きい／小さいところ（両端は除く）：[{ t, ax:'x'|'y', sd:'max'|'min', p }]
  function extrema(q) {
    if (isLine(q)) return [];
    const out = [];
    for (const ax of ['x', 'y']) {
      const p0 = q[0][ax], p1 = q[1][ax], p2 = q[2][ax], p3 = q[3][ax];
      // 微分 = 3[(a)t² + (b)t + c]
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
      const ts = [];
      if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
      else { const D = b * b - 4 * a * c; if (D >= 0) { const s = Math.sqrt(D); ts.push((-b + s) / (2 * a), (-b - s) / (2 * a)); } }
      for (const t of ts) {
        if (!(t > 1e-3 && t < 1 - 1e-3)) continue;
        const dd = 2 * a * t + b;   // 2 回微分の符号
        if (Math.abs(dd) < 1e-12) continue;
        out.push({ t, ax, sd: dd < 0 ? 'max' : 'min', p: at(q, t) });
      }
    }
    return out;
  }

  // 区間が円弧なら { c, r }（1 本のベジェで描いた円弧を想定。ずれが半径の 0.3% 以内）
  function arcFit(q) {
    if (isLine(q)) return null;
    const A = q[0], B = at(q, 0.5), C = q[3];
    const c = circle3(A, B, C);
    if (!c) return null;
    const tolr = Math.max(c.r * 0.003, 1e-4);
    for (let k = 1; k < 16; k++) { const p = at(q, k / 16); if (Math.abs(Math.hypot(p.x - c.c.x, p.y - c.c.y) - c.r) > tolr) return null; }
    return c;
  }
  function circle3(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { c: { x, y }, r: Math.hypot(a.x - x, a.y - y) };
  }
  // パス全体が 1 つの円（どの区間も同じ中心・半径の円弧）なら { c, r }
  function circleOf(sb) {
    if (!sb.closed || segCount(sb) < 2) return null;
    let first = null;
    for (let i = 0; i < segCount(sb); i++) {
      const f = arcFit(seg(sb, i));
      if (!f) return null;
      if (!first) { first = f; continue; }
      const tl = Math.max(first.r * 0.003, 1e-4);
      if (Math.hypot(f.c.x - first.c.x, f.c.y - first.c.y) > tl || Math.abs(f.r - first.r) > tl) return null;
    }
    return first;
  }

  // 目印 nid のアンカーを探す：{ s, i } または null
  function findNode(item, nid) {
    for (let s = 0; s < item.subs.length; s++) {
      const ns = item.subs[s].nodes;
      for (let i = 0; i < ns.length; i++) if (ns[i].nid === nid) return { s, i };
    }
    return null;
  }

  return { segCount, seg, at, d1, lenT, segLength, subLength, range, rangeLength, pointAt, polyline, extrema, arcFit, circleOf, findNode };
})();
