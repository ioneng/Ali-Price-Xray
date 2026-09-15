const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMatcher() {
  const context = {
    console,
    URL,
    location: { href: 'https://www.aliexpress.com/' },
    normalizedImageUrl: (url) => {
      if (!url) return null;
      return url.startsWith('//') ? `https:${url}` : url;
    },
    skuDisplayLabel: (sku) => sku.label || '',
    createSkuRow: () => ({}),
    renderPanel: () => {},
    findPanel: () => null,
    ensureDebugBadge: () => ({ style: {} }),
    candidateCards: () => [],
    money: String,
    ensurePositioned: () => {},
    isMobileLayout: () => false,
    document: { querySelectorAll: () => [] },
    api: { runtime: { sendMessage: async () => null } },
    log: () => {},
    Image: function Image() {},
    getComputedStyle: () => ({ display: 'grid' })
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content-sort.js'), 'utf8');
  vm.runInContext(source, context);
  return context;
}

test('normalizes hyphenated model numbers for text matching', () => {
  const context = loadMatcher();
  const score = context.xrayTextSimilarity('HS-02A iron', 'HS02A soldering iron');
  assert.ok(score >= 0.75, `expected strong match, got ${score}`);
});

test('penalizes conflicting model numbers', () => {
  const context = loadMatcher();
  const score = context.xrayTextSimilarity('HS-02A', 'HS-02B');
  assert.ok(score < 0.25, `expected weak match, got ${score}`);
});

test('image disagreement can veto misleading identical text', () => {
  const context = loadMatcher();
  const score = context.xrayCombineSignals(1, 0.15);
  assert.ok(score < 0.58, `expected below acceptance threshold, got ${score}`);
});

test('strong text and image agreement remains confident', () => {
  const context = loadMatcher();
  const score = context.xrayCombineSignals(0.9, 0.85);
  assert.ok(score > 0.8, `expected confident match, got ${score}`);
});

test('canonicalizes common AliExpress image transform suffixes', () => {
  const context = loadMatcher();
  const a = context.xrayCanonicalImageKey('https://ae01.alicdn.com/kf/abc123.jpg_220x220q75.jpg_.webp');
  const b = context.xrayCanonicalImageKey('https://ae01.alicdn.com/kf/abc123.jpg');
  assert.equal(a, b);
});

test('dHash comparison reports identical hashes as exact match', () => {
  const context = loadMatcher();
  assert.equal(context.xrayHammingSimilarity('0101', '0101'), 1);
  assert.equal(context.xrayHammingSimilarity('0000', '1111'), 0);
});

test('keeps the best candidate for each selected reference', async () => {
  const context = loadMatcher();
  context.xraySetReference('source', { skuId: 'ref-a', label: '2C23T Standard' }, true);
  context.xraySetReference('source', { skuId: 'ref-b', label: '2C53T Standard' }, true);

  const match = await context.xrayBestSkuForResult({
    skus: [
      { skuId: 'sku-a', label: '2C23T Standard', salePrice: 82.4, salable: true },
      { skuId: 'sku-b', label: '2C53T Standard', salePrice: 107.77, salable: true }
    ]
  });

  assert.equal(match.referenceMatches.length, 2);
  const byReference = new Map(match.referenceMatches.map((item) => [item.reference.skuId, item.sku.skuId]));
  assert.equal(byReference.get('ref-a'), 'sku-a');
  assert.equal(byReference.get('ref-b'), 'sku-b');
});

test('recognizes a raw SKU inside a visible grouped row', () => {
  const context = loadMatcher();
  assert.equal(context.xraySkuContainsSkuId({
    skuId: 'representative',
    xrayVisibleGroup: { skuIds: ['raw-a', 'raw-b'] }
  }, 'raw-b'), true);
});
