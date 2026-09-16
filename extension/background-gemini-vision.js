// Experimental Gemini vision fallback using public SKU image URLs.
// Text matching runs first. Only unresolved/low-confidence groups are retried
// with image URLs already supplied by the content-side matcher.

const XRAY_GEMINI_VISION_CONFIDENCE = 0.72;
const XRAY_GEMINI_VISION_GROUP_BATCH_SIZE = 4;
const XRAY_GEMINI_VISION_TIMEOUT_MS = 20000;
const xrayGeminiTextOnlyMatchBatch = xrayGeminiMatchBatch;

function xrayGeminiCleanImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.href.slice(0, 2048);
  } catch {
    return null;
  }
}

function xrayGeminiImageMimeType(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes('.png')) return 'image/png';
    if (path.includes('.webp')) return 'image/webp';
    if (path.includes('.bmp')) return 'image/bmp';
    return 'image/jpeg';
  } catch {
    return 'image/jpeg';
  }
}

function xrayGeminiNormalizeVisionBatch(input) {
  const references = (Array.isArray(input?.references) ? input.references : [])
    .slice(0, XRAY_GEMINI_MAX_REFERENCES)
    .map((item) => ({
      id: xrayGeminiCleanString(item?.id, 120),
      label: xrayGeminiCleanString(item?.label),
      imageUrl: xrayGeminiCleanImageUrl(item?.imageUrl)
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
          label: xrayGeminiCleanString(candidate?.label),
          imageUrl: xrayGeminiCleanImageUrl(candidate?.imageUrl)
        }))
        .filter((candidate) => candidate.id && candidate.label)
    }))
    .filter((group) => group.id && group.candidates.length);

  return { references, groups };
}

function xrayGeminiVisionPrompt(batch) {
  const textOnlyBatch = {
    references: batch.references.map(({ id, label }) => ({ id, label })),
    groups: batch.groups.map((group) => ({
      id: group.id,
      candidates: group.candidates.map(({ id, label }) => ({ id, label }))
    }))
  };

  return [
    'You are retrying ambiguous marketplace variant matches with image evidence.',
    'For each candidate group, choose the candidate that represents the same purchasable variant as ANY reference option, or NONE.',
    'Use the supplied images as supporting evidence for model identity, product shape, visible included accessories, package/case type, quantity, and variant-specific hardware.',
    'Seller wording may differ substantially. Missing text on one side is unknown, not a contradiction.',
    'Explicit text conflicts remain authoritative: images must not override a stated model, quantity, size, voltage, plug/region, package, or accessory conflict.',
    'Marketplace sellers may reuse thumbnails across variants, so do not rely on image similarity alone when text conflicts.',
    'If text is compatible and the images materially support the same variant, you may select that candidate.',
    'Do not infer from price. Return one result for every group.',
    '',
    JSON.stringify(textOnlyBatch)
  ].join('\n');
}

function xrayGeminiVisionParts(batch) {
  const parts = [{ text: xrayGeminiVisionPrompt(batch) }];

  for (const reference of batch.references) {
    if (!reference.imageUrl) continue;
    parts.push({ text: `Reference image ${reference.id}: ${reference.label}` });
    parts.push({
      fileData: {
        mimeType: xrayGeminiImageMimeType(reference.imageUrl),
        fileUri: reference.imageUrl
      }
    });
  }

  for (const group of batch.groups) {
    for (const candidate of group.candidates) {
      if (!candidate.imageUrl) continue;
      parts.push({ text: `Candidate image group=${group.id} candidate=${candidate.id}: ${candidate.label}` });
      parts.push({
        fileData: {
          mimeType: xrayGeminiImageMimeType(candidate.imageUrl),
          fileUri: candidate.imageUrl
        }
      });
    }
  }

  return parts;
}

async function xrayGeminiGenerateVisionJson({ model, apiKey, batch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XRAY_GEMINI_VISION_TIMEOUT_MS);
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const parts = xrayGeminiVisionParts(batch);
    xrayGeminiTempDebug('gemini-vision-fetch-start', {
      model,
      endpoint,
      groupCount: batch.groups.length,
      imageCount: parts.filter((part) => part.fileData).length
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: XRAY_GEMINI_MATCH_SCHEMA
        },
        store: false
      })
    });

    xrayGeminiTempDebug('gemini-vision-fetch-response', { status: response.status, ok: response.ok });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `Gemini vision returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini vision returned no structured response.');
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Gemini vision request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function xrayGeminiVisionEligibleGroups(input, textMatches) {
  const visionBatch = xrayGeminiNormalizeVisionBatch(input);
  if (!visionBatch.references.some((reference) => reference.imageUrl)) return { references: visionBatch.references, groups: [] };

  const byGroup = new Map((textMatches || []).map((match) => [String(match.groupId), match]));
  const groups = visionBatch.groups.filter((group) => {
    const prior = byGroup.get(group.id);
    const unresolved = !prior
      || prior.candidateId === 'NONE'
      || Number(prior.confidence) < XRAY_GEMINI_VISION_CONFIDENCE;
    return unresolved && group.candidates.some((candidate) => candidate.imageUrl);
  });

  return { references: visionBatch.references, groups };
}

xrayGeminiMatchBatch = async function xrayGeminiMatchBatchWithVision(input, options = {}) {
  const textResponse = await xrayGeminiTextOnlyMatchBatch(input, options);
  if (!textResponse?.ok || !textResponse.enabled) return textResponse;

  const visionInput = xrayGeminiVisionEligibleGroups(input, textResponse.matches);
  if (!visionInput.groups.length) return textResponse;

  const settings = await xrayGetAiSettings();
  const apiKey = await xrayGetGeminiApiKey();
  if (!apiKey) return textResponse;

  const merged = new Map((textResponse.matches || []).map((match) => [String(match.groupId), match]));

  for (let offset = 0; offset < visionInput.groups.length; offset += XRAY_GEMINI_VISION_GROUP_BATCH_SIZE) {
    const batch = {
      references: visionInput.references,
      groups: visionInput.groups.slice(offset, offset + XRAY_GEMINI_VISION_GROUP_BATCH_SIZE)
    };

    try {
      const raw = await xrayGeminiGenerateVisionJson({
        model: settings.aiModel,
        apiKey,
        batch
      });
      const validated = xrayGeminiValidateMatches(raw, batch);
      for (const match of validated) {
        const candidate = { ...match, vision: true };
        merged.set(String(match.groupId), candidate);
        xrayGeminiTempDebug('gemini-vision-result', candidate);
      }
    } catch (error) {
      xrayGeminiTempDebug('gemini-vision-error', {
        error: error?.message || String(error),
        groupIds: batch.groups.map((group) => group.id)
      });
    }
  }

  return {
    ...textResponse,
    matches: [...merged.values()]
  };
};
