// Preliminary comparison-feasibility gate for Ali-Price-Xray.
// Keep the per-card Xray available on every search, but only expose the
// cross-listing comparison controls when the search appears to target a
// repeated, identifiable model or product family.

const XRAY_COMPARE_MIN_MATCHING_CARDS = 3;

let xrayCompareGateCacheHref = null;
let xrayCompareGateCacheResult = null;

function xrayCompareSearchText(href = location.href) {
  try {
    const url = new URL(href, location.href);
    const explicit = url.searchParams.get('SearchText')
      || url.searchParams.get('searchText')
      || url.searchParams.get('keyword')
      || url.searchParams.get('q');
    if (explicit) return explicit;

    const match = url.pathname.match(/\/w\/wholesale-(.+?)(?:\.html)?$/i);
    if (!match) return '';
    return decodeURIComponent(match[1]).replace(/\+/g, ' ').replace(/[-_]+/g, ' ');
  } catch {
    return '';
  }
}

function xrayCompareIsGenericIdentifier(token) {
  const value = String(token || '').toLowerCase();
  if (!value) return true;

  // Measurements/capacities are useful variant facts, but they are not model
  // identities. Treating "100W" as a model would incorrectly enable compare
  // on broad searches such as "100W GaN charger".
  if (/^\d+(?:w|kw|v|a|ma|mah|ah|wh|mm|cm|m|in|inch|gb|tb|hz|khz|mhz|ghz|pcs?|ports?)$/.test(value)) {
    return true;
  }

  // Common standards/generations likewise describe broad product classes.
  if (/^(?:usb|pd|qc|wifi|bt|pcie|hdmi|ddr|gen|ip)\d/.test(value)) return true;
  if (/^(?:2g|3g|4g|5g|2k|4k|8k|3d|m2)$/.test(value)) return true;
  if (/^80211/.test(value)) return true;
  return false;
}

function xrayCompareModelIdentifiers(text) {
  const source = String(text || '').normalize('NFKC').toLowerCase();
  const parts = source.match(/[\p{L}\p{N}]+/gu) || [];
  const ids = new Set();

  for (const part of parts) {
    if (!/\p{L}/u.test(part) || !/\d/u.test(part)) continue;
    if (xrayCompareIsGenericIdentifier(part)) continue;
    ids.add(part);
  }

  // AliExpress search slugs commonly split model codes on hyphens, e.g.
  // HS-02B -> "hs 02b". Rejoin a short alphabetic prefix with the following
  // numeric/mixed segment so the same model is recognized in card titles.
  for (let index = 0; index < parts.length - 1; index += 1) {
    const prefix = parts[index];
    const suffix = parts[index + 1];
    if (!/^\p{L}{1,4}$/u.test(prefix)) continue;
    if (!/\d/u.test(suffix) || suffix.length > 8) continue;
    if (xrayCompareIsGenericIdentifier(suffix)) continue;
    const joined = `${prefix}${suffix}`;
    if (!xrayCompareIsGenericIdentifier(joined)) ids.add(joined);
  }

  return ids;
}

function xrayCompareCandidateText(candidate) {
  if (typeof candidate?.title === 'string') return candidate.title;
  const card = candidate?.card;
  return String(card?.innerText || card?.textContent || '');
}

function xrayCompareEvaluate(candidates, href = location.href) {
  const queryText = xrayCompareSearchText(href);
  const queryIdentifiers = [...xrayCompareModelIdentifiers(queryText)];
  const rows = (candidates || []).filter((candidate) => candidate?.productId);

  if (!queryIdentifiers.length || rows.length < XRAY_COMPARE_MIN_MATCHING_CARDS) {
    return {
      feasible: false,
      queryText,
      queryIdentifiers,
      matchingIdentifier: null,
      matchingCards: 0,
      totalCards: rows.length,
      minimumMatchingCards: XRAY_COMPARE_MIN_MATCHING_CARDS
    };
  }

  let bestIdentifier = null;
  let bestCount = 0;
  for (const identifier of queryIdentifiers) {
    let count = 0;
    for (const candidate of rows) {
      const cardIdentifiers = xrayCompareModelIdentifiers(xrayCompareCandidateText(candidate));
      if (cardIdentifiers.has(identifier)) count += 1;
    }
    if (count > bestCount) {
      bestIdentifier = identifier;
      bestCount = count;
    }
  }

  return {
    feasible: bestCount >= XRAY_COMPARE_MIN_MATCHING_CARDS,
    queryText,
    queryIdentifiers,
    matchingIdentifier: bestIdentifier,
    matchingCards: bestCount,
    totalCards: rows.length,
    minimumMatchingCards: XRAY_COMPARE_MIN_MATCHING_CARDS
  };
}

function xrayCompareFeasibility() {
  const href = String(location.href || '');
  if (xrayCompareGateCacheHref === href && xrayCompareGateCacheResult) {
    return xrayCompareGateCacheResult;
  }

  const result = xrayCompareEvaluate(candidateCards(), href);
  xrayCompareGateCacheHref = href;
  xrayCompareGateCacheResult = result;
  log('comparison feasibility', result);
  return result;
}

function xrayCompareIsEnabled() {
  return xrayCompareFeasibility().feasible;
}

const xrayCompareOriginalDecorateSkuRow = xrayDecorateSkuRow;
xrayDecorateSkuRow = function xrayDecorateSkuRowWhenComparable(row, sku, productId, unavailable) {
  if (!xrayCompareIsEnabled()) return row;
  return xrayCompareOriginalDecorateSkuRow(row, sku, productId, unavailable);
};

const xrayCompareOriginalAddPanelControls = xrayAddPanelControls;
xrayAddPanelControls = function xrayAddPanelControlsWhenComparable(panel, result) {
  if (!xrayCompareIsEnabled()) return;
  return xrayCompareOriginalAddPanelControls(panel, result);
};

const xrayCompareOriginalSortAllCards = xraySortAllCards;
xraySortAllCards = async function xraySortAllCardsWhenComparable(...args) {
  if (!xrayCompareIsEnabled()) {
    log('comparison blocked by preliminary feasibility check', xrayCompareFeasibility());
    return;
  }
  return xrayCompareOriginalSortAllCards(...args);
};

log('comparison feasibility gate loaded');
