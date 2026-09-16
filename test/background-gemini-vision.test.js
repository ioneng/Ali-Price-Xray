const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadVision(fetchImpl) {
  const requests = [];
  const context = {
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return fetchImpl(requests.length, url, init);
    },
    xrayExtensionApi: () => ({
      permissions: { contains: async () => true },
      runtime: { onMessage: { addListener: () => {} } }
    }),
    xrayGetAiSettings: async () => ({
      aiMatchingEnabled: true,
      aiProvider: 'gemini',
      aiModel: 'gemini-3.5-flash-lite'
    }),
    xrayGetGeminiApiKey: async () => 'test-key'
  };
  vm.createContext(context);
  for (const file of ['background-gemini.js', 'background-gemini-vision.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8');
    vm.runInContext(source, context);
  }
  return { context, requests };
}

function response(matches) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ matches }) }]
        }
      }]
    })
  };
}

test('unresolved text match retries with public image URLs as Gemini fileData', async () => {
  const { context, requests } = loadVision(async (call) => {
    if (call === 1) {
      return response([{ groupId: 'g1', candidateId: 'NONE', confidence: 0, reason: 'text uncertain' }]);
    }
    return response([{ groupId: 'g1', candidateId: 'c1', confidence: 0.9, reason: 'images support same variant' }]);
  });

  const result = await context.xrayGeminiMatchBatch({
    references: [{
      id: 'r1',
      label: 'HS-02B-3 Tips',
      imageUrl: 'https://ae01.alicdn.com/kf/reference.jpg'
    }],
    groups: [{
      id: 'g1',
      candidates: [{
        id: 'c1',
        label: '02B n Toolbox n 3TIP',
        imageUrl: 'https://ae01.alicdn.com/kf/candidate.webp'
      }]
    }]
  });

  assert.equal(requests.length, 2);
  const firstBody = JSON.parse(requests[0].init.body);
  assert.equal(firstBody.contents[0].parts.some((part) => part.fileData), false);

  const secondBody = JSON.parse(requests[1].init.body);
  const files = secondBody.contents[0].parts.filter((part) => part.fileData).map((part) => part.fileData);
  assert.deepEqual(files, [
    { mimeType: 'image/jpeg', fileUri: 'https://ae01.alicdn.com/kf/reference.jpg' },
    { mimeType: 'image/webp', fileUri: 'https://ae01.alicdn.com/kf/candidate.webp' }
  ]);
  assert.equal(result.matches[0].candidateId, 'c1');
  assert.equal(result.matches[0].vision, true);
});

test('high-confidence text match does not trigger a vision request', async () => {
  const { context, requests } = loadVision(async () => response([
    { groupId: 'g1', candidateId: 'c1', confidence: 0.95, reason: 'text is clear' }
  ]));

  const result = await context.xrayGeminiMatchBatch({
    references: [{ id: 'r1', label: 'Model A', imageUrl: 'https://example.com/ref.jpg' }],
    groups: [{ id: 'g1', candidates: [{ id: 'c1', label: 'Model A', imageUrl: 'https://example.com/c1.jpg' }] }]
  });

  assert.equal(requests.length, 1);
  assert.equal(result.matches[0].candidateId, 'c1');
  assert.equal(result.matches[0].vision, undefined);
});
