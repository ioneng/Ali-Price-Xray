const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAiMatcher(sendMessage = async () => ({ ok: true, enabled: false, matches: [] })) {
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
  for (const file of ['content-sort.js', 'content-ai.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8');
    vm.runInContext(source, context);
  }
  return context;
}

test('AI shortlist excludes candidates with deterministic hard contradictions', () => {
  const context = loadAiMatcher();
  context.xraySetReference('source', { skuId: 'ref', label: 'HS-02B-3 Tips-Box' }, true);

  const rows = context.xrayAiCandidateRows({
    skus: [
      { skuId: 'same', label: '02B n Toolbox n 3TIP', salable: true },
      { skuId: 'wrong', label: '02B n Toolbox n 6TIP', salable: true }
    ]
  });

  assert.deepEqual(rows.map((row) => row.sku.skuId), ['same']);
});

test('exact local structured matches bypass AI', async () => {
  const context = loadAiMatcher();
  context.xraySetReference('source', { skuId: 'ref', label: 'HS-02B-3 Tips-Box' }, true);
  const result = {
    skus: [{ skuId: 'same', label: '02B n Toolbox n 3TIP', salable: true }]
  };
  const match = await context.xrayBestSkuForResult(result);
  const shortlist = context.xrayAiCandidateRows(result);
  assert.equal(context.xrayAiNeedsHelp(match, shortlist), false);
});

test('weak semantic local matches are eligible for one AI fallback batch', async () => {
  const messages = [];
  const context = loadAiMatcher(async (message) => {
    messages.push(message);
    return {
      ok: true,
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      matches: [{ groupId: 'p1', candidateId: 'candidate', confidence: 0.9, reason: 'same capacity and colour wording' }]
    };
  });
  context.xraySetReference('source', { skuId: 'ref', label: 'Red 5000mAh battery' }, true);

  const result = {
    ok: true,
    skus: [
      { skuId: 'candidate', label: 'Crimson battery 5Ah', salePrice: 10, salable: true },
      { skuId: 'other', label: 'Blue battery 8Ah', salePrice: 12, salable: true }
    ]
  };
  const local = await context.xrayBestSkuForResult(result);
  const matches = [{ candidate: { productId: 'p1' }, result, match: local }];
  const outcome = await context.xrayAiApplyMatches(matches, null);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'xray:ai-match-batch');
  assert.equal(messages[0].groups[0].candidates.some((candidate) => 'salePrice' in candidate), false);
  assert.equal(outcome.resolved, 1);
  assert.equal(matches[0].match.sku.skuId, 'candidate');
  assert.equal(matches[0].match.ai.provider, 'gemini');
  assert.ok(matches[0].match.score >= 0.9);
});

test('AI cannot select a candidate that was not in the local shortlist', async () => {
  const context = loadAiMatcher(async () => ({
    ok: true,
    enabled: true,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    matches: [{ groupId: 'p1', candidateId: 'invented', confidence: 0.99, reason: 'invalid' }]
  }));
  context.xraySetReference('source', { skuId: 'ref', label: 'Red 5000mAh battery' }, true);

  const result = {
    ok: true,
    skus: [{ skuId: 'candidate', label: 'Crimson battery 5Ah', salePrice: 10, salable: true }]
  };
  const local = await context.xrayBestSkuForResult(result);
  const matches = [{ candidate: { productId: 'p1' }, result, match: local }];
  const originalSku = matches[0].match.sku.skuId;
  const outcome = await context.xrayAiApplyMatches(matches, null);

  assert.equal(outcome.resolved, 0);
  assert.equal(matches[0].match.sku.skuId, originalSku);
});
