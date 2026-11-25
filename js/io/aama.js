'use strict';
// アパレルCAD：AAMA DXF（ASTM D6673 と同じ考え方の型紙用 DXF）の書き出し
//
// 型紙のまとめ方
//   ・1つのグループ ＝ 1枚の型紙（パーツ）。グループに入っていない閉じたパスも、それだけで1枚
//   ・グループに入っていない開いたパス（ノッチや布目線など）は、その線が上にある型紙に入れる
//   ・パスの役割は item.pat.role：'cut' 輪郭（裁断線）／'sew' 縫い線／'internal' 内部線／'grain' 布目線／'notch' ノッチ／'slash' 切り開き線（書き出さない）
//     役割がないときは、いちばん大きい閉じたパスを輪郭、ほかを内部線とみなす
//   ・パーツ名と枚数は、グループ（またはパス）の pat.name・pat.qty。名前がなければグループ名
//
// DXF の中身（AutoCAD R12 の文字の DXF。単位 mm、y は上向き、原点はアートボードの左下）
//   1 輪郭（POLYLINE、始点と終点を同じ点にして閉じる）＋パーツ名などの文字
//   2 角の点（POINT）　3 曲線の点（POINT）　4 ノッチ（POINT、または線）
//   7 布目線（LINE）　8 内部線（POLYLINE）　14 縫い線（POLYLINE）
//   型紙ごとに BLOCK を作り、ENTITIES で INSERT する

const AAMA_LAYERS = { cut: '1', turn: '2', curve: '3', notch: '4', grain: '7', internal: '8', sew: '14' };
const PAT_ROLES = [
  ['', '自動'], ['cut', '輪郭（裁断線）'], ['sew', '縫い線'],
  ['internal', '内部線'], ['grain', '布目線'], ['notch', 'ノッチ（合印）'],
  ['slash', '切り開き線（書き出さない）'],
];
const FLAT_TOL_MM = 0.02;      // 曲線を折れ線にするときの許容のずれ（mm）

// ---- 曲線を折れ線に（アンカーは角か曲線かの印を付けて残す） ----
// 戻り値：[{ x, y, kind:'turn'|'curve' }]（pt・アートボードの座標のまま）
function aamaFlatten(sb) {
  const out = [];
  const tol = FLAT_TOL_MM * PT_PER_MM;
  const cnt = Geo.segCount(sb);
  const kindOf = (n) => (n.smooth ? 'curve' : 'turn');
  if (!cnt) return sb.nodes.map((n) => ({ x: n.x, y: n.y, kind: 'turn' }));
  const flat = (p0, p1, p2, p3) => {
    const L = vdist(p0, p3);
    const d = (q) => (L < 1e-9 ? vdist(q, p0) : Math.abs((p3.x - p0.x) * (p0.y - q.y) - (p0.x - q.x) * (p3.y - p0.y)) / L);
    return Math.max(d(p1), d(p2)) <= tol;
  };
  const sub = (p0, p1, p2, p3, depth) => {
    if (depth > 12 || flat(p0, p1, p2, p3)) { out.push({ x: p3.x, y: p3.y, kind: 'curve' }); return; }
    const [a, b] = splitCubic(p0, p1, p2, p3, 0.5);
    sub(a[0], a[1], a[2], a[3], depth + 1); sub(b[0], b[1], b[2], b[3], depth + 1);
  };
  const N = sb.nodes.length;
  out.push({ x: sb.nodes[0].x, y: sb.nodes[0].y, kind: sb.closed || N < 2 ? kindOf(sb.nodes[0]) : 'turn' });
  for (let i = 0; i < cnt; i++) {
    const s = Geo.seg(sb, i);
    if (!Geo.isLine(sb, i)) sub(s[0], s[1], s[2], s[3], 0);
    else out.push({ x: s[3].x, y: s[3].y, kind: 'curve' });
    // 区切りのアンカーは、なめらかでなければ角
    const ni = (i + 1) % N, last = out[out.length - 1];
    const isEnd = !sb.closed && ni === N - 1;
    last.kind = isEnd ? 'turn' : kindOf(sb.nodes[ni]);
  }
  if (sb.closed) out.pop();   // 始点に戻った点は除く（閉じるときに始点をもう一度書く）
  return out;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
function distToPoly(p, pts, closed) {
  let best = Infinity;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const v = vsub(b, a), L2 = v.x * v.x + v.y * v.y;
    const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / L2));
    best = Math.min(best, vdist(p, P(a.x + v.x * t, a.y + v.y * t)));
  }
  return best;
}
function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---- ドキュメントから型紙を集める ----
// 戻り値：[{ name, qty, size, items:[{ it, role }], cut:[{x,y,kind}] }]、warnings
function collectPieces(d) {
  const pieces = [], loose = [], warnings = [];
  for (const L of d.layers) {
    if (!L.visible) continue;
    for (const n of L.items) {
      if (n.hidden) continue;
      if (isGroup(n)) {
        const its = leaves([n]).filter((it) => !it.hidden);
        if (its.length) pieces.push({ node: n, items: its });
      } else if (n.pat && n.pat.role && n.pat.role !== 'cut') loose.push(n);
      else if (n.subs.some((sb) => sb.closed)) pieces.push({ node: n, items: [n] });
      else loose.push(n);
    }
  }
  // 役割を決めて、輪郭を折れ線にする
  for (const pc of pieces) {
    const roles = pc.items.map((it) => (it.pat && it.pat.role) || '');
    let cutIdx = roles.indexOf('cut');
    if (cutIdx < 0) {
      let best = -1;
      pc.items.forEach((it, i) => {
        if (roles[i]) return;
        const sb = it.subs.find((s) => s.closed && s.nodes.length >= 2);
        if (!sb) return;
        const a = polyArea(aamaFlatten(sb));
        if (a > best) { best = a; cutIdx = i; }
      });
    }
    pc.roles = roles.map((r, i) => (i === cutIdx ? 'cut' : r || 'internal'));
    const cutIt = cutIdx >= 0 ? pc.items[cutIdx] : null;
    const cutSub = cutIt && cutIt.subs.find((s) => s.closed && s.nodes.length >= 2);
    pc.cut = cutSub ? aamaFlatten(cutSub) : null;
  }
  const valid = pieces.filter((pc) => pc.cut);
  pieces.filter((pc) => !pc.cut).forEach(() => warnings.push('輪郭（閉じたパス）のないグループを飛ばしました'));
  // グループに入っていない開いたパスを、上にある型紙に入れる
  for (const it of loose) {
    const sb = it.subs.find((s) => s.nodes.length);
    if (!sb) continue;
    const p0 = sb.nodes[0], p1 = sb.nodes[sb.nodes.length - 1];
    let host = null, bestD = Infinity;
    for (const pc of valid) {
      const inside = pointInPoly(p0, pc.cut) || pointInPoly(p1, pc.cut);
      const dd = Math.min(distToPoly(p0, pc.cut, true), distToPoly(p1, pc.cut, true));
      const score = inside ? 0 : dd;
      if (score < bestD) { bestD = score; host = pc; }
    }
    if (host && bestD < 10 * PT_PER_MM) { host.items.push(it); host.roles.push((it.pat && it.pat.role) || 'internal'); }
    else warnings.push('どの型紙にも重ならない線を1本飛ばしました');
  }
  // 名前と枚数
  const used = new Set();
  valid.forEach((pc, i) => {
    const meta = pc.node.pat || {};
    let name = String(meta.name || pc.node.name || '').trim() || 'PIECE' + (i + 1);
    let base = name, k = 2;
    while (used.has(name)) name = base + '_' + k++;
    used.add(name);
    pc.name = name;
    pc.qty = Math.max(1, Math.round(meta.qty || 1));
  });
  return { pieces: valid, warnings };
}

// ---- Shift_JIS にする（ブラウザの TextDecoder から逆引きの表を作る） ----
let SJIS_MAP = null;
function sjisMap() {
  if (SJIS_MAP) return SJIS_MAP;
  SJIS_MAP = new Map();
  const dec = new TextDecoder('shift_jis');
  for (let b = 0xa1; b <= 0xdf; b++) SJIS_MAP.set(dec.decode(new Uint8Array([b])), [b]);   // 半角カナ
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const a of leads) {
    for (let b = 0x40; b <= 0xfc; b++) {
      if (b === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== '�' && !SJIS_MAP.has(ch)) SJIS_MAP.set(ch, [a, b]);
    }
  }
  return SJIS_MAP;
}
function encodeText(text, encoding) {
  if (encoding === 'utf8') return new TextEncoder().encode(text);
  const m = /[^\x00-\x7f]/.test(text) ? sjisMap() : null;
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) { out.push(c); continue; }
    const b = m.get(ch);
    if (b) out.push(...b); else out.push(0x3f);   // Shift_JIS にない文字は「?」
  }
  return new Uint8Array(out);
}

// ---- DXF を組み立てる ----
// opts：{ notch:'point'|'line', encoding:'sjis'|'utf8'|'ascii', styleName, sampleSize, date }
function buildAamaDxf(d, opts = {}) {
  const notchMode = opts.notch || 'point';
  const encoding = opts.encoding || 'sjis';
  const { pieces, warnings } = collectPieces(d);
  const H = d.height;
  const mm = (p) => ({ x: p.x / PT_PER_MM, y: (H - p.y) / PT_PER_MM });
  const num = (v) => { const r = Math.round(v * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toFixed(3); };
  const L = [];
  const g = (code, val) => { L.push(String(code).padStart(3, ' ')); L.push(String(val)); };
  const point = (layer, p) => { g(0, 'POINT'); g(8, layer); g(10, num(p.x)); g(20, num(p.y)); g(30, '0.000'); };
  const line = (layer, a, b) => { g(0, 'LINE'); g(8, layer); g(10, num(a.x)); g(20, num(a.y)); g(30, '0.000'); g(11, num(b.x)); g(21, num(b.y)); g(31, '0.000'); };
  const polyline = (layer, pts, closed) => {
    const q = closed ? pts.concat([pts[0]]) : pts;   // 閉じた線は始点をもう一度書く（AAMA のならわし）
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, '0.000'); g(20, '0.000'); g(30, '0.000'); g(70, 0);
    for (const p of q) { g(0, 'VERTEX'); g(8, layer); g(10, num(p.x)); g(20, num(p.y)); g(30, '0.000'); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const text = (layer, p, s, h = 5) => { g(0, 'TEXT'); g(8, layer); g(10, num(p.x)); g(20, num(p.y)); g(30, '0.000'); g(40, num(h)); g(1, s); };

  // 全体の範囲
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pieces.forEach((pc) => pc.cut.forEach((p) => { const q = mm(p); minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }));
  if (!pieces.length) { minX = minY = maxX = maxY = 0; }

  // HEADER
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  if (encoding === 'sjis') { g(9, '$DWGCODEPAGE'); g(3, 'ANSI_932'); }
  g(9, '$INSBASE'); g(10, '0.000'); g(20, '0.000'); g(30, '0.000');
  g(9, '$EXTMIN'); g(10, num(minX)); g(20, num(minY)); g(30, '0.000');
  g(9, '$EXTMAX'); g(10, num(maxX)); g(20, num(maxY)); g(30, '0.000');
  g(0, 'ENDSEC');
  // TABLES（画層の一覧）
  const layerNames = ['0', ...new Set(Object.values(AAMA_LAYERS))];
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layerNames.length);
  layerNames.forEach((nm, i) => { g(0, 'LAYER'); g(2, nm); g(70, 0); g(62, i ? ((i - 1) % 7) + 1 : 7); g(6, 'CONTINUOUS'); });
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // BLOCKS（型紙ごと）
  const blockNames = [];
  g(0, 'SECTION'); g(2, 'BLOCKS');
  pieces.forEach((pc, i) => {
    // ブロック名は半角英数字だけにする（日本語の名前は「Piece Name:」の文字で渡す）
    const ascii = /^[A-Za-z0-9_\-]+$/.test(pc.name) ? pc.name : 'PIECE' + (i + 1);
    let bn = ascii, k = 2;
    while (blockNames.includes(bn)) bn = ascii + '_' + k++;
    blockNames.push(bn);
    g(0, 'BLOCK'); g(8, '1'); g(2, bn); g(70, 0); g(10, '0.000'); g(20, '0.000'); g(30, '0.000'); g(3, bn);
    // 輪郭と、角・曲線の点
    const cut = pc.cut.map((p) => ({ ...mm(p), kind: p.kind }));
    polyline(AAMA_LAYERS.cut, cut, true);
    cut.forEach((p) => point(p.kind === 'turn' ? AAMA_LAYERS.turn : AAMA_LAYERS.curve, p));
    // ほかの線
    pc.items.forEach((it, j) => {
      const role = pc.roles[j];
      if (role === 'cut' || role === 'slash') return;   // 切り開き線は作図用なので書き出さない
      for (const sb of it.subs) {
        if (sb.nodes.length < 1) continue;
        const pts = aamaFlatten(sb).map(mm);
        if (role === 'grain') {
          const a = mm(sb.nodes[0]), b = mm(sb.nodes[sb.nodes.length - 1]);
          if (vdist(a, b) > 1e-6) line(AAMA_LAYERS.grain, a, b);
        } else if (role === 'notch') {
          // ノッチの位置：輪郭に近いほうの端。線のときは、その端から反対の端へ向けて引く
          const a = sb.nodes[0], b = sb.nodes[sb.nodes.length - 1];
          const da = distToPoly(a, pc.cut, true), db = distToPoly(b, pc.cut, true);
          const [on, toward] = da <= db ? [a, b] : [b, a];
          if (notchMode === 'line' && vdist(on, toward) > 1e-6) line(AAMA_LAYERS.notch, mm(on), mm(toward));
          else point(AAMA_LAYERS.notch, mm(on));
        } else if (pts.length >= 2) {
          polyline(role === 'sew' ? AAMA_LAYERS.sew : AAMA_LAYERS.internal, pts, sb.closed);
        }
      }
    });
    // パーツの情報（輪郭の中ほどに置く）
    const c = cut.reduce((s, p) => ({ x: s.x + p.x / cut.length, y: s.y + p.y / cut.length }), { x: 0, y: 0 });
    text(AAMA_LAYERS.cut, { x: c.x, y: c.y + 8 }, 'Piece Name: ' + pc.name);
    text(AAMA_LAYERS.cut, { x: c.x, y: c.y }, 'Size: ' + (opts.sampleSize || 'M'));
    text(AAMA_LAYERS.cut, { x: c.x, y: c.y - 8 }, 'Quantity: ' + pc.qty);
    g(0, 'ENDBLK'); g(8, '1');
  });
  g(0, 'ENDSEC');

  // ENTITIES：全体の情報と、型紙の配置
  const today = opts.date || new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const tp = { x: minX, y: maxY + 20 };
  [['Style Name: ', opts.styleName || 'STYLE'], ['Creation Date: ', today], ['Sample Size: ', opts.sampleSize || 'M'], ['Units: ', 'METRIC']]
    .forEach(([k, v], i) => text('1', { x: tp.x, y: tp.y + (3 - i) * 8 }, k + v));
  blockNames.forEach((bn) => { g(0, 'INSERT'); g(8, '1'); g(2, bn); g(10, '0.000'); g(20, '0.000'); g(30, '0.000'); });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  const textOut = L.join('\r\n') + '\r\n';
  if (encoding === 'ascii' && /[^\x00-\x7f]/.test(textOut)) warnings.push('半角英数字にない文字は「?」になります');
  return { text: textOut, bytes: encodeText(textOut, encoding === 'ascii' ? 'sjis' : encoding), pieces, warnings };
}

// ---- 書き出し（パネルのボタン） ----
const DXF_TYPE = { description: 'AAMA DXF', accept: { 'application/dxf': ['.dxf'] } };
async function exportAamaFile() {
  if (S.drawing) endDrawing();
  let r;
  try {
    r = buildAamaDxf(doc, { notch: $('patNotchMode').value, encoding: $('patEncoding').value, styleName: baseName(S.fileName) });
  } catch (err) { toast('AAMA DXF を作れませんでした：' + err.message); return; }
  if (!r.pieces.length) { toast('型紙がありません（閉じたパスを1つ以上描いてください）'); return; }
  const name = baseName(S.fileName) + '_AAMA.dxf';
  const h = await writeFile(r.bytes, { name, type: DXF_TYPE, mime: 'application/dxf', handle: null });
  if (h === false) return;
  const w = r.warnings.length ? '（' + [...new Set(r.warnings)].join('・') + '）' : '';
  toast(`型紙 ${r.pieces.length} 枚を書き出しました：${h ? h.name : name}${w}`);
}
