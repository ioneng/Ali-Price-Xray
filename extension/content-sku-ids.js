// Keep backend SKU ids visible in each Xray option row for debugging and traceability.

function xraySkuIdDisplayText(sku) {
  const groupedIds = Array.isArray(sku?.xrayVisibleGroup?.skuIds)
    ? sku.xrayVisibleGroup.skuIds.map((id) => String(id)).filter(Boolean)
    : [];
  const ids = groupedIds.length ? groupedIds : [String(sku?.skuId || '?')];
  return `${ids.length === 1 ? 'SKU' : 'SKUs'} ${ids.join(', ')}`;
}

const xraySkuIdOriginalCreateSkuRow = createSkuRow;
createSkuRow = function xrayCreateSkuRowWithVisibleIds(sku, currency, unavailable = false) {
  const row = xraySkuIdOriginalCreateSkuRow(sku, currency, unavailable);
  const price = row.lastElementChild;
  const left = price?.previousElementSibling;
  if (!left) return row;

  const skuIds = document.createElement('div');
  skuIds.className = 'ali-price-xray-sku-ids';
  skuIds.textContent = xraySkuIdDisplayText(sku);
  Object.assign(skuIds.style, {
    marginTop: '3px',
    color: '#666',
    fontSize: isMobileLayout() ? '11px' : '9px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.25',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  });
  left.appendChild(skuIds);
  return row;
};
