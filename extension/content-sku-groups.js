// Derives customer-visible SKU groups without changing the raw PDP result.

function xraySkuVisibleParts(sku) {
  return String(sku?.skuAttr || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes('#'))
    .map((part) => {
      const hash = part.indexOf('#');
      const label = part.slice(hash + 1).trim();
      return label ? { key: part, label } : null;
    })
    .filter(Boolean);
}

function skuDisplayLabel(sku) {
  const parts = xraySkuVisibleParts(sku);
  if (parts.length) return parts.map((part) => part.label).join(' · ');

  const rawPath = String(sku?.skuPath || '').trim();
  if (rawPath) return `path ${rawPath}`;
  return `SKU ${sku?.skuId || '?'}`;
}

function xrayVisibleSkuKey(sku) {
  const parts = xraySkuVisibleParts(sku);
  if (parts.length) return `visible:${parts.map((part) => part.key).sort().join(';')}`;

  const rawPath = String(sku?.skuPath || '').trim();
  return rawPath ? `path:${rawPath}` : `sku:${String(sku?.skuId || '')}`;
}

function xrayGroupVisibleSkus(skus) {
  const groups = new Map();
  for (const sku of Array.isArray(skus) ? skus : []) {
    const key = xrayVisibleSkuKey(sku);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sku);
  }

  return [...groups.values()].map((members) => {
    const saleable = members.filter((sku) => sku.salable === true);
    const unknown = members.filter((sku) => sku.salable == null);
    const eligible = saleable.length ? saleable : (unknown.length ? unknown : members);
    const priced = eligible.filter((sku) => Number.isFinite(sku.salePrice));
    const min = priced.length ? Math.min(...priced.map((sku) => sku.salePrice)) : null;
    const max = priced.length ? Math.max(...priced.map((sku) => sku.salePrice)) : null;
    const representative = priced.find((sku) => sku.salePrice === min) || eligible[0] || members[0];
    const exactPrice = min != null && min === max;

    return {
      ...representative,
      salable: saleable.length ? true : (unknown.length ? null : false),
      stock: saleable.length === 1 ? saleable[0].stock : null,
      salePrice: min ?? representative.salePrice,
      salePriceString: exactPrice ? representative.salePriceString : null,
      xrayVisibleGroup: {
        rawCount: members.length,
        saleableCount: saleable.length,
        unknownCount: unknown.length,
        min,
        max,
        skuIds: members.map((sku) => String(sku.skuId))
      }
    };
  });
}
