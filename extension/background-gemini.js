// Optional Gemini semantic matching for ambiguous SKU labels.
// API keys and network requests remain in the privileged extension background.

const XRAY_GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';
const XRAY_GEMINI_MAX_REFERENCES = 6;
const XRAY_GEMINI_MAX_GROUPS = 24;
const XRAY_GEMINI_MAX_CANDIDATES = 6;
const XRAY_GEMINI_MAX_LABEL = 300;
const XRAY_GEMINI_TIMEOUT_MS = 15000;
const XRAY_GEMINI_TEMP_DEBUG = true;

function xrayGeminiTempDebug(event, details = {}) {
  if (!XRAY_GEMINI_TEMP_DEBUG) return;
  console.log('[Ali-Price-Xray:AI debug]', event, details);
}

function xrayGeminiCleanString(value, max = XRAY_GEMINI_MAX_LABEL) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function xrayGeminiNormalizeBatch(input) {
  const references = (Array.isArray(input?.references) ? input.references : [])
    .slice(0, XRAY_GEMINI_MAX_REFERENCES)
    .map((item) => ({
      id: xrayGeminiCleanString(item?.id, 120),
      label: xrayGeminiCleanString(item?.label)
    }))
    .filter((item) => item.id && item.label);

  const groups = (Array.isArray(input?.groups) ? input.groups : [])
    .slice(0, XRAY_GEMINI_MAX_GROUPS)
    .map((group) => ({
      id: xrayGeminiCleanString(group?.id, 120),
      candidates: (Array.isArray(group?.candidates) ? group.candidates : [])
        .slice(0, XRAY_GEMINI_MAX_CANDIDATES)
        .map((candidate) => ({
          id: xrayGeminiCleanString(candidate?.id, 120),
          label: xrayGeminiCleanString(candidate?.label)
        }))
        .filter((candidate) => candidate.id && candidate.label)
    }))
    .filter((group) => group.id && group.candidates.length);

  return { references, groups };
}

function xrayGeminiPrompt(batch) {
  return [
    'You match purchasable product variants from different marketplace listings.',
    'For each candidate group, choose the candidate that represents the same variant as ANY reference option, or NONE when no candidate is confidently equivalent.',
    'Treat seller wording, word order, abbreviations, spacing, singular/plural forms, language differences, and omitted vendor/family prefixes as potentially equivalent when the remaining model facts agree.',
    'Variant-defining facts include model, size, quantity, colour, capacity, voltage, plug/region, package/bundle type, and included accessories.',
    'Only an explicit conflict in a variant-defining fact means the candidate is not equivalent.',
    'A fact mentioned on one side but omitted on the other is unknown, not a conflict. A marketplace label may be only a partial description of the same variant.',
    'Extra non-conflicting detail in one listing is allowed. In particular, do not reject a candidate merely because one label names a package, box, bundle, or accessory detail that the other label omits.',
    'For example, a reference saying "Model A 3 Tips" can match a candidate saying "Model A Toolbox 3TIP" when no stated fact conflicts; silence about the toolbox is not the same as saying no toolbox.',
    'Choose NONE when there is an explicit conflict or when the shared facts are too weak to identify the same variant, not merely because one side is less detailed.',
    'Do not infer from price; prices are intentionally omitted.',
    'Return one result for every group.',
    '',
    JSON.stringify(batch)
  ].join('\n');
}

const XRAY_GEMINI_MATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING' },
          candidateId: { type: 'STRING', description: 'Candidate id from the input, or NONE.' },
          confidence: { type: 'NUMBER' },
          reason: { type: 'STRING' }
        },
        required: ['groupId', 'candidateId', 'confidence', 'reason']
      }
    }
  },
  required: ['matches']
};

async function xrayGeminiGenerateJson({ model, apiKey, prompt, schema }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XRAY_GEMINI_TIMEOUT_MS);
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    xrayGeminiTempDebug('gemini-fetch-start', { model, endpoint });
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: schema
        },
        store: false
      })
    });

    xrayGeminiTempDebug('gemini-fetch-response', { status: response.status, ok: response.ok });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `Gemini returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini returned no structured response.');

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Gemini returned invalid JSON.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Gemini request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function xrayGeminiHostAllowed() {
  const api = xrayExtensionApi();
  if (!api.permissions?.contains) return true;
  try {
    return await api.permissions.contains({ origins: [XRAY_GEMINI_ORIGIN] });
  } catch {
    return false;
  }
}

function xrayGeminiValidateMatches(raw, batch) {
  const groups = new Map(batch.groups.map((group) => [group.id, new Set(group.candidates.map((candidate) => candidate.id))]));
  const seen = new Set();
  const matches = [];

  for (const item of Array.isArray(raw?.matches) ? raw.matches : []) {
    const groupId = xrayGeminiCleanString(item?.groupId, 120);
    if (!groups.has(groupId) || seen.has(groupId)) continue;
    seen.add(groupId);

    const allowed = groups.get(groupId);
    const requestedId = xrayGeminiCleanString(item?.candidateId, 120);
    const candidateId = requestedId === 'NONE' || allowed.has(requestedId) ? requestedId : 'NONE';
    const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
    const reason = xrayGeminiCleanString(item?.reason, 500);
    matches.push({ groupId, candidateId, confidence, reason });
  }

  for (const group of batch.groups) {
    if (!seen.has(group.id)) {
      matches.push({ groupId: group.id, candidateId: 'NONE', confidence: 0, reason: 'No result returned.' });
    }
  }

  return matches;
}

async function xrayGeminiMatchBatch(input, { requireEnabled = true } = {}) {
  const settings = await xrayGetAiSettings();
  xrayGeminiTempDebug('background-batch-start', {
    requireEnabled,
    enabled: settings.aiMatchingEnabled,
    provider: settings.aiProvider,
    model: settings.aiModel,
    incomingReferenceCount: Array.isArray(input?.references) ? input.references.length : 0,
    incomingGroupCount: Array.isArray(input?.groups) ? input.groups.length : 0
  });

  if (requireEnabled && !settings.aiMatchingEnabled) {
    xrayGeminiTempDebug('background-batch-stop', { reason: 'ai-disabled' });
    return { ok: true, enabled: false, provider: settings.aiProvider, model: settings.aiModel, matches: [] };
  }
  if (settings.aiProvider !== 'gemini') throw new Error('Unsupported AI provider.');
  if (!(await xrayGeminiHostAllowed())) {
    xrayGeminiTempDebug('background-batch-stop', { reason: 'host-permission-missing' });
    throw new Error('Gemini host permission is not granted.');
  }

  const apiKey = await xrayGetGeminiApiKey();
  if (!apiKey) {
    xrayGeminiTempDebug('background-batch-stop', { reason: 'api-key-missing' });
    throw new Error('Gemini API key is not configured.');
  }

  const batch = xrayGeminiNormalizeBatch(input);
  xrayGeminiTempDebug('background-normalized-batch', batch);
  if (!batch.references.length || !batch.groups.length) {
    xrayGeminiTempDebug('background-batch-stop', { reason: 'empty-normalized-batch' });
    return { ok: true, enabled: true, provider: settings.aiProvider, model: settings.aiModel, matches: [] };
  }

  const raw = await xrayGeminiGenerateJson({
    model: settings.aiModel,
    apiKey,
    prompt: xrayGeminiPrompt(batch),
    schema: XRAY_GEMINI_MATCH_SCHEMA
  });
  const matches = xrayGeminiValidateMatches(raw, batch);
  xrayGeminiTempDebug('background-validated-response', { raw, matches });

  return {
    ok: true,
    enabled: true,
    provider: settings.aiProvider,
    model: settings.aiModel,
    matches
  };
}

async function xrayGeminiTest() {
  const result = await xrayGeminiMatchBatch({
    references: [{ id: 'reference', label: 'Test Variant 3 Pack' }],
    groups: [{
      id: 'test',
      candidates: [
        { id: 'same', label: 'Test Variant - Pack of 3' },
        { id: 'different', label: 'Test Variant - Pack of 6' }
      ]
    }]
  }, { requireEnabled: false });
  return { ok: true, model: result.model };
}

xrayExtensionApi().runtime.onMessage.addListener((message) => {
  if (message?.type === 'xray:ai-debug') {
    xrayGeminiTempDebug(`content:${xrayGeminiCleanString(message.event, 120)}`, message.details || {});
    return Promise.resolve({ ok: true });
  }
  if (message?.type === 'xray:ai-match-batch') {
    xrayGeminiTempDebug('background-received-ai-match-batch', {
      referenceCount: Array.isArray(message.references) ? message.references.length : 0,
      groupCount: Array.isArray(message.groups) ? message.groups.length : 0
    });
    return xrayGeminiMatchBatch(message)
      .catch((error) => {
        xrayGeminiTempDebug('background-batch-error', { error: error?.message || String(error) });
        return { ok: false, error: error?.message || String(error), matches: [] };
      });
  }
  if (message?.type === 'xray:gemini-test') {
    return xrayGeminiTest()
      .catch((error) => ({ ok: false, error: error?.message || String(error) }));
  }
  return undefined;
});
