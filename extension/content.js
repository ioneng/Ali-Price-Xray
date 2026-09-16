const api = globalThis.browser ?? globalThis.chrome;
const TAG = '[Ali-Price-Xray]';

const log = (...args) => console.debug(TAG, ...args);
const isMobileLayout = () => /Android/i.test(navigator.userAgent)
  || window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const isWideMobileLayout = () => isMobileLayout() && (
  window.matchMedia('(orientation: landscape)').matches
  || (/Android/i.test(navigator.userAgent) && !/\bMobile\b/i.test(navigator.userAgent))
);

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

function moneyWithCurrency(value, currency) {
  if (!Number.isFinite(value)) return '—';
  const code = String(currency || '').toUpperCase();
  const prefixes = {
    AUD: 'AU$',
    USD: 'US$',
    NZD: 'NZ$',
    CAD: 'CA$',
    SGD: 'SG$',
    HKD: 'HK$'
  };
  const prefix = prefixes[code];
  if (!prefix) return money(value, code);
  try {
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    return `${prefix}${number}`;
  } catch {
    return `${prefix}${value.toFixed(2)}`;
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
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const overlay = document.createElement('div');
  overlay.className = 'ali-price-xray-image-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label ? `${label} image preview` : 'SKU option image preview');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    paddingTop: mobile ? 'max(12px, env(safe-area-inset-top))' : '24px',
    paddingRight: mobile ? 'max(12px, env(safe-area-inset-right))' : '24px',
    paddingBottom: mobile ? 'max(12px, env(safe-area-inset-bottom))' : '24px',
    paddingLeft: mobile ? 'max(12px, env(safe-area-inset-left))' : '24px',
    background: 'rgba(0,0,0,.76)',
    cursor: 'zoom-out',
    overscrollBehavior: 'contain'
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    width: mobile ? '100%' : 'auto',
    maxWidth: mobile ? '100%' : 'min(760px, 90vw)',
    maxHeight: mobile ? 'calc(100dvh - 24px)' : '90vh',
    boxSizing: 'border-box',
    padding: mobile ? '8px' : '10px',
    position: 'relative',
    overflow: 'auto',
    overscrollBehavior: 'contain',
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
    maxHeight: mobile ? 'calc(100dvh - 112px)' : '78vh',
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

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close image preview';
  close.setAttribute('aria-label', 'Close image preview');
  Object.assign(close.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: mobile ? '44px' : '32px',
    height: mobile ? '44px' : '32px',
    padding: '0',
    border: '1px solid rgba(0,0,0,.18)',
    borderRadius: '999px',
    background: 'rgba(255,255,255,.94)',
    color: '#333',
    boxShadow: '0 1px 5px rgba(0,0,0,.22)',
    font: mobile ? '26px/1 system-ui, sans-serif' : '20px/1 system-ui, sans-serif',
    cursor: 'pointer',
    touchAction: 'manipulation'
  });

  const closePreview = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    previousFocus?.focus({ preventScroll: true });
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') closePreview();
  };

  box.append(image, caption, close);
  overlay.appendChild(box);
  overlay.addEventListener('click', closePreview);
  box.addEventListener('click', (event) => event.stopPropagation());
  close.addEventListener('click', closePreview);
  document.addEventListener('keydown', onKeyDown, true);
  document.documentElement.appendChild(overlay);
  close.focus({ preventScroll: true });
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
    thumb.tabIndex = 0;
    thumb.setAttribute('role', 'button');
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
    const openPreview = (event) => {
      event.preventDefault();
      event.stopPropagation();
      showImagePreview(imageUrl, skuDisplayLabel(sku));
    };
    thumb.addEventListener('click', openPreview);
    thumb.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openPreview(event);
    });
    thumb.addEventListener('error', () => thumb.remove());
    row.appendChild(thumb);
  }

  const left = document.createElement('div');
  left.style.minWidth = '0';

  const label = document.createElement('div');
  label.textContent = skuDisplayLabel(sku);
  const group = sku.xrayVisibleGroup;
  label.title = group?.rawCount > 1
    ? `${group.rawCount} backend SKU paths\nRepresentative SKU ${sku.skuId}`
    : `SKU ${sku.skuId}${sku.skuPath ? `\npath ${sku.skuPath}` : ''}`;
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
  const availabilityText = group?.rawCount > 1
    ? (sku.salable === true
      ? `${group.saleableCount} saleable of ${group.rawCount} backend paths`
      : (sku.salable === false
        ? `sold out across ${group.rawCount} backend paths`
        : `${group.unknownCount} of ${group.rawCount} backend paths have unknown availability`))
    : (sku.salable === false
      ? 'sold out'
      : (sku.salable === true ? 'saleable' : 'saleability unknown'));
  const skuPrefix = group?.rawCount > 1 ? '' : `SKU ${sku.skuId} · `;
  meta.textContent = `${skuPrefix}${availabilityText}`;
  left.appendChild(meta);

  const price = document.createElement('strong');
  price.textContent = group && Number.isFinite(group.min) && Number.isFinite(group.max) && group.min !== group.max
    ? `${money(group.min, sku.currency || currency)} – ${money(group.max, sku.currency || currency)}`
    : money(sku.salePrice, sku.currency || currency);
  price.style.fontSize = mobile ? '14px' : '12px';
  price.style.whiteSpace = 'nowrap';
  if (sku.discount) price.title = sku.discount;

  row.append(left, price);
  return row;
}

function renderPanel(card, result, anchor) {
  removePanel(card, result.productId);
  ensurePositioned(card);

  const mobile = isMobileLayout();
  const wideMobile = isWideMobileLayout();
  const anchorRect = anchor?.getBoundingClientRect();
  const anchorOnLeft = wideMobile
    && Number.isFinite(anchorRect?.left)
    && anchorRect.left + (anchorRect.width / 2) < window.innerWidth / 2;
  const panel = document.createElement('div');
  panel.className = 'ali-price-xray-panel';
  panel.dataset.productId = String(result.productId);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Ali-Price-Xray product ${result.productId}`);
  Object.assign(panel.style, mobile ? {
    position: 'fixed',
    zIndex: '2147483646',
    top: 'max(8px, env(safe-area-inset-top))',
    right: wideMobile && anchorOnLeft ? 'auto' : 'max(8px, env(safe-area-inset-right))',
    bottom: 'auto',
    left: wideMobile && !anchorOnLeft ? 'auto' : 'max(8px, env(safe-area-inset-left))',
    width: wideMobile ? '50vw' : 'auto',
    maxWidth: wideMobile ? '50vw' : 'none',
    maxHeight: 'calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
    padding: mobile ? '8px' : '10px',
    border: '1px solid rgba(0,0,0,.25)',
    borderRadius: '14px',
    background: 'rgba(255,255,255,.99)',
    color: '#111',
    boxShadow: '0 8px 32px rgba(0,0,0,.32)',
    font: '14px/1.25 system-ui, sans-serif'
  } : {
    position: 'absolute',
    zIndex: '2147483646',
    top: '36px',
    right: '6px',
    width: 'min(430px, calc(100% - 12px))',
    maxHeight: '460px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
    padding: '10px',
    border: '1px solid rgba(0,0,0,.25)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,.98)',
    color: '#111',
    boxShadow: '0 8px 28px rgba(0,0,0,.22)',
    font: '12px/1.25 system-ui, sans-serif'
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    margin: mobile ? '-8px -8px 4px' : '0 0 4px',
    padding: mobile ? '4px 8px' : '0',
    borderBottom: mobile ? '1px solid #eee' : '0',
    background: mobile ? 'rgba(255,255,255,.99)' : 'transparent'
  });

  const titleGroup = document.createElement('div');
  Object.assign(titleGroup.style, {
    flex: '1',
    minWidth: '0'
  });

  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.textContent = 'From Price Xray:';

  const itemNumber = document.createElement('div');
  itemNumber.textContent = `Item ${result.productId}`;
  Object.assign(itemNumber.style, {
    marginTop: '1px',
    color: '#777',
    fontSize: mobile ? '11px' : '10px',
    lineHeight: '1.15'
  });
  titleGroup.append(title, itemNumber);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close Ali-Price-Xray');
  Object.assign(close.style, {
    width: mobile ? '36px' : '28px',
    height: mobile ? '36px' : '28px',
    minWidth: mobile ? '36px' : '28px',
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
  header.append(titleGroup, close);
  panel.appendChild(header);

  if (!result.ok) {
    panel.style.overflow = 'auto';
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

  const visibleSkus = xrayGroupVisibleSkus(result.skus);
  const currency = result.prefs?.currency || visibleSkus.find((sku) => sku.currency)?.currency || 'AUD';
  const available = visibleSkus.filter((sku) => sku.salable === true);
  const unknown = visibleSkus.filter((sku) => sku.salable == null);
  const unavailable = visibleSkus.filter((sku) => sku.salable === false);
  const summary = document.createElement('div');
  summary.style.marginBottom = '2px';
  summary.textContent = `${available.length} available option${available.length === 1 ? '' : 's'}`;
  panel.appendChild(summary);

  if (result.targetPriceString) {
    const target = document.createElement('div');
    Object.assign(target.style, { marginBottom: '3px', fontWeight: '700', color: '#b00020' });
    target.textContent = `Listed Price: ${result.targetPriceString}`;
    panel.appendChild(target);
  }

  const scrollBody = document.createElement('div');
  scrollBody.className = 'ali-price-xray-option-scroll';
  Object.assign(scrollBody.style, {
    flex: '1 1 auto',
    minHeight: '0',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch'
  });

  const mainList = document.createElement('div');
  for (const sku of [...available, ...unknown]) mainList.appendChild(createSkuRow(sku, currency, false));
  scrollBody.appendChild(mainList);

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
    scrollBody.appendChild(details);
  }

  panel.appendChild(scrollBody);
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
    border: '1px solid #2f2f2f',
    borderRadius: '999px',
    background: '#3f3f3f',
    color: '#fff',
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
      renderPanel(card, result || { ok: false, productId, error: 'No response from extension background.' }, button);
    } catch (error) {
      log('SKU request error', error);
      renderPanel(card, { ok: false, productId, error: error?.message || String(error) }, button);
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

function ensureLoadingNotice() {
  let notice = document.getElementById('ali-price-xray-loading');
  if (notice) return notice;

  notice = document.createElement('div');
  notice.id = 'ali-price-xray-loading';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  Object.assign(notice.style, {
    position: 'fixed',
    zIndex: '2147483647',
    top: 'max(112px, calc(env(safe-area-inset-top) + 112px))',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'max-content',
    maxWidth: 'calc(100vw - 24px)',
    boxSizing: 'border-box',
    padding: isMobileLayout() ? '18px 28px' : '16px 26px',
    border: '2px solid #86c995',
    borderRadius: '12px',
    background: 'rgba(220,252,231,.97)',
    color: '#14532d',
    boxShadow: '0 6px 24px rgba(0,0,0,.18)',
    font: isMobileLayout() ? '700 26px/1.25 system-ui, sans-serif' : '700 24px/1.25 system-ui, sans-serif',
    letterSpacing: '0',
    textAlign: 'center',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    opacity: '1',
    transition: 'opacity 3s ease',
    pointerEvents: 'none'
  });
  document.documentElement.appendChild(notice);
  return notice;
}

function attachXrayToCandidates(candidates) {
  const badge = ensureDebugBadge();
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

const XRAY_LOAD_SCROLL_STEP_VIEWPORTS = 2;
const XRAY_LOAD_SCROLL_BOTTOM_HOLD_MS = 500;
const XRAY_LOAD_FINAL_WAIT_MS = 500;
const xrayLoadState = {
  active: true,
  autoScrollStarted: false,
  sweeping: false,
  progress: 0,
  candidates: new Map()
};

let timer = 0;
function scheduleScan(delay = 150) {
  clearTimeout(timer);
  timer = window.setTimeout(scan, delay);
}

function xrayWait(delay) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function xrayNextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function xrayRememberCandidates(candidates) {
  for (const candidate of candidates) {
    xrayLoadState.candidates.set(String(candidate.productId), candidate);
  }
}

function xrayUpdateLoadingProgress(percent) {
  xrayLoadState.progress = Math.max(xrayLoadState.progress, Math.min(99, Math.round(percent)));
  const notice = ensureLoadingNotice();
  const text = `Price Xray Loading ${xrayLoadState.progress}%`;
  if (notice.textContent !== text) notice.textContent = text;
}

async function xraySweepToBottom(startX, offsetViewports, progressStart, progressEnd) {
  const scrollingElement = document.scrollingElement || document.documentElement;
  const viewportHeight = Math.max(window.innerHeight, 1);
  const step = viewportHeight * XRAY_LOAD_SCROLL_STEP_VIEWPORTS;
  const initialBottom = Math.max(0, scrollingElement.scrollHeight - viewportHeight);
  let top = Math.min(initialBottom, viewportHeight * offsetViewports);

  window.scrollTo({ left: startX, top, behavior: 'auto' });
  await xrayNextAnimationFrame();
  while (true) {
    const bottom = Math.max(0, scrollingElement.scrollHeight - viewportHeight);
    xrayRememberCandidates(candidateCards());
    const ratio = bottom ? top / bottom : 1;
    xrayUpdateLoadingProgress(progressStart + ((progressEnd - progressStart) * ratio));
    if (top >= bottom) break;
    top = Math.min(bottom, top + step);
    window.scrollTo({ left: startX, top, behavior: 'auto' });
    await xrayNextAnimationFrame();
  }
  await xrayWait(XRAY_LOAD_SCROLL_BOTTOM_HOLD_MS);
  xrayRememberCandidates(candidateCards());
  xrayUpdateLoadingProgress(progressEnd);
}

async function xrayNudgeNearStart(startX, startY) {
  const scrollingElement = document.scrollingElement || document.documentElement;
  const viewportHeight = Math.max(window.innerHeight, 1);
  const bottom = Math.max(0, scrollingElement.scrollHeight - viewportHeight);
  const nudgeTop = Math.min(bottom, startY + Math.max(160, Math.round(viewportHeight / 4)));

  window.scrollTo({ left: startX, top: startY, behavior: 'auto' });
  await xrayNextAnimationFrame();
  window.scrollTo({ left: startX, top: nudgeTop, behavior: 'auto' });
  await xrayNextAnimationFrame();
  await xrayNextAnimationFrame();
  xrayRememberCandidates(candidateCards());
  window.scrollTo({ left: startX, top: startY, behavior: 'auto' });
  await xrayNextAnimationFrame();
}

function xrayFinishInitialLoad() {
  if (!xrayLoadState.active) return;
  xrayLoadState.active = false;
  const notice = ensureLoadingNotice();
  notice.textContent = 'Price Xray Loading 100%';
  const candidates = [...xrayLoadState.candidates.values()]
    .filter(({ card }) => card?.isConnected !== false);
  attachXrayToCandidates(candidates);
  window.requestAnimationFrame(() => {
    notice.style.opacity = '0';
    window.setTimeout(() => notice.remove(), 3000);
  });
}

async function xrayRunInitialScrollSweep(startX, startY) {
  try {
    await xraySweepToBottom(startX, 0, 1, 47);
    await xraySweepToBottom(startX, 1, 48, 92);
    await xrayNudgeNearStart(startX, startY);
    xrayUpdateLoadingProgress(95);
    const waitStartedAt = Date.now();
    while (Date.now() - waitStartedAt < XRAY_LOAD_FINAL_WAIT_MS) {
      await xrayWait(50);
      xrayRememberCandidates(candidateCards());
      const ratio = (Date.now() - waitStartedAt) / XRAY_LOAD_FINAL_WAIT_MS;
      xrayUpdateLoadingProgress(95 + (4 * ratio));
    }
  } catch (error) {
    log('initial scroll sweep failed', error);
  } finally {
    xrayLoadState.sweeping = false;
    window.scrollTo({ left: startX, top: startY, behavior: 'auto' });
    xrayRememberCandidates(candidateCards());
    xrayFinishInitialLoad();
  }
}

function triggerInitialLazyLoad() {
  if (xrayLoadState.autoScrollStarted) return;
  xrayLoadState.autoScrollStarted = true;
  xrayLoadState.sweeping = true;
  xrayRunInitialScrollSweep(window.scrollX, window.scrollY);
}

function scan() {
  const candidates = candidateCards();
  xrayRememberCandidates(candidates);
  if (!xrayLoadState.active) {
    attachXrayToCandidates(candidates);
    return;
  }

  if (!candidates.length && !document.querySelector('a[href*="/item/"]')) return;
  xrayUpdateLoadingProgress(0);
  triggerInitialLazyLoad();
}

new MutationObserver(() => scheduleScan()).observe(document.documentElement, { childList: true, subtree: true });
scan();
log('content script loaded', location.href);
