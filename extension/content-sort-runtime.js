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

function xraySortReferenceKeysForSku(productId, sku) {
  const keys = new Set();
  const ownKey = xrayReferenceKey(productId, sku?.skuId);
  if (xraySortState.references.has(ownKey)) keys.add(ownKey);

  const matchItem = xraySortState.lastMatches.get(String(productId || ''));
  for (const match of matchItem?.match?.referenceMatches || []) {
    const referenceKey = match.reference?.key;
    if (!referenceKey || !xraySortState.references.has(referenceKey)) continue;
    if (match.score < XRAY_SORT_MIN_CONFIDENCE) continue;
    if (!xraySkuContainsSkuId(sku, match.sku?.skuId)) continue;
    keys.add(referenceKey);
  }
  return [...keys];
}

function xraySortReferenceKeysForRow(row) {
  return xraySortReferenceKeysForSku(row?.dataset?.xrayProductId, row?.__xraySku);
}

xraySetReference = function xraySetReferenceGrouped(productId, sku, selected) {
  const key = xrayReferenceKey(productId, sku.skuId);
  if (selected) {
    xraySortState.references.set(key, {
      key,
      productId: String(productId),
      skuId: String(sku.skuId),
      label: skuDisplayLabel(sku),
      imageUrl: normalizedImageUrl(sku.imageUrl)
    });
  } else {
    const groupKeys = xraySortReferenceKeysForSku(productId, sku);
    if (groupKeys.length) {
      for (const groupKey of groupKeys) xraySortState.references.delete(groupKey);
    } else {
      xraySortState.references.delete(key);
    }
  }
  xraySyncReferenceControls();
  xrayRefreshSkuHighlights();
};

xraySyncReferenceControls = function xraySyncGroupedReferenceControls() {
  for (const checkbox of document.querySelectorAll('.ali-price-xray-reference-checkbox')) {
    const row = checkbox.closest?.('[data-xray-sku-id]');
    const groupKeys = row ? xraySortReferenceKeysForRow(row) : [];
    checkbox.checked = groupKeys.length > 0;
    const color = groupKeys.length ? xrayReferenceColor(groupKeys[0]) : null;
    checkbox.style.accentColor = color?.solid || '';
  }

  const count = xraySortState.references.size;
  for (const button of document.querySelectorAll('.ali-price-xray-sort-button')) {
    button.disabled = !count || xraySortState.sorting;
    button.textContent = xraySortState.sorting
      ? 'Matching…'
      : (count ? `Sort by ${count} selected` : 'Select SKU(s) to sort');
  }
};

xrayRefreshSkuHighlights = function xrayRefreshGroupedSkuHighlights() {
  for (const row of document.querySelectorAll('[data-xray-sku-id]')) {
    const groupKeys = xraySortReferenceKeysForRow(row);
    const colors = groupKeys.map((key) => xrayReferenceColor(key)).filter(Boolean);
    const checkbox = row.querySelector('.ali-price-xray-reference-checkbox');
    if (checkbox) {
      checkbox.checked = groupKeys.length > 0;
      checkbox.style.accentColor = colors[0]?.solid || '';
    }
    xrayApplySkuHighlight(row, colors);
  }
};

xrayAddPanelControls = function xrayAddPanelControlsStacked(panel, result) {
  if (!panel || !result?.ok || panel.querySelector('.ali-price-xray-sort-controls')) return;
  const controls = document.createElement('div');
  controls.className = 'ali-price-xray-sort-controls';
  Object.assign(controls.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'stretch',
    margin: '4px 0 6px',
    padding: '6px',
    borderRadius: '8px',
    background: '#f6f7f8'
  });

  const hint = document.createElement('div');
  hint.textContent = 'Tick options to compare, then sort.';
  Object.assign(hint.style, {
    color: '#444',
    fontSize: isMobileLayout() ? '12px' : '10px',
    lineHeight: '1.2',
    textAlign: 'center'
  });

  const sort = document.createElement('button');
  sort.type = 'button';
  sort.className = 'ali-price-xray-sort-button';
  Object.assign(sort.style, {
    alignSelf: 'center',
    minHeight: isMobileLayout() ? '36px' : '28px',
    padding: '5px 10px',
    border: '1px solid rgba(0,0,0,.25)',
    borderRadius: '8px',
    background: '#fff',
    color: '#111',
    fontWeight: '700',
    cursor: 'pointer',
    touchAction: 'manipulation'
  });
  sort.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    xraySortAllCards();
  });

  controls.append(hint, sort);
  const firstSkuList = [...panel.children].find((child) => child.querySelector?.('[data-xray-sku-id]'));
  panel.insertBefore(controls, firstSkuList || null);
  xraySyncReferenceControls();
};

log('reference SKU sorter runtime fallbacks loaded');
