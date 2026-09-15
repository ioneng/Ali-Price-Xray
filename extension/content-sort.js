// Hybrid reference-SKU matching and price sorting for Ali-Price-Xray.
// Loaded after content.js so it can decorate the existing SKU panel without
// changing the proven card detection / PDP request path.

const XRAY_SORT_MIN_CONFIDENCE = 0.58;
const XRAY_SORT_MAX_HASH_CANDIDATES = 6;
const XRAY_SORT_FETCH_CONCURRENCY = 3;
const XRAY_SORT_REFERENCE_COLORS = [
  { solid: '#2563eb', tint: 'rgba(37,99,235,.10)' },
  { solid: '#d97706', tint: 'rgba(217,119,6,.10)' },
  { solid: '#7c3aed', tint: 'rgba(124,58,237,.10)' },
  { solid: '#059669', tint: 'rgba(5,150,105,.10)' },
  { solid: '#dc2626', tint: 'rgba(220,38,38,.10)' },
  { solid: '#0891b2', tint: 'rgba(8,145,178,.10)' }
];

const xraySortState = {
  references: new Map(),
  resultCache: new Map(),
  imageHashCache: new Map(),
  sorting: false,
  lastMatches: new Map()
};

function xrayReferenceKey(productId, skuId) {
  return `${productId}:${skuId}`;
}

function xrayReferenceColor(referenceOrKey) {
  const key = typeof referenceOrKey === 'string' ? referenceOrKey : referenceOrKey?.key;
  const index = [...xraySortState.references.keys()].indexOf(key);
  return index >= 0 ? XRAY_SORT_REFERENCE_COLORS[index % XRAY_SORT_REFERENCE_COLORS.length] : null;
}

function xrayNormalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function xrayTokenProfile(label) {
  const source = String(label || '').normalize('NFKC').toLowerCase();
  const normalized = xrayNormalizeText(source);
  const raw = normalized ? normalized.split(' ') : [];
  const tokens = new Set(raw.filter((token) => token.length > 1));
  const compact = new Set([...tokens].map((token) => token.replace(/[^\p{L}\p{N}]/gu, '')));
  const modelParts = source.match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+|[\p{L}\p{N}]+/gu) || [];
  const modelTokens = new Set(
    modelParts
      .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((token) => /\p{L}/u.test(token) && /\d/u.test(token))
  );
  for (const token of modelTokens) compact.add(token);
  const numberTokens = new Set([...compact].filter((token) => /^\d+(?:w|v|a|mah|mm|cm|pcs?)?$/u.test(token)));
  return { normalized, tokens, compact, modelTokens, numberTokens };
}

function xrayWeightedOverlap(reference, candidate) {
  if (!reference.compact.size || !candidate.compact.size) return 0;
  let possible = 0;
  let matched = 0;
  for (const token of reference.compact) {
    const weight = reference.modelTokens.has(token) ? 4 : (reference.numberTokens.has(token) ? 2 : 1);
    possible += weight;
    if (candidate.compact.has(token)) matched += weight;
  }
  return possible ? matched / possible : 0;
}

function xrayJaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function xrayTextSimilarity(referenceLabel, candidateLabel) {
  const reference = xrayTokenProfile(referenceLabel);
  const candidate = xrayTokenProfile(candidateLabel);
  if (!reference.normalized || !candidate.normalized) return 0;
  if (reference.normalized === candidate.normalized) return 1;

  const coverage = xrayWeightedOverlap(reference, candidate);
  const jaccard = xrayJaccard(reference.compact, candidate.compact);
  let score = (coverage * 0.72) + (jaccard * 0.28);

  const referenceModels = [...reference.modelTokens];
  const candidateModels = [...candidate.modelTokens];
  if (referenceModels.length) {
    const exactModel = referenceModels.some((token) => candidate.modelTokens.has(token));
    if (exactModel) score = Math.max(score, 0.78);
    else if (candidateModels.length) score *= 0.58;
  }

  return Math.max(0, Math.min(1, score));
}

function xrayCanonicalImageKey(url) {
  const src = normalizedImageUrl(url);
  if (!src) return null;
  try {
    const parsed = new URL(src, location.href);
    let path = parsed.pathname;
    // AliExpress image CDNs commonly append resize/quality/render suffixes to
    // an otherwise identical source image. Strip only trailing transform data.
    path = path
      .replace(/_(?:\d+x\d+[^/]*)$/i, '')
      .replace(/\.jpg_[^/]+$/i, '.jpg')
      .replace(/\.jpeg_[^/]+$/i, '.jpeg')
      .replace(/\.png_[^/]+$/i, '.png')
      .replace(/\.webp_[^/]+$/i, '.webp');
    return `${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return src.split(/[?#]/, 1)[0];
  }
}

function xrayHammingSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let different = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) different += 1;
  return 1 - (different / a.length);
}

async function xrayImageDHash(url) {
  const src = normalizedImageUrl(url);
  if (!src) return null;
  if (xraySortState.imageHashCache.has(src)) return xraySortState.imageHashCache.get(src);

  const promise = new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 9;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0, 9, 8);
        const pixels = ctx.getImageData(0, 0, 9, 8).data;
        const gray = [];
        for (let i = 0; i < pixels.length; i += 4) {
          gray.push((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
        }
        let hash = '';
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 8; x += 1) {
            const left = gray[(y * 9) + x];
            const right = gray[(y * 9) + x + 1];
            hash += left > right ? '1' : '0';
          }
        }
        resolve(hash);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });

  xraySortState.imageHashCache.set(src, promise);
  return promise;
}

async function xrayImageSimilarity(referenceUrl, candidateUrl) {
  const referenceKey = xrayCanonicalImageKey(referenceUrl);
  const candidateKey = xrayCanonicalImageKey(candidateUrl);
  if (!referenceKey || !candidateKey) return null;
  if (referenceKey === candidateKey) return 1;

  const [referenceHash, candidateHash] = await Promise.all([
    xrayImageDHash(referenceUrl),
    xrayImageDHash(candidateUrl)
  ]);
  return xrayHammingSimilarity(referenceHash, candidateHash);
}

function xrayCombineSignals(textScore, imageScore) {
  if (!Number.isFinite(imageScore)) return textScore;
  if (!Number.isFinite(textScore)) return imageScore;

  // When both signals exist, allow the image to veto a misleading label.
  // Strong text still matters, but poor visual similarity drags confidence down.
  const imageWeight = textScore >= 0.72 ? 0.58 : (textScore >= 0.38 ? 0.68 : 0.82);
  let score = (imageScore * imageWeight) + (textScore * (1 - imageWeight));
  if (textScore >= 0.85 && imageScore < 0.28) score *= 0.72;
  return Math.max(0, Math.min(1, score));
}

function xrayCheapPairScore(reference, sku) {
  const text = xrayTextSimilarity(reference.label, skuDisplayLabel(sku));
  const imageExact = xrayCanonicalImageKey(reference.imageUrl)
    && xrayCanonicalImageKey(reference.imageUrl) === xrayCanonicalImageKey(sku.imageUrl);
  return { text, imageExact: Boolean(imageExact), cheap: imageExact ? 1 : text };
}

async function xrayScoreSkuAgainstReference(reference, sku, allowPixelHash = true) {
  const cheap = xrayCheapPairScore(reference, sku);
  if (cheap.imageExact) return { score: 1, text: cheap.text, image: 1 };

  const image = allowPixelHash && reference.imageUrl && sku.imageUrl
    ? await xrayImageSimilarity(reference.imageUrl, sku.imageUrl)
    : null;
  const score = xrayCombineSignals(cheap.text, image);
  return { score, text: cheap.text, image };
}

async function xrayBestSkuForResult(result) {
  const references = [...xraySortState.references.values()];
  const skus = (result?.skus || []).filter((sku) => sku.salable !== false);
  if (!references.length || !skus.length) return null;

  const cheapRows = [];
  for (const sku of skus) {
    let best = null;
    for (const reference of references) {
      const pair = xrayCheapPairScore(reference, sku);
      if (!best || pair.cheap > best.cheap) best = { reference, ...pair };
    }
    cheapRows.push({ sku, best });
  }
  cheapRows.sort((a, b) => b.best.cheap - a.best.cheap);

  const pixelCandidates = new Set(
    cheapRows
      .filter((row, index) => row.best.imageExact || index < XRAY_SORT_MAX_HASH_CANDIDATES)
      .map((row) => row.sku)
  );

  // If labels carry almost no signal, inspect every image for small SKU sets.
  if ((cheapRows[0]?.best.cheap || 0) < 0.32 && skus.length <= 12) {
    for (const sku of skus) if (sku.imageUrl) pixelCandidates.add(sku);
  }

  let bestMatch = null;
  const bestByReference = new Map();
  for (const row of cheapRows) {
    for (const reference of references) {
      const scored = await xrayScoreSkuAgainstReference(reference, row.sku, pixelCandidates.has(row.sku));
      const candidate = { sku: row.sku, reference, ...scored };
      if (!bestMatch || scored.score > bestMatch.score) bestMatch = candidate;
      const referenceBest = bestByReference.get(reference.key);
      if (!referenceBest || scored.score > referenceBest.score) bestByReference.set(reference.key, candidate);
    }
  }

  return bestMatch ? {
    ...bestMatch,
    referenceMatches: references.map((reference) => bestByReference.get(reference.key)).filter(Boolean)
  } : null;
}

function xraySkuContainsSkuId(sku, skuId) {
  const wanted = String(skuId || '');
  if (!wanted) return false;
  if (String(sku?.skuId || '') === wanted) return true;
  return (sku?.xrayVisibleGroup?.skuIds || []).some((id) => String(id) === wanted);
}

function xrayApplySkuHighlight(row, colors) {
  row.style.backgroundColor = '';
  row.style.backgroundImage = '';
  if (!colors.length) return;

  const stripeWidth = 4;
  const stops = [];
  colors.forEach((color, index) => {
    const start = index * stripeWidth;
    const end = start + stripeWidth;
    stops.push(`${color.solid} ${start}px`, `${color.solid} ${end}px`);
  });
  stops.push(`transparent ${colors.length * stripeWidth}px`);
  row.style.backgroundColor = colors[0].tint;
  row.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
}

function xrayRefreshSkuHighlights() {
  for (const row of document.querySelectorAll('[data-xray-sku-id]')) {
    const checkbox = row.querySelector('.ali-price-xray-reference-checkbox');
    if (checkbox) checkbox.style.accentColor = '';

    const selectedKey = checkbox?.checked ? checkbox.dataset.referenceKey : null;
    if (selectedKey) {
      const color = xrayReferenceColor(selectedKey);
      if (color) {
        checkbox.style.accentColor = color.solid;
        xrayApplySkuHighlight(row, [color]);
        continue;
      }
    }

    const matchItem = xraySortState.lastMatches.get(String(row.dataset.xrayProductId || ''));
    const matches = matchItem?.match?.referenceMatches || [];
    const colors = matches
      .filter((match) => match.score >= XRAY_SORT_MIN_CONFIDENCE && xraySkuContainsSkuId(row.__xraySku, match.sku?.skuId))
      .map((match) => xrayReferenceColor(match.reference))
      .filter(Boolean);
    xrayApplySkuHighlight(row, colors);
  }
}

function xraySetReference(productId, sku, selected) {
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
    xraySortState.references.delete(key);
  }
  xraySyncReferenceControls();
  xrayRefreshSkuHighlights();
}

function xraySyncReferenceControls() {
  for (const checkbox of document.querySelectorAll('.ali-price-xray-reference-checkbox')) {
    checkbox.checked = xraySortState.references.has(checkbox.dataset.referenceKey);
    const color = checkbox.checked ? xrayReferenceColor(checkbox.dataset.referenceKey) : null;
    checkbox.style.accentColor = color?.solid || '';
  }
  const count = xraySortState.references.size;
  for (const button of document.querySelectorAll('.ali-price-xray-sort-button')) {
    button.disabled = !count || xraySortState.sorting;
    button.textContent = xraySortState.sorting
      ? 'Matching…'
      : (count ? `Sort by ${count} selected` : 'Select SKU(s) to sort');
  }
}

function xrayDecorateSkuRow(row, sku, productId, unavailable) {
  row.dataset.xraySkuId = String(sku.skuId);
  row.dataset.xrayProductId = String(productId);
  row.__xraySku = sku;
  if (unavailable || sku.salable === false) return row;

  const selector = document.createElement('label');
  selector.title = 'Use this SKU as a reference for matching other listings';
  Object.assign(selector.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: isMobileLayout() ? '36px' : '28px',
    minHeight: isMobileLayout() ? '44px' : '28px',
    cursor: 'pointer'
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'ali-price-xray-reference-checkbox';
  checkbox.dataset.referenceKey = xrayReferenceKey(productId, sku.skuId);
  checkbox.setAttribute('aria-label', `Use ${skuDisplayLabel(sku)} as sort reference`);
  checkbox.style.width = isMobileLayout() ? '22px' : '17px';
  checkbox.style.height = isMobileLayout() ? '22px' : '17px';
  checkbox.style.cursor = 'pointer';
  checkbox.checked = xraySortState.references.has(checkbox.dataset.referenceKey);
  checkbox.addEventListener('click', (event) => event.stopPropagation());
  checkbox.addEventListener('change', () => xraySetReference(productId, sku, checkbox.checked));
  selector.appendChild(checkbox);

  row.style.gridTemplateColumns = `${isMobileLayout() ? 36 : 28}px ${row.style.gridTemplateColumns}`;
  row.prepend(selector);
  return row;
}

function xrayAddPanelControls(panel, result) {
  if (!panel || !result?.ok || panel.querySelector('.ali-price-xray-sort-controls')) return;
  const controls = document.createElement('div');
  controls.className = 'ali-price-xray-sort-controls';
  Object.assign(controls.style, {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    margin: '8px 0 10px',
    padding: '8px',
    borderRadius: '8px',
    background: '#f6f7f8'
  });

  const hint = document.createElement('div');
  hint.textContent = 'Select one or more comparable SKUs. Matching uses option text plus attached images.';
  Object.assign(hint.style, {
    flex: '1',
    minWidth: '0',
    color: '#444',
    fontSize: isMobileLayout() ? '12px' : '10px'
  });

  const sort = document.createElement('button');
  sort.type = 'button';
  sort.className = 'ali-price-xray-sort-button';
  Object.assign(sort.style, {
    minHeight: isMobileLayout() ? '44px' : '30px',
    padding: '6px 10px',
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
}

function xrayResultForCandidate(candidate) {
  return xraySortState.resultCache.get(String(candidate.productId)) || null;
}

async function xrayFetchCandidateResult(candidate) {
  const cached = xrayResultForCandidate(candidate);
  if (cached?.ok) return cached;
  try {
    const result = await api.runtime.sendMessage({
      type: 'xray:fetch-skus',
      productId: candidate.productId,
      productUrl: candidate.productUrl
    });
    if (result) xraySortState.resultCache.set(String(candidate.productId), result);
    return result;
  } catch (error) {
    return { ok: false, productId: String(candidate.productId), error: error?.message || String(error) };
  }
}

async function xrayMapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function xrayRemoveMatchBadges() {
  for (const badge of document.querySelectorAll('.ali-price-xray-match-badge')) badge.remove();
}

function xrayAddMatchBadge(card, match, rank, currency) {
  card.querySelector(':scope > .ali-price-xray-match-badge')?.remove();
  ensurePositioned(card);
  const badge = document.createElement('div');
  badge.className = 'ali-price-xray-match-badge';
  const pct = Math.round(match.score * 100);
  badge.textContent = `#${rank} · ${money(match.sku.salePrice, match.sku.currency || currency)} · ${pct}% match`;
  badge.title = `Matched ${skuDisplayLabel(match.sku)}\nText ${Math.round((match.text || 0) * 100)}%${Number.isFinite(match.image) ? ` · image ${Math.round(match.image * 100)}%` : ' · image unavailable'}`;
  Object.assign(badge.style, {
    position: 'absolute',
    zIndex: '2147483644',
    top: '6px',
    left: '6px',
    maxWidth: 'calc(100% - 82px)',
    padding: '5px 8px',
    borderRadius: '999px',
    background: 'rgba(22,90,45,.94)',
    color: '#fff',
    font: isMobileLayout() ? '700 11px/1.2 system-ui, sans-serif' : '700 10px/1.2 system-ui, sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none'
  });
  card.appendChild(badge);
}

function xrayApplyCardOrdering(matches) {
  const confident = matches
    .filter((item) => item.match && item.match.score >= XRAY_SORT_MIN_CONFIDENCE && Number.isFinite(item.match.sku.salePrice))
    .sort((a, b) => a.match.sku.salePrice - b.match.sku.salePrice);

  const rankByProduct = new Map(confident.map((item, index) => [String(item.candidate.productId), index + 1]));
  const parentGroups = new Map();
  for (const item of matches) {
    const parent = item.candidate.card.parentElement;
    if (!parent) continue;
    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
    parentGroups.get(parent).push(item);
  }

  for (const [parent, group] of parentGroups) {
    const display = getComputedStyle(parent).display;
    if (!/(grid|flex)/.test(display)) continue;
    group.forEach((item, index) => {
      const rank = rankByProduct.get(String(item.candidate.productId));
      item.candidate.card.style.order = String(rank ? rank : 10000 + index);
    });
  }

  xrayRemoveMatchBadges();
  for (const item of confident) {
    const rank = rankByProduct.get(String(item.candidate.productId));
    const currency = item.result?.prefs?.currency || 'AUD';
    xrayAddMatchBadge(item.candidate.card, item.match, rank, currency);
  }
  return confident.length;
}

async function xraySortAllCards() {
  if (xraySortState.sorting || !xraySortState.references.size) return;
  xraySortState.sorting = true;
  xraySyncReferenceControls();

  const badge = ensureDebugBadge();
  const candidates = candidateCards();
  badge.textContent = `Xray: matching 0/${candidates.length}`;
  badge.style.background = 'rgba(90,70,20,.90)';
  let completed = 0;

  try {
    const matches = await xrayMapWithConcurrency(candidates, XRAY_SORT_FETCH_CONCURRENCY, async (candidate) => {
      const result = await xrayFetchCandidateResult(candidate);
      const match = result?.ok ? await xrayBestSkuForResult(result) : null;
      completed += 1;
      badge.textContent = `Xray: matching ${completed}/${candidates.length}`;
      return { candidate, result, match };
    });

    xraySortState.lastMatches = new Map(matches.map((item) => [String(item.candidate.productId), item]));
    xrayRefreshSkuHighlights();
    const confidentCount = xrayApplyCardOrdering(matches);
    badge.textContent = `Xray: sorted ${confidentCount}/${candidates.length}`;
    badge.style.background = confidentCount ? 'rgba(20,100,45,.88)' : 'rgba(150,80,20,.90)';
    log('reference SKU sort complete', {
      references: [...xraySortState.references.values()],
      confidentCount,
      total: candidates.length
    });
  } finally {
    xraySortState.sorting = false;
    xraySyncReferenceControls();
  }
}

// Patch the existing renderer rather than duplicating the Xray panel logic.
const xrayOriginalCreateSkuRow = createSkuRow;
createSkuRow = function xrayCreateSelectableSkuRow(sku, currency, unavailable = false) {
  const row = xrayOriginalCreateSkuRow(sku, currency, unavailable);
  // productId is filled by the render wrapper immediately after the row exists.
  row.__xraySku = sku;
  row.__xrayUnavailable = unavailable;
  return row;
};

const xrayOriginalRenderPanel = renderPanel;
renderPanel = function xrayRenderPanelWithSort(card, result, anchor) {
  if (result?.productId) xraySortState.resultCache.set(String(result.productId), result);
  xrayOriginalRenderPanel(card, result, anchor);
  if (!result?.ok) return;

  const panel = findPanel(result.productId) || card.querySelector(':scope > .ali-price-xray-panel');
  if (!panel) return;
  for (const row of panel.querySelectorAll('div')) {
    if (!row.__xraySku || row.querySelector(':scope > .ali-price-xray-reference-checkbox')) continue;
    xrayDecorateSkuRow(row, row.__xraySku, result.productId, row.__xrayUnavailable);
  }
  xrayAddPanelControls(panel, result);
  xrayRefreshSkuHighlights();
};

log('reference SKU hybrid sorter loaded');
