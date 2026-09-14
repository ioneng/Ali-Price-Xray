// Adds per-SKU option images to the existing background parser without changing
// the request path. Loaded after background.js in the same Firefox background scope.

function xrayFirstImage(value) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim()) || null;
  }
  return typeof value === 'string' && value.trim() ? value : null;
}

function xraySkuImageFor(result, skuId, path) {
  const direct = xrayFirstImage(result?.HEADER_IMAGE_PC?.skuImagesMap?.[String(skuId)]);
  if (direct) return direct;

  const rawPath = String(path?.path || '');
  const valueIds = new Set(
    rawPath.split(';')
      .map((part) => part.split(':').pop()?.trim())
      .filter(Boolean)
  );

  const properties = Array.isArray(result?.SKU?.skuProperties)
    ? result.SKU.skuProperties
    : [];

  for (const property of properties) {
    const values = Array.isArray(property?.skuPropertyValues)
      ? property.skuPropertyValues
      : [];

    for (const value of values) {
      const id = String(value?.propertyValueIdLong ?? value?.propertyValueId ?? '').trim();
      if (!id || !valueIds.has(id)) continue;

      const image = xrayFirstImage(value?.skuPropertyImagePath)
        || xrayFirstImage(value?.skuPropertyImageSummPath);
      if (image) return image;
    }
  }

  return null;
}

const xrayOriginalSkuEntries = skuEntries;
skuEntries = function xraySkuEntriesWithImages(result, map) {
  return xrayOriginalSkuEntries(result, map).map((item) => ({
    ...item,
    imageUrl: xraySkuImageFor(result, item.skuId, item.path)
  }));
};

const xrayOriginalNormalizeSkuEntries = normalizeSkuEntries;
normalizeSkuEntries = function xrayNormalizeSkuEntriesWithImages(entries) {
  const images = new Map(
    entries
      .filter((item) => item?.skuId)
      .map((item) => [String(item.skuId), item.imageUrl || null])
  );

  return xrayOriginalNormalizeSkuEntries(entries).map((sku) => ({
    ...sku,
    imageUrl: images.get(String(sku.skuId)) || null
  }));
};
