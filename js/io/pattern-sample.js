'use strict';
// アパレルCAD：見本の型紙（タイトスカートの前・後ろ、半身）
// AAMA DXF の書き出しを試すためのもの。寸法は mm で書いて pt に直す（y は下向き）

function patternSampleDoc(opts = {}) {
  const names = opts.ascii ? ['FRONT', 'BACK'] : ['前スカート', '後ろスカート'];
  const K = PT_PER_MM;
  const W = 900, Hh = 700;   // アートボード（mm）。切り開いて広げても重ならないよう、横は広め
  const d = newDoc();
  d.width = W * K; d.height = Hh * K;
  const L = d.layers[0];
  L.name = '型紙';
  // 1枚分を作る。mirror：左右を反転、ox・oy：置く位置（mm）
  const piece = (name, ox, oy, mirror) => {
    const tf = (x, y) => P((ox + (mirror ? 245 - x : x)) * K, (oy + y) * K);
    const node = (x, y, hin, hout) => mkNode(tf(x, y).x, tf(x, y).y, hin ? tf(hin[0], hin[1]) : null, hout ? tf(hout[0], hout[1]) : null);
    const path = (nodes, closed, role, stroke, sw) => {
      const sb = { nodes, closed };
      normalizeSub(sb);
      return { id: uid(), subs: [sb], fill: null, stroke, sw, rule: 'nonzero', hidden: false, locked: false, pat: { role } };
    };
    // 縫い線（でき上がり線）：中心のウエスト → 脇のウエスト → 腰（ヒップ）→ 裾 → 中心
    const sew = path([
      node(0, 10, null, [80, 10]),
      node(230, 0, [160, 6], [238, 60]),
      node(245, 190, [245, 120], [245, 250]),
      node(245, 600),
      node(0, 600),
    ], true, 'sew', '#888888', 0.5);
    // 輪郭（裁断線）：縫い線のおよそ 10mm 外（角はマイター）。
    // いまのパスのオフセットは細かい直線の集まりになるので、見本では手で引いた曲線にしている
    const cut = path([
      node(-10, 0, null, [80, 0]),
      node(238.65, -10.77, [160, -4], [248, 59]),
      node(255, 190, [255, 120], [255, 250]),
      node(255, 610),
      node(-10, 610),
    ], true, 'cut', '#000000', 1);
    const dart = path([node(93, 8), node(103, 110), node(113, 7)], false, 'internal', '#2f6fff', 0.75);
    const grain = path([node(60, 150), node(60, 520)], false, 'grain', '#e03030', 0.75);
    // ノッチ：腰の高さ（脇と中心）。輪郭の上の点から内側へ 5mm
    const n1 = path([node(255, 190), node(250, 190)], false, 'notch', '#000000', 1);
    const n2 = path([node(-10, 190), node(-5, 190)], false, 'notch', '#000000', 1);
    return { type: 'group', id: uid(), name, pat: { name, qty: 1 }, hidden: false, locked: false, children: [cut, sew, dart, grain, n1, n2] };
  };
  L.items.push(piece(names[0], 30, 50, false), piece(names[1], 520, 50, true));
  return d;
}
