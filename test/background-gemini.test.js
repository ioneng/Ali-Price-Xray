const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGemini({ enabled = true, fetchImpl } = {}) {
  let fetched = 0;
  let lastRequest = null;
  const context = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      fetched += 1;
      lastRequest = { url, init };
      if (fetchImpl) return fetchImpl(url, init);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify({
                matches: [{ groupId: 'g1', candidateId: 'c1', confidence: 0.91, reason: 'same variant' }]
              }) }]
            }
          }]
        })
      };
    },
    xrayExtensionApi: () => ({
      permissions: { contains: async () => true },
      runtime: { onMessage: { addListener: () => {} } }
    }),
    xrayGetAiSettings: async () => ({
      aiMatchingEnabled: enabled,
      aiProvider: 'gemini',
      aiModel: 'gemini-3.5-flash-lite'
    }),
    xrayGetGeminiApiKey: async () => 'test-key'
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background-gemini.js'), 'utf8');
  vm.runInContext(source, context);
  return {
    context,
    fetchCount: () => fetched,
    lastRequest: () => lastRequest
  };
}

test('normalizes and bounds Gemini batch input', () => {
  const { context } = loadGemini();
  const batch = context.xrayGeminiNormalizeBatch({
    references: [{ id: ' ref ', label: '  Model   A  ' }],
    groups: [{ id: ' group ', candidates: [{ id: ' c1 ', label: ' Candidate   One ' }] }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(batch)), {
    references: [{ id: 'ref', label: 'Model A' }],
    groups: [{ id: 'group', candidates: [{ id: 'c1', label: 'Candidate One' }] }]
  });
});

test('Gemini prompt treats omitted variant details as unknown rather than conflicts', () => {
  const { context } = loadGemini();
  const batch = context.xrayGeminiNormalizeBatch({
    references: [{ id: 'r1', label: 'HS-02B-3 Tips' }],
    groups: [{
      id: 'g1',
      candidates: [{ id: 'c1', label: '02B n Toolbox n 3TIP' }]
    }]
  });
  const prompt = context.xrayGeminiPrompt(batch);

  assert.match(prompt, /Only an explicit conflict in a variant-defining fact/i);
  assert.match(prompt, /omitted on the other is unknown, not a conflict/i);
  assert.match(prompt, /do not reject a candidate merely because one label names a package, box, bundle, or accessory detail/i);
  assert.match(prompt, /HS-02B-3 Tips/);
  assert.match(prompt, /02B n Toolbox n 3TIP/);
});

test('invalid Gemini candidate ids are converted to NONE', () => {
  const { context } = loadGemini();
  const batch = {
    references: [{ id: 'r1', label: 'Reference' }],
    groups: [{ id: 'g1', candidates: [{ id: 'c1', label: 'Candidate' }] }]
  };
  const matches = context.xrayGeminiValidateMatches({
    matches: [{ groupId: 'g1', candidateId: 'invented', confidence: 0.99, reason: 'bad id' }]
  }, batch);
  assert.equal(matches[0].candidateId, 'NONE');
});

test('disabled AI returns without contacting Gemini', async () => {
  const { context, fetchCount } = loadGemini({ enabled: false });
  const result = await context.xrayGeminiMatchBatch({
    references: [{ id: 'r1', label: 'Reference' }],
    groups: [{ id: 'g1', candidates: [{ id: 'c1', label: 'Candidate' }] }]
  });
  assert.equal(result.enabled, false);
  assert.equal(fetchCount(), 0);
});

test('Gemini request uses the configured model, API key header, stateless storage, and structured JSON', async () => {
  const { context, lastRequest } = loadGemini();
  const result = await context.xrayGeminiMatchBatch({
    references: [{ id: 'r1', label: 'Reference' }],
    groups: [{ id: 'g1', candidates: [{ id: 'c1', label: 'Candidate' }] }]
  });

  assert.equal(result.matches[0].candidateId, 'c1');
  const request = lastRequest();
  assert.match(request.url, /gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(request.init.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(request.init.body);
  assert.equal(body.store, false);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
});
