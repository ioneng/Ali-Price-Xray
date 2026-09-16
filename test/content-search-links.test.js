const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSearchLinks(links = []) {
  const context = {
    console,
    URL,
    location: { href: 'https://www.aliexpress.com/w/wholesale-test.html' },
    HTMLAnchorElement: function HTMLAnchorElement() {},
    document: {
      querySelectorAll: () => links
    },
    productIdFromHref: () => null,
    productIdFromElement: () => null,
    distinctProductIds: () => new Set(),
    candidateCards: () => [],
    locateCard: (link) => link.card || null,
    scan: () => {},
    log: () => {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'content-search-links.js'),
    'utf8'
  );
  vm.runInContext(source, context);
  return context;
}

test('extracts product IDs from BundleDeals3 search-result links', () => {
  const context = loadSearchLinks();
  const href = 'https://www.aliexpress.com/ssr/300000512/BundleDeals3?businessCode=guide&productIds=1005012218235654:12000057789369652&sourceName=SEARCHProduct';
  assert.equal(context.productIdFromHref(href), '1005012218235654');
});

test('extracts product IDs from slugged p4p item links', () => {
  const context = loadSearchLinks();
  const href = 'https://www.aliexpress.com/item/Some%2BProduct%2BName/1005012018146833.html?p4p_pvid=test';
  assert.equal(context.productIdFromHref(href), '1005012018146833');
});

test('candidate discovery includes BundleDeals cards but ignores side-cart links', () => {
  const bundleCard = { name: 'bundle-card' };
  const standardCard = { name: 'standard-card' };
  const links = [
    {
      href: 'https://www.aliexpress.com/ssr/300000512/BundleDeals3?productIds=1005012218235654:12000057789369652',
      closest: () => null,
      card: bundleCard
    },
    {
      href: 'https://www.aliexpress.com/item/1005006449595941.html',
      closest: (selector) => selector === '.root-sidecart' ? {} : null,
      card: { name: 'sidecart-card' }
    },
    {
      href: 'https://www.aliexpress.com/item/1005010746975365.html',
      closest: () => null,
      card: standardCard
    }
  ];

  const context = loadSearchLinks(links);
  const candidates = context.candidateCards();

  assert.deepEqual(
    Array.from(candidates, (candidate) => String(candidate.productId)),
    ['1005012218235654', '1005010746975365']
  );
  assert.equal(candidates[0].card, bundleCard);
  assert.equal(candidates[1].card, standardCard);
});
