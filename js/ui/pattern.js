'use strict';
// アパレルCAD：型紙パネル（線の役割・パーツ名・枚数・AAMA DXF 書き出し・見本）

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
    }
    e.target.blur(); render(); commit();
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
  $('btnPatSample').addEventListener('click', () => {
    if (allItems().length && !confirm('見本の型紙を開きますか？\n保存していない変更は消えます。')) return;
    setDocument(patternSampleDoc(), '見本の型紙.icad', null, 0);
  });
})();
