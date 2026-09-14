const api = globalThis.browser ?? globalThis.chrome;
const TAG = '[Ali-Price-Xray]';

const log = (...args) => console.debug(TAG, ...args);
const isMobileLayout = () => window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;

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

function findPanel(productId) {
  return [...document.querySelectorAll('.ali-price-xray-panel')]
    .find((panel) => panel.dataset.productId === String(productId)) || null;
}

function removePanel(card, productId) {
  card?.querySelector(':scope > .ali-price-xray-panel')?.remove();
  if (productId) findPanel(productId)?.remove();
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

function normalizedImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function showImagePreview(url, label) {
  const src = normalizedImageUrl(url);
  if (!src) return;
  document.querySelector('.ali-price-xray-image-preview')?.remove();

  const mobile = isMobileLayout();
  const overlay = document.createElement('div');
  overlay.className = 'ali-price-xray-image-preview';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    padding: mobile ? '12px' : '24px',
    background: 'rgba(0,0,0,.76)',
    cursor: 'zoom-out'
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    width: mobile ? '100%' : 'auto',
    maxWidth: mobile ? '100%' : 'min(760px, 90vw)',
    maxHeight: mobile ? 'calc(100vh - 24px)' : '90vh',
    boxSizing: 'border-box',
    padding: mobile ? '8px' : '10px',
    borderRadius: '12px',
    background: '#fff',
    boxShadow: '0 16px 50px rgba(0,0,0,.45)',
    cursor: 'default'
  });

  const image = document.createElement('img');
  image.src = src;
  image.alt = label || 'SKU option image';
  Object.assign(image.style, {
    display: 'block',
    maxWidth: '100%',
    width: mobile ? '100%' : 'auto',
    maxHeight: mobile ? 'calc(100vh - 100px)' : '78vh',
    objectFit: 'contain',
    margin: '0 auto'
  });

  const caption = document.createElement('div');
  caption.textContent = label || 'SKU option';
  Object.assign(caption.style, {
    marginTop: '8px',
    color: '#222',
    font: mobile ? '14px/1.35 system-ui, sans-serif' : '12px/1.35 system-ui, sans-serif',
    textAlign: 'center'
  });

  box.append(image, caption);
  overlay.appendChild(box);
  overlay.addEventListener('click', () => overlay.remove());
  box.addEventListener('click', (event) => event.stopPropagation());
  document.documentElement.appendChild(overlay);
}

function createSkuRow(sku, currency, unavailable = false) {
  const mobile = isMobileLayout();
  const row = document.createElement('div');
  const imageUrl = normalizedImageUrl(sku.imageUrl);
  const thumbSize = mobile ? 58 : 46;
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: imageUrl ? `${thumbSize + 2}px minmax(0, 1fr) auto` : 'minmax(0, 1fr) auto',
    gap: mobile ? '10px' : '8px',
    padding: mobile ? '10px 0' : '7px 0',
    borderTop: '1px solid #eee',
    alignItems: 'center',
    opacity: unavailable ? '0.58' : '1'
  });

  if (imageUrl) {
    const thumb = document.createElement('img');
    thumb.src = imageUrl;
    thumb.alt = skuDisplayLabel(sku);
    thumb.loading = 'lazy';
    thumb.title = 'Tap to enlarge option image';
    Object.assign(thumb.style, {
      width: `${thumbSize}px`,
      height: `${thumbSize}px`,
      boxSizing: 'border-box',
      objectFit: 'contain',
      border: '1px solid #ddd',
      borderRadius: '7px',
      background: '#fff',
      cursor: 'zoom-in',
      touchAction: 'manipulation'
    });
    thumb.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showImagePreview(imageUrl, skuDisplayLabel(sku));
    });
    thumb.addEventListener('error', () => thumb.remove());
    row.appendChild(thumb);
  }

  const left = document.createElement('div');
  left.style.minWidth = '0';

  const label = document.createElement('div');
  label.textContent = skuDisplayLabel(sku);
  label.title = `SKU ${sku.skuId}${sku.skuPath ? `\npath ${sku.skuPath}` : ''}`;
  Object.assign(label.style, {
    color: '#333',
    fontSize: mobile ? '14px' : '12px',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  });
  left.appendChild(label);

  const meta = document.createElement('div');
  Object.assign(meta.style, {
    marginTop: '3px',
    color: '#888',
    fontSize: mobile ? '11px' : '9px',
    overflowWrap: 'anywhere'
  });
  const stockText = sku.salable === false
    ? 'sold out'
    : (sku.salable === true ? `saleable${Number.isFinite(sku.stock) ? ` · stock ${sku.stock}` : ''}` : 'saleability unknown');
  meta.textContent = `SKU ${sku.skuId} · ${stockText}${sku.priceSource ? ` · ${sku.priceSource}` : ''}`;
  left.appendChild(meta);

  const price = document.createElement('strong');
  price.textContent = sku.salePriceString || money(sku.salePrice, sku.currency || currency);
  price.style.fontSize = mobile ? '14px' : '12px';
  price.style.whiteSpace = 'nowrap';
  if (sku.discount) price.title = sku.discount;

  row.append(left, price);
  return row;
}

function renderPanel(card, result) {
  removePanel(card, result.productId);
  ensurePositioned(card);

  const mobile = isMobileLayout();
  const panel = document.createElement('div');
  panel.className = 'ali-price-xray-panel';
  panel.dataset.productId = String(result.productId);
  Object.assign(panel.style, mobile ? {
    position: 'fixed',
    zIndex: '2147483646',
    top: 'max(8px, env(safe-area-inset-top))',
    right: '8px',
    bottom: 'max(8px, env(safe-area-inset-bottom))',
    left: '8px',
    width: 'auto',
    maxHeight: 'none',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
    padding: '12px',
    border: '1px solid rgba(0,0,0,.25)',
    borderRadius: '14px',
    background: 'rgba(255,255,255,.99)',
    color: '#111',
    boxShadow: '0 8px 32px rgba(0,0,0,.32)',
    font: '14px/1.4 system-ui, sans-serif'
  } : {
    position: 'absolute',
    zIndex: '2147483646',
    top: '36px',
    right: '6px',
    width: 'min(430px, calc(100% - 12px))',
    maxHeight: '460px',
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
  close.setAttribute('aria-label', 'Close Ali-Price-Xray');
  Object.assign(close.style, {
    float: 'right',
    width: mobile ? '44px' : '28px',
    height: mobile ? '44px' : '28px',
    minWidth: mobile ? '44px' : '28px',
    border: '0',
    borderRadius: '999px',
    background: mobile ? '#f2f2f2' : 'transparent',
    color: '#555',
    font: mobile ? '26px/1 system-ui, sans-serif' : '18px/1 system-ui, sans-serif',
    cursor: 'pointer',
    touchAction: 'manipulation'
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
  title.style.paddingRight = mobile ? '48px' : '28px';
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
      Object.assign(ret.style, { whiteSpace: 'pre-wrap', margin: '8px 0 0', fontSize: mobile ? '11px' : '10px' });
      panel.appendChild(ret);
    }
    (mobile ? document.documentElement : card).appendChild(panel);
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
  Object.assign(locale.style, { marginBottom: '8px', color: '#666', fontSize: mobile ? '11px' : '10px' });
  const context = result.debug?.contextFields?.length
    ? ` · context: ${result.debug.contextFields.join(', ')}`
    : '';
  locale.textContent = `${result.prefs?.country || '?'} / ${currency} · ${result.prefs?.source || 'unknown locale source'}${context}`;
  panel.appendChild(locale);

  const available = result.skus.filter((sku) => sku.salable === true);
  const unknown = result.skus.filter((sku) => sku.salable == null);
  const unavailable = result.skus.filter((sku) => sku.salable === false);

  const mainList = document.createElement('div');
  for (const sku of [...available, ...unknown]) mainList.appendChild(createSkuRow(sku, currency, false));
  panel.appendChild(mainList);

  if (unavailable.length) {
    const details = document.createElement('details');
    details.style.marginTop = mobile ? '12px' : '8px';

    const summaryToggle = document.createElement('summary');
    const setHiddenSkuLabel = () => {
      summaryToggle.textContent = details.open
        ? `Hide ${unavailable.length} unavailable SKU${unavailable.length === 1 ? '' : 's'}`
        : `Show ${unavailable.length} hidden / unavailable SKU${unavailable.length === 1 ? '' : 's'}`;
    };
    setHiddenSkuLabel();
    Object.assign(summaryToggle.style, {
      minHeight: mobile ? '44px' : 'auto',
      display: 'flex',
      alignItems: 'center',
      cursor: 'pointer',
      color: '#555',
      fontSize: mobile ? '13px' : '10px',
      fontWeight: '600',
      userSelect: 'none',
      touchAction: 'manipulation'
    });
    details.addEventListener('toggle', setHiddenSkuLabel);
    details.appendChild(summaryToggle);

    const soldOutList = document.createElement('div');
    for (const sku of unavailable) soldOutList.appendChild(createSkuRow(sku, currency, true));
    details.appendChild(soldOutList);
    panel.appendChild(details);
  }

  (mobile ? document.documentElement : card).appendChild(panel);
}

function attachXray(card, productId, productUrl) {
  if (card.dataset.aliPriceXraySeen === productId) return;
  card.dataset.aliPriceXraySeen = productId;
  ensurePositioned(card);

  const mobile = isMobileLayout();
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
    minWidth: mobile ? '56px' : 'auto',
    minHeight: mobile ? '44px' : 'auto',
    padding: mobile ? '8px 12px' : '4px 8px',
    border: '1px solid rgba(0,0,0,.28)',
    borderRadius: '999px',
    background: 'rgba(255,255,255,.96)',
    color: '#111',
    boxShadow: '0 1px 5px rgba(0,0,0,.15)',
    font: mobile ? '700 13px/1.3 system-ui, sans-serif' : '600 11px/1.3 system-ui, sans-serif',
    cursor: 'pointer',
    touchAction: 'manipulation'
  });

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const openPanel = findPanel(productId) || card.querySelector(':scope > .ali-price-xray-panel');
    if (openPanel) {
      openPanel.remove();
      return;
    }

    if (button.dataset.loading === '1') return;
    button.dataset.loading = '1';
    const previous = button.textContent;
    button.textContent = '…';

    try {
      const result = await api.runtime.sendMessage({ type: 'xray:fetch-skus', productId, productUrl });
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
  const mobile = isMobileLayout();
  Object.assign(badge.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: mobile ? '6px' : '8px',
    bottom: mobile ? 'max(6px, env(safe-area-inset-bottom))' : '8px',
    padding: mobile ? '5px 8px' : '4px 7px',
    borderRadius: '6px',
    background: 'rgba(20,20,20,.82)',
    color: '#fff',
    font: mobile ? '11px/1.2 system-ui, sans-serif' : '11px/1.2 system-ui, sans-serif',
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

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
scan();
log('content script loaded', location.href);
