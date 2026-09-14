// Adds per-SKU option images to the existing background parser without changing
// the request path. Loaded after background.js in the same Firefox background scope.

const XRAY_IMAGE_FIELDS = [
  'imageUrl',
  'imagePath',
  'skuPropertyImagePath',
  'skuPropertyImageSummPath',
  'url'
];

function xrayFirstImage(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = xrayFirstImage(item);
      if (image) return image;
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object') return null;

  for (const field of XRAY_IMAGE_FIELDS) {
    const image = xrayFirstImage(value[field]);
    if (image) return image;
  }
  return null;
}

function xrayCandidateFields(value, source) {
  if (typeof value === 'string' && value.trim()) return [source];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => xrayCandidateFields(item, `${source}[]`)))];
  }
  if (!value || typeof value !== 'object') return [];
  return XRAY_IMAGE_FIELDS
    .filter((field) => xrayFirstImage(value[field]))
    .map((field) => `${source}.${field}`);
}

function xrayValueIds(path) {
  const ids = new Set();
  for (const raw of [path?.path, path?.skuAttr]) {
    for (const part of String(raw || '').split(';')) {
      const id = part.split(':').pop()?.split('#', 1)[0]?.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

function xraySkuImageFor(result, skuId, path) {
  const imageMap = result?.HEADER_IMAGE_PC?.skuImagesMap;
  const valueIds = xrayValueIds(path);
  const candidateFields = [];
  const candidates = [
    ['HEADER_IMAGE_PC.skuImagesMap[skuId]', imageMap?.[String(skuId)]],
    ...[...valueIds].map((id) => [`HEADER_IMAGE_PC.skuImagesMap[${id}]`, imageMap?.[id]])
  ];

  for (const [source, value] of candidates) {
    candidateFields.push(...xrayCandidateFields(value, source));
    const image = xrayFirstImage(value);
    if (image) return { image, source, valueIds: [...valueIds], candidateFields };
  }

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

      const source = `SKU.skuProperties[].skuPropertyValues[${id}]`;
      candidateFields.push(...xrayCandidateFields(value, source));
      const image = xrayFirstImage(value);
      if (image) {
        return {
          image,
          source,
          valueIds: [...valueIds],
          candidateFields
        };
      }
    }
  }

  return { image: null, source: null, valueIds: [...valueIds], candidateFields };
}

const xrayOriginalSkuEntries = skuEntries;
skuEntries = function xraySkuEntriesWithImages(result, map) {
  return xrayOriginalSkuEntries(result, map).map((item) => {
    const image = xraySkuImageFor(result, item.skuId, item.path);
    return {
      ...item,
      imageUrl: image.image,
      imageDebug: {
        source: image.source,
        valueIds: image.valueIds,
        candidateFields: image.candidateFields
      }
    };
  });
};

const xrayOriginalNormalizeSkuEntries = normalizeSkuEntries;
normalizeSkuEntries = function xrayNormalizeSkuEntriesWithImages(entries) {
  const images = new Map(
    entries
      .filter((item) => item?.skuId)
      .map((item) => [String(item.skuId), {
        imageUrl: item.imageUrl || null,
        imageDebug: item.imageDebug || null
      }])
  );

  return xrayOriginalNormalizeSkuEntries(entries).map((sku) => ({
    ...sku,
    imageUrl: images.get(String(sku.skuId))?.imageUrl || null,
    imageDebug: images.get(String(sku.skuId))?.imageDebug || null
  }));
};
