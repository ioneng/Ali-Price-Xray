// Runtime fallbacks for the hybrid sorter. Loaded after content-sort.js.

const xraySortOriginalImageDHash = xrayImageDHash;
xrayImageDHash = async function xrayImageDHashWithBackgroundFallback(url) {
  const src = normalizedImageUrl(url);
  if (!src) return null;

  const direct = await xraySortOriginalImageDHash(src);
  if (direct) return direct;

  try {
    const reply = await api.runtime.sendMessage({ type: 'xray:image-dhash', url: src });
    const hash = reply?.ok && typeof reply.hash === 'string' ? reply.hash : null;
    if (hash) xraySortState.imageHashCache.set(src, Promise.resolve(hash));
    return hash;
  } catch {
    return null;
  }
};

function xraySortFindSortableItem(card) {
  let item = card;
  for (let depth = 0; depth < 6 && item?.parentElement; depth += 1) {
    const parent = item.parentElement;
    if (/(grid|flex)/.test(getComputedStyle(parent).display)) return { parent, item };
    const ids = typeof distinctProductIds === 'function' ? distinctProductIds(parent) : new Set();
    if (ids.size > 1) break;
    item = parent;
  }
  return null;
}

xrayApplyCardOrdering = function xrayApplyCardOrderingRobust(matches) {
  const confident = matches
    .filter((item) => item.match && item.match.score >= XRAY_SORT_MIN_CONFIDENCE && Number.isFinite(item.match.sku.salePrice))
    .sort((a, b) => a.match.sku.salePrice - b.match.sku.salePrice);

  const rankByProduct = new Map(confident.map((item, index) => [String(item.candidate.productId), index + 1]));
  const parentGroups = new Map();

  for (const matchItem of matches) {
    const sortable = xraySortFindSortableItem(matchItem.candidate.card);
    if (!sortable) continue;
    if (!parentGroups.has(sortable.parent)) parentGroups.set(sortable.parent, []);
    parentGroups.get(sortable.parent).push({ matchItem, sortableItem: sortable.item });
  }

  for (const group of parentGroups.values()) {
    group.forEach(({ matchItem, sortableItem }, index) => {
      const rank = rankByProduct.get(String(matchItem.candidate.productId));
      sortableItem.style.order = String(rank ? rank - 10000 : 10000 + index);
    });
  }

  xrayRemoveMatchBadges();
  for (const item of confident) {
    const rank = rankByProduct.get(String(item.candidate.productId));
    const currency = item.result?.prefs?.currency || 'AUD';
    xrayAddMatchBadge(item.candidate.card, item.match, rank, currency);
  }
  return confident.length;
};

log('reference SKU sorter runtime fallbacks loaded');
