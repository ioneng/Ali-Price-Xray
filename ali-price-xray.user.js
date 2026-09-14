// ==UserScript==
// @name         Ali-Price-Xray
// @namespace    https://github.com/ioneng/Ali-Price-Xray
// @version      0.0.1
// @description  Expose AliExpress SKU pricing behind search cards without hiding variants.
// @author       ioneng
// @match        https://www.aliexpress.com/*
// @match        https://*.aliexpress.com/*
// @match        https://www.aliexpress.us/*
// @match        https://*.aliexpress.us/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const TAG = '[Ali-Price-Xray]';

  function log(...args) {
    console.debug(TAG, ...args);
  }

  function extractProductId(root) {
    const links = [];

    if (root instanceof HTMLAnchorElement) links.push(root);
    links.push(...root.querySelectorAll?.('a[href*="/item/"]') ?? []);

    for (const link of links) {
      const match = link.href.match(/\/item\/(\d+)\.html/i);
      if (match) return match[1];
    }

    return root.getAttribute?.('data-product-id') ||
      root.getAttribute?.('data-item-id') ||
      root.getAttribute?.('data-id') ||
      null;
  }

  function candidateCards() {
    const cards = new Set();

    for (const link of document.querySelectorAll('a[href*="/item/"]')) {
      let node = link;
      for (let depth = 0; depth < 8 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (!node) break;

        const itemLinks = node.querySelectorAll('a[href*="/item/"]');
        if (itemLinks.length === 1) {
          cards.add(node);
          break;
        }
      }
    }

    return [...cards];
  }

  function attachProbe(card, productId) {
    if (card.dataset.aliPriceXraySeen === '1') return;
    card.dataset.aliPriceXraySeen = '1';

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.textContent = 'Xray';
    badge.title = `Ali-Price-Xray product ${productId}`;
    Object.assign(badge.style, {
      position: 'absolute',
      zIndex: '20',
      top: '6px',
      right: '6px',
      padding: '3px 7px',
      border: '1px solid rgba(0,0,0,.25)',
      borderRadius: '999px',
      background: 'rgba(255,255,255,.92)',
      color: '#111',
      font: '12px/1.3 system-ui, sans-serif',
      cursor: 'pointer'
    });

    const computed = getComputedStyle(card);
    if (computed.position === 'static') card.style.position = 'relative';

    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      log('product', productId, 'card', card);
      alert(`Ali-Price-Xray\nProduct ID: ${productId}\n\nSKU retrieval is the next milestone.`);
    });

    card.appendChild(badge);
  }

  function scan() {
    let attached = 0;
    for (const card of candidateCards()) {
      const productId = extractProductId(card);
      if (!productId) continue;
      if (card.dataset.aliPriceXraySeen === '1') continue;
      attachProbe(card, productId);
      attached += 1;
    }
    if (attached) log(`attached to ${attached} cards`);
  }

  let scanTimer = 0;
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 120);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scan();
  log('loaded on', location.href);
})();
