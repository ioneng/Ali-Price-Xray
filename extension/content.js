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

function locateCard(link) {
  const wantedId = productIdFromHref(link.href);
  let node = link;
  let best = null;

  for (let depth = 0; depth < 10 && node?.parentElement; depth += 1) {
    node = node.parentElement;
    if (!node) break;

    const ids = new Set();
    for (const childLink of node.querySelectorAll('a[href*="/item/"]')) {
      const id = productIdFromHref(childLink.href);
      if (id) ids.add(id);
      if (ids.size > 1) break;
    }

    if (ids.size > 1) break;
    if (ids.size === 1 && ids.has(wantedId) && node.querySelector('img')) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 120) best = node;
    }
  }

  return best || link.parentElement;
}

function candidateCards() {
  const cards = new Set();
  for (const link of document.querySelectorAll('a[href*="/item/"]')) {
    if (!productIdFromHref(link.href)) continue;
    const card = locateCard(link);
    if (card) cards.add(card);
  }
  return [...cards];
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
    width: 'min(340px, calc(100% - 12px))',
    maxHeight: '360px',
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
  summary.style.marginBottom = '8px';
  summary.textContent = `${result.count} SKU${result.count === 1 ? '' : 's'} · ${money(result.min, currency)} – ${money(result.max, currency)}`;
  panel.appendChild(summary);

  const locale = document.createElement('div');
  Object.assign(locale.style, { marginBottom: '8px', color: '#666', fontSize: '10px' });
  locale.textContent = `${result.prefs?.country || '?'} / ${currency} · ${result.prefs?.source || 'unknown locale source'}`;
  panel.appendChild(locale);

  const list = document.createElement('div');
  for (const sku of result.skus) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '8px',
      padding: '5px 0',
      borderTop: '1px solid #eee'
    });

    const id = document.createElement('span');
    id.textContent = `SKU ${sku.skuId}`;
    id.title = sku.skuId;
    Object.assign(id.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#555' });

    const price = document.createElement('strong');
    price.textContent = sku.salePriceString || money(sku.salePrice, sku.currency || currency);
    if (sku.discount) price.title = sku.discount;

    row.append(id, price);
    list.appendChild(row);
  }
  panel.appendChild(list);
  card.appendChild(panel);
}

function attachXray(card, productId) {
  if (card.dataset.aliPriceXraySeen === productId) return;
  card.dataset.aliPriceXraySeen = productId;
  ensurePositioned(card);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Xray';
  button.title = 'Show all AliExpress SKU prices';
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

    if (button.dataset.loading === '1') return;
    button.dataset.loading = '1';
    const previous = button.textContent;
    button.textContent = '…';

    try {
      const result = await api.runtime.sendMessage({ type: 'xray:fetch-skus', productId });
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

function scan() {
  let attached = 0;
  for (const card of candidateCards()) {
    const productId = productIdFromElement(card);
    if (!productId || card.dataset.aliPriceXraySeen === productId) continue;
    attachXray(card, productId);
    attached += 1;
  }
  if (attached) log(`attached to ${attached} cards`);
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
