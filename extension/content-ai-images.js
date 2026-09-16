// Experimental image-URL enrichment for Gemini matching.
// This does not fetch additional AliExpress data. It only attaches image URLs
// already present in the selected reference and cached PDP SKU results.

const xrayAiTextOnlyRequestBatches = xrayAiRequestBatches;

function xrayAiReferenceImageUrl(reference) {
  const stored = xraySortState.references.get(String(reference?.id || ''));
  return normalizedImageUrl(stored?.imageUrl) || null;
}

function xrayAiCandidateImageUrl(groupId, candidateId) {
  const result = xraySortState.resultCache.get(String(groupId || ''));
  const sku = (result?.skus || []).find((item) => String(item?.skuId || '') === String(candidateId || ''));
  return normalizedImageUrl(sku?.imageUrl) || null;
}

xrayAiRequestBatches = function xrayAiRequestBatchesWithImageUrls(references, groups) {
  const enrichedReferences = (references || []).map((reference) => ({
    ...reference,
    imageUrl: xrayAiReferenceImageUrl(reference)
  }));

  const enrichedGroups = (groups || []).map((group) => ({
    ...group,
    candidates: (group.candidates || []).map((candidate) => ({
      ...candidate,
      imageUrl: xrayAiCandidateImageUrl(group.id, candidate.id)
    }))
  }));

  xrayAiTempDebug('image-urls-attached', {
    referenceImages: enrichedReferences.filter((reference) => reference.imageUrl).length,
    candidateImages: enrichedGroups.reduce(
      (count, group) => count + group.candidates.filter((candidate) => candidate.imageUrl).length,
      0
    )
  });

  return xrayAiTextOnlyRequestBatches(enrichedReferences, enrichedGroups);
};
