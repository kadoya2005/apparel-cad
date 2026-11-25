'use strict';
// アパレルCAD：型紙パネル（線の役割・パーツ名・枚数・AAMA DXF 書き出し・見本）

const SLASH_COLOR = '#ff7a00';   // 切り開き線の色

// 選んでいるパスが入っている型紙（いちばん上のグループ。グループでなければそのパス）
function selectedPieceNodes() {
  const out = [];
  for (const it of selectedItems()) {
    const f = findItem(it.id);
    if (!f) continue;
    const n = f.ancestors.length ? f.ancestors[0] : it;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function updatePatternPanel() {
  const items = selectedItems();
  const roles = new Set(items.map((it) => (it.pat && it.pat.role) || ''));
  const sel = $('patRole');
  sel.disabled = !items.length;
  sel.value = roles.size === 1 ? [...roles][0] : '';
  const pcs = selectedPieceNodes();
  for (const id of ['patName', 'patQty']) $(id).disabled = pcs.length !== 1;
  const pc = pcs.length === 1 ? pcs[0] : null;
  if (document.activeElement !== $('patName')) $('patName').value = pc ? (pc.pat && pc.pat.name) || pc.name || '' : '';
  if (document.activeElement !== $('patQty')) $('patQty').value = pc ? (pc.pat && pc.pat.qty) || 1 : '';
}

(function initPatternPanel() {
  $('patRole').innerHTML = PAT_ROLES.map(([v, l]) => `<option value="${v}">${svgEsc(l)}</option>`).join('');
  $('patRole').addEventListener('change', (e) => {
    const role = e.target.value;
    for (const it of selectedItems()) {
      it.pat = it.pat || {};
      if (role) it.pat.role = role; else delete it.pat.role;
      if (!Object.keys(it.pat).length) delete it.pat;
      // 切り開き線は作図用の線なので、ほかの線と見分けやすいようオレンジの太めの線にする
      if (role === 'slash') { it.stroke = SLASH_COLOR; it.sw = 1.5; it.fill = null; }
    }
    e.target.blur(); render(); commit(); updateUI();
  });
  $('patName').addEventListener('change', (e) => {
    const pcs = selectedPieceNodes();
    if (pcs.length !== 1) return;
    const n = pcs[0];
    n.pat = n.pat || {};
    n.pat.name = e.target.value.trim();
    if (isGroup(n)) n.name = n.pat.name;
    commit();
  });
  $('patQty').addEventListener('change', (e) => {
    const pcs = selectedPieceNodes();
    const v = Math.round(parseFloat(e.target.value));
    if (pcs.length !== 1 || !(v >= 1)) { updateUI(); return; }
    pcs[0].pat = pcs[0].pat || {};
    pcs[0].pat.qty = v;
    commit();
  });
  $('btnAama').addEventListener('click', exportAamaFile);
  $('btnSpread').addEventListener('click', openSpreadDialog);
  $('btnPatSample').addEventListener('click', () => {
    if (allItems().length && !confirm('見本の型紙を開きますか？\n保存していない変更は消えます。')) return;
    setDocument(patternSampleDoc(), '見本の型紙.icad', null, 0);
  });
})();

// ---- 切り開き（パターン展開） ----
function openSpreadDialog() {
  const pcs = selectedPieceNodes().filter(isGroup);
  if (pcs.length !== 1) { toast('切り開く型紙（グループ）を1つ選んでください'); return; }
  const id = pcs[0].id;
  const tg = spreadTargets(pcs[0]);
  if (tg.error) { toast(tg.error); return; }
  if (!tg.slashes.length) { toast('切り開き線がありません。裾からウエストへ直線を引き、役割を「切り開き線」にしてください'); return; }
  const last = S.dlgLast.spread || { open: 60, seam: 10 };
  openDialog({
    title: `切り開き（切り開き線 ${tg.slashes.length} 本）`,
    fields: [
      { id: 'open', label: '開く量（1本あたり）', value: last.open, unit: 'mm（裾で）' },
      { id: 'seam', label: '縫い代', value: last.seam, unit: 'mm（輪郭を作り直す）' },
    ],
    copy: false,
    apply: (v, copy, pv) => {
      const f = findItem(id);
      if (!f) return;
      try {
        const r = spreadPiece(f.item, v.open * PT_PER_MM, v.seam * PT_PER_MM);
        if (!pv) {
          S.dlgLast.spread = v;
          S.sel.clear(); selectNode(f.item, false);
          commit();
          toast(`切り開きました（${r.count} 本・1本あたり ${Math.round(r.deg * 10) / 10}°）`);
        }
      } catch (err) { if (!pv) toast('切り開けませんでした：' + err.message); }
    },
  });
}
