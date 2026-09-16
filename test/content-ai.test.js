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

  assert.deepEqual(Array.from(rows, (row) => row.sku.skuId), ['same']);
});

test('AI shortlist prioritizes matching model and tip facts even when free-text scores tie', () => {
  const context = loadAiMatcher();
  context.xraySetReference('source', { skuId: 'ref', label: 'HS-02B-3 Tips' }, true);

  const rows = context.xrayAiCandidateRows({
    skus: [
      { skuId: 'generic-1', label: 'HS-02B Toolbox', salable: true },
      { skuId: 'generic-2', label: 'HS02B iron', salable: true },
      { skuId: 'generic-3', label: '02B Toolbox', salable: true },
      { skuId: 'generic-4', label: '02B iron only', salable: true },
      { skuId: 'generic-5', label: 'HS02B Toolbox Set', salable: true },
      { skuId: 'generic-6', label: '02B soldering iron', salable: true },
      { skuId: 'wanted', label: '02b n toolbox n 3tip', salable: true }
    ]
  });

  assert.equal(rows.length, 6);
  assert.equal(rows[0].sku.skuId, 'wanted');
  assert.equal(rows[0].agreement.modelAgreement, true);
  assert.equal(rows[0].agreement.tipAgreement, true);
  assert.ok(rows.some((row) => row.sku.skuId === 'wanted'));
});

test('hard variant contradiction beats an identical reused thumbnail', async () => {
  const context = loadAiMatcher();
  context.xraySetReference('source', {
    skuId: 'ref',
    label: 'HS-02B-3 Tips-Box',
    imageUrl: 'https://ae01.alicdn.com/kf/shared.jpg'
  }, true);

  const match = await context.xrayBestSkuForResult({
    skus: [
      {
        skuId: 'wrong',
        label: '02B n Toolbox n 6TIP',
        imageUrl: 'https://ae01.alicdn.com/kf/shared.jpg',
        salePrice: 8,
        salable: true
      },
      {
        skuId: 'same',
        label: '02B n Toolbox n 3TIP',
        salePrice: 10,
        salable: true
      }
    ]
  });

  assert.equal(match.sku.skuId, 'same');
  assert.ok(match.score >= 0.8, `expected same variant to remain confident, got ${match.score}`);
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
    if (message?.type === 'xray:ai-debug') return { ok: true };
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

  const aiBatchMessages = messages.filter((message) => message?.type === 'xray:ai-match-batch');
  assert.equal(aiBatchMessages.length, 1);
  assert.equal(aiBatchMessages[0].groups[0].candidates.some((candidate) => 'salePrice' in candidate), false);
  assert.equal(outcome.resolved, 1);
  assert.equal(matches[0].match.sku.skuId, 'candidate');
  assert.equal(matches[0].match.ai.provider, 'gemini');
  assert.ok(matches[0].match.score >= 0.9);
});

test('AI batches more than 24 ambiguous groups without dropping later listings', async () => {
  const aiBatchMessages = [];
  const context = loadAiMatcher(async (message) => {
    if (message?.type === 'xray:ai-debug') return { ok: true };
    aiBatchMessages.push(message);
    return {
      ok: true,
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      matches: message.groups.map((group) => ({
        groupId: group.id,
        candidateId: group.candidates[0].id,
        confidence: 0.9,
        reason: 'same variant'
      }))
    };
  });
  context.xraySetReference('source', { skuId: 'ref', label: 'Red 5000mAh battery' }, true);

  const matches = [];
  for (let index = 0; index < 25; index += 1) {
    const result = {
      ok: true,
      skus: [
        { skuId: `candidate-${index}`, label: 'Crimson battery 5Ah', salePrice: 10, salable: true },
        { skuId: `other-${index}`, label: 'Blue battery 8Ah', salePrice: 12, salable: true }
      ]
    };
    const local = await context.xrayBestSkuForResult(result);
    matches.push({ candidate: { productId: `p${index}` }, result, match: local });
  }

  const outcome = await context.xrayAiApplyMatches(matches, null);

  assert.equal(aiBatchMessages.length, 2);
  assert.equal(aiBatchMessages[0].groups.length, 24);
  assert.equal(aiBatchMessages[1].groups.length, 1);
  assert.equal(aiBatchMessages[1].groups[0].id, 'p24');
  assert.equal(outcome.checked, 25);
  assert.equal(outcome.resolved, 25);
  assert.equal(matches[24].match.sku.skuId, 'candidate-24');
});

test('AI cannot select a candidate that was not in the local shortlist', async () => {
  const context = loadAiMatcher(async (message) => {
    if (message?.type === 'xray:ai-debug') return { ok: true };
    return {
      ok: true,
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      matches: [{ groupId: 'p1', candidateId: 'invented', confidence: 0.99, reason: 'invalid' }]
    };
  });
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
