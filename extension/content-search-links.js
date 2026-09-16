// Search-result link compatibility for AliExpress result cards.
// Some result cards use BundleDeals3 links instead of /item/<id>.html links.
// Loaded after content.js so it can replace only the link/card discovery helpers
// while keeping the proven panel/rendering code unchanged.

const XRAY_SEARCH_PRODUCT_LINK_SELECTOR = [
  'a[href*="/item/"]',
  'a[href*="/ssr/300000512/BundleDeals3"]'
].join(', ');

function xraySearchProductIdFromHref(href) {
  if (!href) return null;
  const text = String(href);

  // Normal product links appear both as /item/<id>.html and
  // /item/<slug>/<id>.html (notably p4p/sponsored cards).
  const itemMatch = text.match(/\/item\/(?:[^/?#]+\/)*(\d+)\.html(?:[?#]|$)/i);
  if (itemMatch) return itemMatch[1];

  // A subset of normal search-result cards currently navigate through an SSR
  // BundleDeals route. The product ID is still exposed in productIds=<item>:<sku>.
  try {
    const parsed = new URL(text, location.href);
    if (/\/ssr\/300000512\/BundleDeals3\/?$/i.test(parsed.pathname)) {
      const productIds = parsed.searchParams.get('productIds') || '';
      const bundleMatch = productIds.match(/^(\d{10,})/);
      if (bundleMatch) return bundleMatch[1];
    }
  } catch {}

  return null;
}

productIdFromHref = xraySearchProductIdFromHref;

productIdFromElement = function xraySearchProductIdFromElement(root) {
  if (!root) return null;
  if (root instanceof HTMLAnchorElement) {
    const own = productIdFromHref(root.href);
    if (own) return own;
  }
  for (const link of root.querySelectorAll?.(XRAY_SEARCH_PRODUCT_LINK_SELECTOR) ?? []) {
    const id = productIdFromHref(link.href);
    if (id) return id;
  }
  return root.getAttribute?.('data-product-id')
    || root.getAttribute?.('data-item-id')
    || root.getAttribute?.('data-id')
    || null;
};

distinctProductIds = function xraySearchDistinctProductIds(root) {
  const ids = new Set();
  for (const link of root.querySelectorAll?.(XRAY_SEARCH_PRODUCT_LINK_SELECTOR) ?? []) {
    const id = productIdFromHref(link.href);
    if (id) ids.add(id);
    if (ids.size > 1) break;
  }
  return ids;
};

candidateCards = function xraySearchCandidateCards() {
  const byId = new Map();
  for (const link of document.querySelectorAll(XRAY_SEARCH_PRODUCT_LINK_SELECTOR)) {
    // The search page's slide-out shopping cart also contains product links but
    // those are not search results and previously inflated/debugged card counts.
    if (link.closest?.('.root-sidecart')) continue;

    const productId = productIdFromHref(link.href);
    if (!productId || byId.has(productId)) continue;
    const card = locateCard(link);
    if (card) byId.set(productId, { card, productUrl: link.href });
  }
  return [...byId.entries()].map(([productId, value]) => ({
    productId,
    card: value.card,
    productUrl: value.productUrl
  }));
};

// content.js performs an initial scan before this compatibility layer is loaded.
// Re-scan immediately so BundleDeals-only cards join the same initial sweep.
scan();
log('search-result link compatibility loaded');
