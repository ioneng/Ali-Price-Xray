const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMatcher(sendMessage) {
  const context = {
    console,
    URL,
    location: { href: 'https://www.aliexpress.com/' },
    normalizedImageUrl: (url) => url || null,
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
    api: { runtime: { sendMessage } },
    log: () => {},
    Image: function Image() {},
    getComputedStyle: () => ({ display: 'grid' })
  };
  vm.createContext(context);
  for (const file of ['content-sort.js', 'content-ai.js', 'content-ai-images.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8');
    vm.runInContext(source, context);
  }
  return context;
}

test('Gemini requests include cached public image URLs for references and shortlisted candidates', async () => {
  const messages = [];
  const context = loadMatcher(async (message) => {
    if (message?.type === 'xray:ai-debug') return { ok: true };
    messages.push(message);
    return { ok: true, enabled: false, matches: [] };
  });

  context.xraySetReference('source', {
    skuId: 'ref',
    label: 'HS-02B-3 Tips',
    imageUrl: 'https://ae01.alicdn.com/kf/reference.jpg'
  }, true);

  context.testResult = {
    ok: true,
    skus: [{
      skuId: 'candidate',
      label: '02B n Toolbox n 3TIP',
      imageUrl: 'https://ae01.alicdn.com/kf/candidate.webp',
      salable: true
    }]
  };
  vm.runInContext("xraySortState.resultCache.set('p1', testResult)", context);

  await context.xrayAiRequestBatches(
    [{ id: 'source:ref', label: 'HS-02B-3 Tips' }],
    [{ id: 'p1', candidates: [{ id: 'candidate', label: '02B n Toolbox n 3TIP' }] }]
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].references[0].imageUrl, 'https://ae01.alicdn.com/kf/reference.jpg');
  assert.equal(messages[0].groups[0].candidates[0].imageUrl, 'https://ae01.alicdn.com/kf/candidate.webp');
});
