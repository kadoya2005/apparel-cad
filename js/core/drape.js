'use strict';
// アパレルCAD：立体プレビューの形を作る（段階1：布の計算はしない「だいたいの形」）
//
// 考え方
//   ・型紙ごとに、ウエストの線からの距離 s ごとの「横幅」を測る（ウエストから同じ距離の帯の面積 ÷ 帯の幅）。
//     ダーツ（両端が縫い線の上にある、3点以上の開いた内部線）の中は布がないものとして除く。型紙は半身とみなし、2倍して一周の長さにする
//   ・素体はウエスト・ヒップなどの寸法から、だ円の輪切りを重ねて作る
//   ・スカートの輪切りは、素体（腰より下は腰の形）に少しゆとりを足した形。
//     一周の長さが余るぶんは、一部を外へ広げ（張り）、残りを波（ひだ）にして長さを合わせる
// 単位は mm。立体の座標は x 右・y 上（ウエストが 0）・z 前

const DRAPE_BAND = 5;     // 帯の幅（mm）
const DRAPE_GRID = 2.5;   // 面積を数える格子（mm）

// ---- だ円 ----
function ellPerim(a, b) { return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); }
function ellFromPerim(P, q) { const a = P / ellPerim(1, q); return { a, b: a * q }; }

// ---- 型紙を測る ----
// 戻り値：{ widths:[s ごとの一周の長さ(mm)], step, length, hipLen, pieces, warnings }
function drapeMeasure(nodes) {
  const mm = (p) => ({ x: p.x / PT_PER_MM, y: p.y / PT_PER_MM });
  const { pieces, warnings } = collectPieces(doc);
  const use = nodes && nodes.length ? pieces.filter((pc) => nodes.includes(pc.node)) : pieces;
  const bins = [];
  const notchD = [];
  for (const pc of use) {
    const roleOf = (it) => pc.roles[pc.items.indexOf(it)];
    const sewIt = pc.items.find((it) => roleOf(it) === 'sew' && it.subs.some((s) => s.closed && s.nodes.length >= 3));
    const outline = sewIt ? aamaFlatten(sewIt.subs.find((s) => s.closed)).map(mm) : pc.cut.map(mm);
    // 布目線の向き（下向き）。なければ画面の縦
    let g = { x: 0, y: 1 };
    const gIt = pc.items.find((it) => roleOf(it) === 'grain');
    if (gIt) {
      const ns = gIt.subs[0].nodes;
      const v = { x: ns[ns.length - 1].x - ns[0].x, y: ns[ns.length - 1].y - ns[0].y };
      const L = Math.hypot(v.x, v.y);
      if (L > 1e-6) { g = { x: v.x / L, y: v.y / L }; if (g.y < 0) g = { x: -g.x, y: -g.y }; }
    }
    // (u, v) に直す：v は布目に沿って下向き
    const toUV = (p) => ({ x: p.x * g.y - p.y * g.x, y: p.x * g.x + p.y * g.y });
    const poly = outline.map(toUV);
    // ダーツ：内部線のうち、点が 3 つ以上の開いた線で、両端が縫い線の上（3mm 以内）にあり、
    //   先（いちばん奥の点）までの深さが、両端の間の幅より大きいもの。ポケット位置などの線は除く
    const segD = (p, a, b) => {
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
      const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
      return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t);
    };
    const onOutline = (p) => { for (let i = 0; i < outline.length; i++) if (segD(p, outline[i], outline[(i + 1) % outline.length]) <= 3) return true; return false; };
    const isDart = (pts) => {
      if (pts.length < 3) return false;
      const a = pts[0], b = pts[pts.length - 1];
      if (!onOutline(a) || !onOutline(b)) return false;
      const depth = Math.max(...pts.map((p) => segD(p, a, b)));
      return depth > Math.hypot(b.x - a.x, b.y - a.y);
    };
    const darts = pc.items
      .filter((it) => roleOf(it) === 'internal')
      .map((it) => it.subs.find((s) => !s.closed && s.nodes.length >= 3))
      .filter(Boolean)
      .map((sb) => aamaFlatten(sb).map(mm))
      .filter(isDart)
      .map((pts) => pts.map(toUV));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    // ウエストの線：外向きの法線が上を向き、上のほうにある辺
    let area = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p.x * q.y - q.x * p.y; }
    const sgn = area > 0 ? 1 : -1;
    const waist = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      // y 下向きの座標で、反時計回り（area>0）のとき外向き法線は (dy, -dx)/L
      const ny = (sgn * -dx) / L;
      if (ny < -0.5 && Math.max(p.y, q.y) < y0 + 0.35 * (y1 - y0)) waist.push([p, q]);
    }
    if (!waist.length) { warnings.push(`「${pc.name}」のウエストの線が見つからないので、いちばん上から測りました`); waist.push([{ x: x0 - 1e4, y: y0 }, { x: x1 + 1e4, y: y0 }]); }
    const distW = (p) => {
      let best = Infinity;
      for (const [a, b] of waist) {
        const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
        const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
        best = Math.min(best, Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t));
      }
      return best;
    };
    const h = DRAPE_GRID;
    for (let y = y0 + h / 2; y < y1; y += h) {
      // この横の列で、輪郭の内側になる区間を求める（毎点の内外判定より速い）
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil((xs[k] - x0 - h / 2) / h) * h + x0 + h / 2; x < xs[k + 1]; x += h) {   // 格子の中心のうち、区間に入るもの
          const p = { x, y };
          if (darts.some((dp) => pointInPoly(p, dp))) continue;
          const bi = Math.floor(distW(p) / DRAPE_BAND);
          bins[bi] = (bins[bi] || 0) + (h * h) / DRAPE_BAND * 2;   // 半身なので 2 倍
        }
      }
    }
    // ノッチ（合印）のウエストからの距離：腰の高さの目安
    for (let i = 0; i < pc.items.length; i++) {
      if (pc.roles[i] !== 'notch') continue;
      const n0 = pc.items[i].subs[0] && pc.items[i].subs[0].nodes[0];
      if (n0) notchD.push(distW(toUV(mm(n0))));
    }
  }
  const raw = [];
  for (let i = 0; i < bins.length; i++) raw.push(bins[i] || 0);
  // ならす（格子で数えたでこぼこが横じまにならないよう、前後 3 つずつ）
  const widths = raw.map((v, i) => {
    let sum = 0, wt = 0;
    for (let k = -3; k <= 3; k++) {
      const x = raw[i + k];
      if (x == null || (k && Math.abs(x - v) > 0.2 * v)) continue;   // 裾の端は混ぜない
      const w = 4 - Math.abs(k);
      sum += x * w; wt += w;
    }
    return sum / wt;
  });
  // 裾：急に短くなるところで切る
  let n = widths.length;
  let peak = 0;
  for (let i = 0; i < widths.length; i++) {
    peak = Math.max(peak * 0.999, widths[i]);
    if (i > 10 && widths[i] < 0.6 * peak) { n = i; break; }
  }
  widths.length = n;
  // 裾の線がウエストと平行でないぶん、最後の数段は細くなる。それは丈の端なので落とす
  while (widths.length > 12 && widths[widths.length - 1] < 0.97 * widths[widths.length - 3]) widths.pop();
  n = widths.length;
  const near = notchD.filter((d) => d > 100 && d < 280).sort((a, b) => a - b);
  const hipLen = near.length ? near[Math.floor(near.length / 2)] : null;
  return { widths, step: DRAPE_BAND, length: n * DRAPE_BAND, hipLen, pieces: use.length, warnings };
}

// ---- 素体の輪切り ----
// body：{ waist, hip, hipLen }（mm、一周の長さと腰丈）
// 戻り値：{ torso:[{y,a,b}], leg:[{y,a,b,cx}] }
function drapeBodySections(body) {
  const W = body.waist, Hp = body.hip, hy = -body.hipLen;
  const B = Math.max(Hp - 60, W + 120);
  const r = (P, q) => ellFromPerim(P, q);
  const torso = [
    [560, { a: 48, b: 48 }], [470, { a: 58, b: 56 }], [440, { a: 120, b: 80 }],
    [400, { a: 185, b: 85 }], [340, r(B * 0.96, 0.62)], [220, r(B, 0.72)],
    [120, r((B + W) / 2, 0.72)], [0, r(W, 0.72)], [hy * 0.5, r(W * 0.4 + Hp * 0.6, 0.7)],
    [hy, r(Hp, 0.68)], [hy - 55, r(Hp * 0.95, 0.66)], [hy - 95, r(Hp * 0.7, 0.58)], [hy - 110, { a: 25, b: 18 }],
  ].map(([y, e]) => ({ y, a: e.a, b: e.b }));
  const hipA = r(Hp, 0.68).a;
  const leg = [
    [hy - 40, Hp * 0.6, hipA * 0.48], [hy - 200, Hp * 0.52, hipA * 0.44], [hy - 330, Hp * 0.39, hipA * 0.4],
    [hy - 430, Hp * 0.38, hipA * 0.39], [hy - 580, Hp * 0.27, hipA * 0.38], [hy - 680, Hp * 0.23, hipA * 0.38], [hy - 700, Hp * 0.1, hipA * 0.38],
  ].map(([y, P, cx]) => ({ y, ...r(P, 0.92), cx }));
  return { torso, leg };
}

// なめらかにつなぐ（キャットマル–ロム）。keys：y の大きい順
function drapeInterp(keys, y, field) {
  if (y >= keys[0].y) return keys[0][field];
  const last = keys[keys.length - 1];
  if (y <= last.y) return last[field];
  let i = 0;
  while (!(keys[i].y >= y && y >= keys[i + 1].y)) i++;
  const p0 = keys[Math.max(0, i - 1)][field], p1 = keys[i][field], p2 = keys[i + 1][field], p3 = keys[Math.min(keys.length - 1, i + 2)][field];
  const t = (keys[i].y - y) / (keys[i].y - keys[i + 1].y);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// ---- 立体の網（輪切りの列） ----
// 戻り値：{ body:[mesh], skirt:mesh, info }。mesh：{ rings:[[{x,y,z}]], closed:true/false, kind }
function drapeBuild(meas, body, opt) {
  const sec = drapeBodySections(body);
  const hy = -body.hipLen;
  const M = 40;
  const ring = (cx, y, a, b, m) => {
    const out = [];
    for (let j = 0; j < m; j++) { const t = (j / m) * Math.PI * 2; out.push({ x: cx + a * Math.cos(t), y, z: b * Math.sin(t) }); }
    return out;
  };
  const meshes = [];
  // 胴
  const tr = [];
  const top = sec.torso[0].y, bot = sec.torso[sec.torso.length - 1].y;
  for (let y = top; y >= bot - 1e-6; y -= 10) tr.push(ring(0, y, drapeInterp(sec.torso, y, 'a'), drapeInterp(sec.torso, y, 'b'), M));
  meshes.push({ rings: tr, kind: 'body', cap: true });
  // 脚（左右）
  for (const sgn of [-1, 1]) {
    const lr = [];
    const t0 = sec.leg[0].y, t1 = sec.leg[sec.leg.length - 1].y;
    for (let y = t0; y >= t1 - 1e-6; y -= 12) lr.push(ring(sgn * drapeInterp(sec.leg, y, 'cx'), y, drapeInterp(sec.leg, y, 'a'), drapeInterp(sec.leg, y, 'b'), 24));
    meshes.push({ rings: lr, kind: 'body', cap: true });
  }
  // 素体の輪切り（スカートの土台）：腰より下は腰の形のまま
  const baseAt = (y) => {
    const yy = Math.max(y, hy);
    return { a: drapeInterp(sec.torso, yy, 'a'), b: drapeInterp(sec.torso, yy, 'b') };
  };
  const info = { tight: false, waist: meas.widths[0] || 0, hem: meas.widths[meas.widths.length - 1] || 0, length: meas.length };
  if (!meas.widths.length) return { meshes, info };
  const SM = 144, E0 = 3;
  const folds = Math.max(2, Math.round(opt.folds));
  const stiff = opt.stiff;
  const rings = [];
  let y = 0, prevRho = null, prevOff = null;
  const ds = meas.step;
  const shape = (a, b, off, amp) => {
    const pts = [];
    for (let j = 0; j < SM; j++) {
      const t = (j / SM) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const nl = Math.hypot(b * c, a * s);
      const nx = (b * c) / nl, nz = (a * s) / nl;
      // 前中心（t=90°）に山が来ないよう半分ずらす。波の高さは少しだけ不ぞろいにする
      const w = Math.sin(folds * t + Math.PI / 2 + Math.PI / folds) * (1 + 0.12 * Math.sin(3 * t + 1));
      const d = off + amp * w;
      pts.push({ x: a * c + nx * d, z: b * s + nz * d });
    }
    return pts;
  };
  const perim = (pts) => { let L = 0; for (let j = 0; j < pts.length; j++) { const p = pts[j], q = pts[(j + 1) % pts.length]; L += Math.hypot(q.x - p.x, q.z - p.z); } return L; };
  for (let i = 0; i < meas.widths.length; i++) {
    const P = meas.widths[i];
    const guessY = i ? y - ds : 0;
    const { a, b } = baseAt(guessY);
    const basePer = ellPerim(a + E0, b + E0);
    let off = E0, amp = 0;
    let E = P - basePer;
    if (E < 0) {
      // 素体より短い：腰より上なら「きつい」。腰より下は細く絞る（タイトスカートの裾）
      off = E0 + E / (2 * Math.PI);
      if (guessY > hy - 5 && E < -15) info.tight = true;
      if (guessY > hy - 5) off = Math.max(off, 1);
    } else {
      // 少しの余り（〜4cm）はゆとりとして浮かせる。それより多いぶんを、張りの割合で広げ、残りを波にする
      const EASE = 40;
      off = E0 + (Math.min(E, EASE) + stiff * Math.max(0, E - EASE)) / (2 * Math.PI);
      // 布は上から垂れるので、外への広がりは下へ行って縮まない（腰で段がつかないように）
      if (prevOff != null) off = Math.max(off, prevOff);
      const target = P;
      // 波の谷が素体にめり込まない深さまで（腰より上は素体の 1mm 外。腰より下は脚のぶん少し内側まで）。
      // 波（極座標の波）は半径より小さければ交差しないので、深すぎないよう 0.7 倍までにもする
      const dMin = 1 - 18 * Math.max(0, Math.min(1, (hy - 55 - guessY) / 145));
      const WMAX = 1.12;   // 波の形 w のいちばん深いところ
      const ampLim = (o) => Math.max(0, Math.min((Math.min(a, b) + o) * 0.7, (o - dMin) / WMAX));
      let lo = 0, hi = ampLim(off);
      if (perim(shape(a, b, off, hi)) < target) {
        // 波だけでは足りない：外へ広げて、そのぶん深くできる波と合わせて長さを合わせる
        let ol = off, oh = off + (target - perim(shape(a, b, off, hi))) / (2 * Math.PI) + 1;
        for (let k = 0; k < 22; k++) { const m = (ol + oh) / 2; if (perim(shape(a, b, m, ampLim(m))) < target) ol = m; else oh = m; }
        off = (ol + oh) / 2; amp = ampLim(off);
      } else {
        for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (perim(shape(a, b, off, m)) < target) lo = m; else hi = m; }
        amp = (lo + hi) / 2;
      }
    }
    prevOff = E < 0 ? null : off;
    const rho = (a + b) / 2 + off;
    if (i) {
      const dr = prevRho == null ? 0 : rho - prevRho;
      y -= Math.sqrt(Math.max(ds * ds - dr * dr, 0.15 * ds * ds));
    }
    prevRho = rho;
    rings.push(shape(a, b, off, amp).map((p) => ({ x: p.x, y, z: p.z })));
  }
  meshes.push({ rings, kind: 'skirt', cap: false });
  info.hemY = y;
  return { meshes, info };
}
