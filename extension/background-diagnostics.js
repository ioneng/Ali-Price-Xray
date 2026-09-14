// Temporary diagnostics for comparing SKU availability across listings.
// Loaded after background-images.js and augments normalized SKU objects with
// non-sensitive primitive fields from the product SKU path and price entry.

const xrayDiagnosticsOriginalNormalizeSkuEntries = normalizeSkuEntries;

function xrayDiagnosticsPrimitiveFields(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null || ['string', 'number', 'boolean'].includes(typeof item)) out[key] = item;
  }
  return out;
}

function xrayDiagnosticsPriceFields(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const out = xrayDiagnosticsPrimitiveFields(entry);
  for (const key of ['salePrice', 'warmUpPrice', 'originalPrice']) {
    if (entry[key] && typeof entry[key] === 'object') {
      out[key] = xrayDiagnosticsPrimitiveFields(entry[key]);
    }
  }
  return out;
}

normalizeSkuEntries = function xrayDiagnosticsNormalizeSkuEntries(entries) {
  const normalized = xrayDiagnosticsOriginalNormalizeSkuEntries(entries);
  const sourceBySku = new Map(entries.map(({ skuId, entry, path }) => [String(skuId), { entry, path }]));
  return normalized.map((sku) => {
    const source = sourceBySku.get(String(sku.skuId)) || {};
    return {
      ...sku,
      diagnostic: {
        path: xrayDiagnosticsPrimitiveFields(source.path),
        price: xrayDiagnosticsPriceFields(source.entry)
      }
    };
  });
};
