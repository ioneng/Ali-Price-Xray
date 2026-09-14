const api = globalThis.browser ?? globalThis.chrome;
const TAG = '[Ali-Price-Xray]';

const log = (...args) => console.debug(TAG, ...args);

function productIdFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/item\/(\d+)\.html/i);
  return match ? match[1] : null;
}

function productIdFromElement(root) {
  if (!root) return null;
  if (root instanceof HTMLAnchorElement) {
    const own = productIdFromHref(root.href);
    if (own) return own;
  }

  for (const link of root.querySelectorAll?.('a[href*="/item/"]') ?? []) {
    const id = productIdFromHref(link.href);
    if (id) return id;
  }

  return root.getAttribute?.('data-product-id')
    || root.getAttribute?.('data-item-id')
    || root.getAttribute?.('data-id')
    || null;
}

function hasVisiblePrice(root) {
  const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ');
  return /(?:AU\s?\$|US\s?\$|NZ\s?\$|CA\s?\$|SG\s?\$|HK\s?\$|£|€|\$)\s*\d[\d,.]*/i.test(text);
}

function distinctProductIds(root) {
  const ids = new Set();
  for (const link of root.querySelectorAll?.('a[href*="/item/"]') ?? []) {
    const id = productIdFromHref(link.href);
    if (id) ids.add(id);
    if (ids.size > 1) break;
  }
  return ids;
}

function locateCard(link) {
  const wantedId = productIdFromHref(link.href);
  if (!wantedId) return null;

  let node = link;

  for (let depth = 0; depth < 14 && node?.parentElement; depth += 1) {
    node = node.parentElement;
    if (!node) break;

    const rect = node.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 160) continue;
    if (!node.querySelector('img')) continue;
    if (!hasVisiblePrice(node)) continue;

    const ids = distinctProductIds(node);
    if (ids.size === 1 && ids.has(wantedId)) return node;
    if (ids.size > 1) break;
  }

  return null;
}

function candidateCards() {
  const byId = new Map();

  for (const link of document.querySelectorAll('a[href*="/item/"]')) {
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
}

function money(value, currency) {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency || ''} ${value.toFixed(2)}`.trim();
  }
}

function ensurePositioned(card) {
  if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
}

function removePanel(card) {
  card.querySelector(':scope > .ali-price-xray-panel')?.remove();
}

function skuDisplayLabel(sku) {
  const rawAttr = String(sku?.skuAttr || '').trim();
  if (rawAttr) {
    const labels = rawAttr
      .split(';')
      .map((part) => {
        const hash = part.indexOf('#');
        return hash >= 0 ? part.slice(hash + 1).trim() : '';
      })
      .filter(Boolean);

    if (labels.length) return labels.join(' · ');
  }

  const rawPath = String(sku?.skuPath || '').trim();
  if (rawPath) return `path ${rawPath}`;

  return `SKU ${sku?.skuId || '?'}`;
}

function createSkuRow(sku, currency, unavailable = false) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '8px',
    padding: '7px 0',
    borderTop: '1px solid #eee',
    alignItems: 'start',
    opacity: unavailable ? '0.58' : '1'
  });

  const left = document.createElement('div');
  left.style.minWidth = '0';

  const label = document.createElement('div');
  label.textContent = skuDisplayLabel(sku);
  label.title = `SKU ${sku.skuId}${sku.skuPath ? `\npath ${sku.skuPath}` : ''}`;
  Object.assign(label.style, {
    color: '#333',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  });
  left.appendChild(label);

  const meta = document.createElement('div');
  Object.assign(meta.style, {
    marginTop: '2px',
    color: '#888',
    fontSize: '9px',
    overflowWrap: 'anywhere'
  });
  const stockText = sku.salable === false
    ? 'sold out'
    : (sku.salable === true ? `saleable${Number.isFinite(sku.stock) ? ` · stock ${sku.stock}` : ''}` : 'saleability unknown');
  meta.textContent = `SKU ${sku.skuId} · ${stockText}${sku.priceSource ? ` · ${sku.priceSource}` : ''}`;
  left.appendChild(meta);

  const price = document.createElement('strong');
  price.textContent = sku.salePriceString || money(sku.salePrice, sku.currency || currency);
  if (sku.discount) price.title = sku.discount;

  row.append(left, price);
  return row;
}

function renderPanel(card, result) {
  removePanel(card);
  ensurePositioned(card);

  const panel = document.createElement('div');
  panel.className = 'ali-price-xray-panel';
  Object.assign(panel.style, {
    position: 'absolute',
    zIndex: '2147483646',
    top: '36px',
    right: '6px',
    width: 'min(410px, calc(100% - 12px))',
    maxHeight: '440px',
    overflow: 'auto',
    boxSizing: 'border-box',
    padding: '10px',
    border: '1px solid rgba(0,0,0,.25)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,.98)',
    color: '#111',
    boxShadow: '0 8px 28px rgba(0,0,0,.22)',
    font: '12px/1.4 system-ui, sans-serif'
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close';
  Object.assign(close.style, {
    float: 'right',
    border: '0',
    background: 'transparent',
    color: '#555',
    font: '18px/1 system-ui, sans-serif',
    cursor: 'pointer'
  });
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    panel.remove();
  });
  panel.appendChild(close);

  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.style.marginBottom = '6px';
  title.textContent = `Ali-Price-Xray · ${result.productId}`;
  panel.appendChild(title);

  if (!result.ok) {
    const error = document.createElement('div');
    error.style.color = '#a40000';
    error.textContent = result.error || 'SKU request failed.';
    panel.appendChild(error);

    if (result.ret) {
      const ret = document.createElement('pre');
      ret.textContent = result.ret;
      Object.assign(ret.style, { whiteSpace: 'pre-wrap', margin: '8px 0 0', fontSize: '10px' });
      panel.appendChild(ret);
    }

    card.appendChild(panel);
    return;
  }

  const currency = result.prefs?.currency || result.skus?.find((sku) => sku.currency)?.currency || 'AUD';
  const summary = document.createElement('div');
  summary.style.marginBottom = '4px';
  const countText = Number.isFinite(result.saleableCount)
    ? `${result.saleableCount} available variant${result.saleableCount === 1 ? '' : 's'}`
    : `${result.count} backend SKU${result.count === 1 ? '' : 's'}`;
  summary.textContent = `${countText} · ${money(result.min, currency)} – ${money(result.max, currency)}`;
  panel.appendChild(summary);

  if (result.targetPriceString) {
    const target = document.createElement('div');
    Object.assign(target.style, { marginBottom: '6px', fontWeight: '700', color: '#b00020' });
    target.textContent = `Displayed price: ${result.targetPriceString}`;
    panel.appendChild(target);
  }

  const locale = document.createElement('div');
  Object.assign(locale.style, { marginBottom: '8px', color: '#666', fontSize: '10px' });
  const context = result.debug?.contextFields?.length
    ? ` · context: ${result.debug.contextFields.join(', ')}`
    : '';
  locale.textContent = `${result.prefs?.country || '?'} / ${currency} · ${result.prefs?.source || 'unknown locale source'}${context}`;
  panel.appendChild(locale);

  const available = result.skus.filter((sku) => sku.salable === true);
  const unknown = result.skus.filter((sku) => sku.salable == null);
  const unavailable = result.skus.filter((sku) => sku.salable === false);

  const mainList = document.createElement('div');
  for (const sku of [...available, ...unknown]) {
    mainList.appendChild(createSkuRow(sku, currency, false));
  }
  panel.appendChild(mainList);

  if (unavailable.length) {
    const details = document.createElement('details');
    details.style.marginTop = '8px';

    const summaryToggle = document.createElement('summary');
    summaryToggle.textContent = `${unavailable.length} unavailable backend SKU${unavailable.length === 1 ? '' : 's'}`;
    Object.assign(summaryToggle.style, {
      cursor: 'pointer',
      color: '#666',
      fontSize: '10px',
      userSelect: 'none'
    });
    details.appendChild(summaryToggle);

    const soldOutList = document.createElement('div');
    for (const sku of unavailable) soldOutList.appendChild(createSkuRow(sku, currency, true));
    details.appendChild(soldOutList);
    panel.appendChild(details);
  }

  card.appendChild(panel);
}

function attachXray(card, productId, productUrl) {
  if (card.dataset.aliPriceXraySeen === productId) return;
  card.dataset.aliPriceXraySeen = productId;
  ensurePositioned(card);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ali-price-xray-button';
  button.textContent = 'Xray';
  button.title = 'Show or hide AliExpress SKU prices';
  Object.assign(button.style, {
    position: 'absolute',
    zIndex: '2147483645',
    top: '6px',
    right: '6px',
    padding: '4px 8px',
    border: '1px solid rgba(0,0,0,.28)',
    borderRadius: '999px',
    background: 'rgba(255,255,255,.95)',
    color: '#111',
    boxShadow: '0 1px 5px rgba(0,0,0,.15)',
    font: '600 11px/1.3 system-ui, sans-serif',
    cursor: 'pointer'
  });

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const openPanel = card.querySelector(':scope > .ali-price-xray-panel');
    if (openPanel) {
      openPanel.remove();
      return;
    }

    if (button.dataset.loading === '1') return;
    button.dataset.loading = '1';
    const previous = button.textContent;
    button.textContent = '…';

    try {
      const result = await api.runtime.sendMessage({
        type: 'xray:fetch-skus',
        productId,
        productUrl
      });
      log('SKU result', result);
      renderPanel(card, result || { ok: false, productId, error: 'No response from extension background.' });
    } catch (error) {
      log('SKU request error', error);
      renderPanel(card, { ok: false, productId, error: error?.message || String(error) });
    } finally {
      button.dataset.loading = '0';
      button.textContent = previous;
    }
  });

  card.appendChild(button);
}

function ensureDebugBadge() {
  let badge = document.getElementById('ali-price-xray-debug');
  if (badge) return badge;

  badge = document.createElement('div');
  badge.id = 'ali-price-xray-debug';
  Object.assign(badge.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '8px',
    bottom: '8px',
    padding: '4px 7px',
    borderRadius: '6px',
    background: 'rgba(20,20,20,.82)',
    color: '#fff',
    font: '11px/1.2 system-ui, sans-serif',
    pointerEvents: 'none'
  });
  badge.textContent = 'Xray: scanning…';
  document.documentElement.appendChild(badge);
  return badge;
}

function scan() {
  const badge = ensureDebugBadge();
  const candidates = candidateCards();
  let attached = 0;

  for (const { productId, card, productUrl } of candidates) {
    if (!productId || card.dataset.aliPriceXraySeen === productId) continue;
    attachXray(card, productId, productUrl);
    attached += 1;
  }

  const buttons = document.querySelectorAll('.ali-price-xray-button').length;
  badge.textContent = `Xray: ${buttons} card${buttons === 1 ? '' : 's'}`;
  badge.style.background = buttons ? 'rgba(20,100,45,.88)' : 'rgba(150,25,25,.88)';

  if (attached) log(`attached to ${attached} cards; ${buttons} total`);
}

let timer = 0;
function scheduleScan() {
  clearTimeout(timer);
  timer = window.setTimeout(scan, 150);
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true
});

scan();
log('content script loaded', location.href);
