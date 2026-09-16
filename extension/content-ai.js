// Optional semantic fallback layered on top of the deterministic SKU matcher.
// Only ambiguous, locally non-contradictory labels are sent to the background.

// TEMPORARY diagnostics for live matcher debugging. These messages are mirrored
// to the background page so they are visible in Firefox's extension debugger.
const XRAY_AI_TEMP_DEBUG = true;
function xrayAiTempDebug(event, details = {}) {
  if (!XRAY_AI_TEMP_DEBUG) return;
  try {
    console.log('[Ali-Price-Xray:AI debug]', event, details);
  } catch {}
  try {
    const reply = api.runtime.sendMessage({ type: 'xray:ai-debug', event, details });
    if (reply?.catch) reply.catch(() => {});
  } catch {}
}

// Hard variant contradictions are authoritative. Marketplace sellers often reuse
// the same thumbnail across several variants, so image identity must never turn
// a known model/quantity/package conflict into a confident match.
const xrayAiOriginalCheapPairScore = xrayCheapPairScore;
xrayCheapPairScore = function xrayCheapPairScoreWithContradictionGuard(reference, sku) {
  const pair = xrayAiOriginalCheapPairScore(reference, sku);
  if (!pair.structured?.contradiction) return pair;
  return {
    ...pair,
    imageExact: false,
    cheap: Math.min(pair.text, 0.2)
  };
};

const xrayAiOriginalScoreSkuAgainstReference = xrayScoreSkuAgainstReference;
xrayScoreSkuAgainstReference = async function xrayScoreSkuAgainstReferenceWithContradictionGuard(
  reference,
  sku,
  allowPixelHash = true
) {
  const cheap = xrayCheapPairScore(reference, sku);
  if (cheap.structured?.contradiction) {
    return {
      score: Math.min(cheap.text, 0.2),
      text: cheap.text,
      image: null,
      structured: cheap.structured
    };
  }

  const scored = await xrayAiOriginalScoreSkuAgainstReference(reference, sku, allowPixelHash);
  return { ...scored, structured: cheap.structured };
};

const XRAY_AI_MAX_CANDIDATES = 6;
const XRAY_AI_MIN_CONFIDENCE = 0.72;
const XRAY_AI_CLEAR_LOCAL_SCORE = 0.78;
const XRAY_AI_CLEAR_LOCAL_MARGIN = 0.14;
const XRAY_AI_GROUP_BATCH_SIZE = 24;
const XRAY_AI_PDP_FETCH_CONCURRENCY = 1;

function xrayAiVariantAgreement(reference, sku) {
  const referenceFacts = xrayOptionFacts(reference?.label || '');
  const candidateFacts = xrayOptionFacts(skuDisplayLabel(sku));
  const modelAgreement = [...referenceFacts.modelTokens]
    .some((token) => candidateFacts.modelTokens.has(token));
  const tipAgreement = Number.isFinite(referenceFacts.tipCount)
    && Number.isFinite(candidateFacts.tipCount)
    && referenceFacts.tipCount === candidateFacts.tipCount;
  const packageAgreement = Boolean(
    referenceFacts.packageType
    && candidateFacts.packageType
    && referenceFacts.packageType === candidateFacts.packageType
  );

  // Prefer candidates that preserve explicit variant facts even when the free-text
  // similarity is weak because sellers concatenate model/tip/package tokens differently.
  const rank = (modelAgreement ? 4 : 0) + (tipAgreement ? 3 : 0) + (packageAgreement ? 1 : 0);
  return { modelAgreement, tipAgreement, packageAgreement, rank };
}

function xrayAiCandidateRows(result) {
  const references = [...xraySortState.references.values()];
  const skus = (result?.skus || []).filter((sku) => sku.salable !== false);
  const rows = [];

  for (const sku of skus) {
    let best = null;
    for (const reference of references) {
      const pair = xrayCheapPairScore(reference, sku);
      if (pair.structured?.contradiction) continue;
      const agreement = xrayAiVariantAgreement(reference, sku);
      const candidate = { reference, sku, ...pair, agreement, shortlistRank: agreement.rank };
      if (!best
        || candidate.shortlistRank > best.shortlistRank
        || (candidate.shortlistRank === best.shortlistRank && candidate.cheap > best.cheap)) {
        best = candidate;
      }
    }
    if (best) rows.push(best);
  }

  rows.sort((a, b) => (b.shortlistRank - a.shortlistRank) || (b.cheap - a.cheap));
  return rows.slice(0, XRAY_AI_MAX_CANDIDATES);
}

function xrayAiNeedsHelp(match, shortlist) {
  if (!match || !shortlist?.length) return false;
  const local = xrayCheapPairScore(match.reference, match.sku);
  if (local.structured?.contradiction) return true;
  if (local.structured?.exact || local.imageExact) return false;

  const top = shortlist[0]?.cheap || 0;
  const second = shortlist[1]?.cheap || 0;
  const margin = top - second;
  return match.score < XRAY_AI_CLEAR_LOCAL_SCORE || margin < XRAY_AI_CLEAR_LOCAL_MARGIN;
}

function xrayAiBuildGroups(matches) {
  const groups = [];
  const shortlists = new Map();

  for (const item of matches) {
    const productId = String(item.candidate?.productId || '');
    if (!item.result?.ok || !item.match) {
      xrayAiTempDebug('gate-skip-no-local-match', {
        productId,
        resultOk: Boolean(item.result?.ok),
        hasMatch: Boolean(item.match)
      });
      continue;
    }

    const shortlist = xrayAiCandidateRows(item.result);
    const local = xrayCheapPairScore(item.match.reference, item.match.sku);
    const top = shortlist[0]?.cheap || 0;
    const second = shortlist[1]?.cheap || 0;
    const margin = top - second;
    const needsHelp = xrayAiNeedsHelp(item.match, shortlist);

    xrayAiTempDebug('gate', {
      productId,
      localWinner: {
        skuId: String(item.match.sku?.skuId || ''),
        label: skuDisplayLabel(item.match.sku),
        score: item.match.score,
        text: item.match.text,
        image: item.match.image,
        structuredExact: Boolean(local.structured?.exact),
        structuredContradiction: Boolean(local.structured?.contradiction),
        imageExact: Boolean(local.imageExact)
      },
      shortlist: shortlist.map((row) => ({
        skuId: String(row.sku?.skuId || ''),
        label: skuDisplayLabel(row.sku),
        cheap: row.cheap,
        text: row.text,
        variantRank: row.shortlistRank,
        modelAgreement: Boolean(row.agreement?.modelAgreement),
        tipAgreement: Boolean(row.agreement?.tipAgreement),
        packageAgreement: Boolean(row.agreement?.packageAgreement),
        structuredExact: Boolean(row.structured?.exact),
        imageExact: Boolean(row.imageExact)
      })),
      top,
      second,
      margin,
      thresholds: {
        clearLocalScore: XRAY_AI_CLEAR_LOCAL_SCORE,
        clearLocalMargin: XRAY_AI_CLEAR_LOCAL_MARGIN
      },
      needsHelp,
      skipReason: needsHelp
        ? null
        : (local.structured?.exact
          ? 'structured-exact'
          : (local.imageExact
            ? 'image-exact'
            : (!shortlist.length ? 'empty-shortlist' : 'local-clear')))
    });

    if (!needsHelp) continue;

    const groupId = productId;
    shortlists.set(groupId, shortlist);
    groups.push({
      id: groupId,
      candidates: shortlist.map((row) => ({
        id: String(row.sku.skuId),
        label: skuDisplayLabel(row.sku)
      }))
    });
  }

  xrayAiTempDebug('groups-built', {
    matchCount: matches.length,
    aiGroupCount: groups.length,
    groupIds: groups.map((group) => group.id)
  });
  return { groups, shortlists };
}

async function xrayAiRequestBatches(references, groups) {
  const matches = [];
  let provider = 'gemini';
  let model = null;
  let enabled = false;
  let error = null;

  for (let offset = 0; offset < groups.length; offset += XRAY_AI_GROUP_BATCH_SIZE) {
    const batchGroups = groups.slice(offset, offset + XRAY_AI_GROUP_BATCH_SIZE);
    const batchIndex = Math.floor(offset / XRAY_AI_GROUP_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(groups.length / XRAY_AI_GROUP_BATCH_SIZE);
    const request = {
      type: 'xray:ai-match-batch',
      references,
      groups: batchGroups
    };

    xrayAiTempDebug('dispatch-ai-batch', {
      batchIndex,
      batchCount,
      references: request.references,
      groups: request.groups
    });

    let response;
    try {
      response = await api.runtime.sendMessage(request);
    } catch (requestError) {
      error = requestError?.message || String(requestError);
      xrayAiTempDebug('ai-request-threw', { batchIndex, batchCount, error });
      log('AI matching request failed', requestError);
      continue;
    }

    xrayAiTempDebug('ai-response', {
      batchIndex,
      batchCount,
      ok: Boolean(response?.ok),
      enabled: Boolean(response?.enabled),
      provider: response?.provider || null,
      model: response?.model || null,
      error: response?.error || null,
      matches: response?.matches || []
    });

    if (!response?.ok || !response.enabled) {
      if (response?.error) {
        error = response.error;
        log('AI matching unavailable', response.error);
      }
      if (!response?.enabled) break;
      continue;
    }

    enabled = true;
    provider = response.provider || provider;
    model = response.model || model;
    matches.push(...(response.matches || []));
  }

  return { enabled, provider, model, matches, error };
}

async function xrayAiApplyMatches(matches, badge) {
  const { groups, shortlists } = xrayAiBuildGroups(matches);
  if (!groups.length) {
    xrayAiTempDebug('no-ai-request', { reason: 'no-ambiguous-groups' });
    return { used: false, resolved: 0, checked: 0 };
  }

  if (badge) {
    badge.textContent = `Xray: asking AI about ${groups.length} ambiguous listing${groups.length === 1 ? '' : 's'}…`;
    badge.style.background = 'rgba(55,65,120,.90)';
  }

  const references = [...xraySortState.references.values()].map((reference) => ({
    id: reference.key,
    label: reference.label
  }));
  const response = await xrayAiRequestBatches(references, groups);

  if (!response.enabled) {
    return { used: false, resolved: 0, checked: groups.length, error: response.error || null };
  }

  const byGroup = new Map((response.matches || []).map((item) => [String(item.groupId), item]));
  let resolved = 0;

  for (const item of matches) {
    const groupId = String(item.candidate.productId);
    const ai = byGroup.get(groupId);
    if (!ai || ai.candidateId === 'NONE' || Number(ai.confidence) < XRAY_AI_MIN_CONFIDENCE) {
      if (shortlists.has(groupId)) {
        xrayAiTempDebug('ai-result-not-applied', {
          groupId,
          reason: !ai
            ? 'no-result'
            : (ai.candidateId === 'NONE' ? 'none' : 'confidence-below-threshold'),
          candidateId: ai?.candidateId || null,
          confidence: Number(ai?.confidence) || 0,
          threshold: XRAY_AI_MIN_CONFIDENCE
        });
      }
      continue;
    }

    const shortlist = shortlists.get(groupId) || [];
    const chosen = shortlist.find((row) => String(row.sku.skuId) === String(ai.candidateId));
    if (!chosen || chosen.structured?.contradiction) {
      xrayAiTempDebug('ai-result-not-applied', {
        groupId,
        reason: !chosen ? 'candidate-not-in-shortlist' : 'candidate-has-contradiction',
        candidateId: ai.candidateId,
        confidence: Number(ai.confidence)
      });
      continue;
    }

    const scored = await xrayScoreSkuAgainstReference(chosen.reference, chosen.sku, true);
    if (scored.structured?.contradiction) {
      xrayAiTempDebug('ai-result-not-applied', {
        groupId,
        reason: 'rescored-contradiction',
        candidateId: ai.candidateId,
        confidence: Number(ai.confidence)
      });
      continue;
    }

    item.match = {
      ...scored,
      sku: chosen.sku,
      reference: chosen.reference,
      score: Math.max(scored.score, Math.min(0.95, Number(ai.confidence))),
      referenceMatches: item.match?.referenceMatches || [],
      ai: {
        provider: response.provider || 'gemini',
        model: response.model || null,
        confidence: Number(ai.confidence),
        reason: String(ai.reason || '')
      }
    };
    resolved += 1;
    xrayAiTempDebug('ai-result-applied', {
      groupId,
      candidateId: String(chosen.sku?.skuId || ''),
      label: skuDisplayLabel(chosen.sku),
      confidence: Number(ai.confidence),
      finalScore: item.match.score,
      reason: String(ai.reason || '')
    });
  }

  return { used: true, resolved, checked: groups.length, error: response.error || null };
}

const xrayLocalAddMatchBadge = xrayAddMatchBadge;
xrayAddMatchBadge = function xrayAddAiAwareMatchBadge(card, match, rank, currency) {
  xrayLocalAddMatchBadge(card, match, rank, currency);
  if (!match?.ai) return;
  const badge = card.querySelector(':scope > .ali-price-xray-match-badge');
  if (!badge) return;
  const pct = Math.round(match.ai.confidence * 100);
  const model = match.ai.model ? ` (${match.ai.model})` : '';
  badge.title += `\nAI${model}: ${pct}%${match.ai.reason ? ` · ${match.ai.reason}` : ''}`;
};

// Replace only the orchestration step. Fetching, deterministic scoring, highlighting,
// and card ordering continue to use the existing proven implementation.
xraySortAllCards = async function xraySortAllCardsWithAiFallback() {
  if (xraySortState.sorting || !xraySortState.references.size) return;
  xraySortState.sorting = true;
  xraySyncReferenceControls();

  const badge = ensureDebugBadge();
  const candidates = candidateCards();
  xrayAiTempDebug('sort-start', {
    referenceCount: xraySortState.references.size,
    references: [...xraySortState.references.values()].map((reference) => ({
      id: reference.key,
      label: reference.label
    })),
    candidateCount: candidates.length,
    pdpFetchConcurrency: XRAY_AI_PDP_FETCH_CONCURRENCY
  });
  badge.textContent = `Xray: matching 0/${candidates.length}`;
  badge.style.background = 'rgba(90,70,20,.90)';
  let completed = 0;

  try {
    const matches = await xrayMapWithConcurrency(candidates, XRAY_AI_PDP_FETCH_CONCURRENCY, async (candidate) => {
      const result = await xrayFetchCandidateResult(candidate);
      const match = result?.ok ? await xrayBestSkuForResult(result) : null;
      completed += 1;
      badge.textContent = `Xray: matching ${completed}/${candidates.length}`;
      return { candidate, result, match };
    });

    xrayAiTempDebug('local-matching-finished', {
      matches: matches.map((item) => ({
        productId: String(item.candidate?.productId || ''),
        resultOk: Boolean(item.result?.ok),
        skuId: String(item.match?.sku?.skuId || ''),
        label: item.match?.sku ? skuDisplayLabel(item.match.sku) : null,
        score: item.match?.score ?? null,
        text: item.match?.text ?? null,
        image: item.match?.image ?? null
      }))
    });

    const aiOutcome = await xrayAiApplyMatches(matches, badge);
    xraySortState.lastMatches = new Map(matches.map((item) => [String(item.candidate.productId), item]));
    xrayRefreshSkuHighlights();
    const confidentCount = xrayApplyCardOrdering(matches);
    if (aiOutcome.used) {
      badge.textContent = `Xray: sorted ${confidentCount}/${candidates.length} · AI checked ${aiOutcome.checked}, resolved ${aiOutcome.resolved}`;
    } else if (aiOutcome.error) {
      badge.textContent = `Xray: sorted ${confidentCount}/${candidates.length} · AI unavailable`;
    } else {
      badge.textContent = `Xray: sorted ${confidentCount}/${candidates.length}`;
    }
    badge.style.background = confidentCount ? 'rgba(20,100,45,.88)' : 'rgba(150,80,20,.90)';
    xrayAiTempDebug('sort-finished', {
      confidentCount,
      total: candidates.length,
      ai: aiOutcome
    });
    log('reference SKU sort complete', {
      references: [...xraySortState.references.values()],
      confidentCount,
      total: candidates.length,
      ai: aiOutcome
    });
  } finally {
    xraySortState.sorting = false;
    xraySyncReferenceControls();
  }
};
