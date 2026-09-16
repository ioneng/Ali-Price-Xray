// Optional semantic fallback layered on top of the deterministic SKU matcher.
// Only ambiguous, locally non-contradictory labels are sent to the background.

const XRAY_AI_MAX_CANDIDATES = 4;
const XRAY_AI_MIN_CONFIDENCE = 0.72;
const XRAY_AI_CLEAR_LOCAL_SCORE = 0.78;
const XRAY_AI_CLEAR_LOCAL_MARGIN = 0.14;

function xrayAiCandidateRows(result) {
  const references = [...xraySortState.references.values()];
  const skus = (result?.skus || []).filter((sku) => sku.salable !== false);
  const rows = [];

  for (const sku of skus) {
    let best = null;
    for (const reference of references) {
      const pair = xrayCheapPairScore(reference, sku);
      if (pair.structured?.contradiction) continue;
      if (!best || pair.cheap > best.cheap) best = { reference, sku, ...pair };
    }
    if (best) rows.push(best);
  }

  rows.sort((a, b) => b.cheap - a.cheap);
  return rows.slice(0, XRAY_AI_MAX_CANDIDATES);
}

function xrayAiNeedsHelp(match, shortlist) {
  if (!match || !shortlist?.length) return false;
  const local = xrayCheapPairScore(match.reference, match.sku);
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
    if (!item.result?.ok || !item.match) continue;
    const shortlist = xrayAiCandidateRows(item.result);
    if (!xrayAiNeedsHelp(item.match, shortlist)) continue;

    const groupId = String(item.candidate.productId);
    shortlists.set(groupId, shortlist);
    groups.push({
      id: groupId,
      candidates: shortlist.map((row) => ({
        id: String(row.sku.skuId),
        label: skuDisplayLabel(row.sku)
      }))
    });
  }

  return { groups, shortlists };
}

async function xrayAiApplyMatches(matches, badge) {
  const { groups, shortlists } = xrayAiBuildGroups(matches);
  if (!groups.length) return { used: false, resolved: 0 };

  if (badge) {
    badge.textContent = `Xray: asking AI about ${groups.length} ambiguous listing${groups.length === 1 ? '' : 's'}…`;
    badge.style.background = 'rgba(55,65,120,.90)';
  }

  let response;
  try {
    response = await api.runtime.sendMessage({
      type: 'xray:ai-match-batch',
      references: [...xraySortState.references.values()].map((reference) => ({
        id: reference.key,
        label: reference.label
      })),
      groups
    });
  } catch (error) {
    log('AI matching request failed', error);
    return { used: false, resolved: 0, error: error?.message || String(error) };
  }

  if (!response?.ok || !response.enabled) {
    if (response?.error) log('AI matching unavailable', response.error);
    return { used: false, resolved: 0, error: response?.error || null };
  }

  const byGroup = new Map((response.matches || []).map((item) => [String(item.groupId), item]));
  let resolved = 0;

  for (const item of matches) {
    const groupId = String(item.candidate.productId);
    const ai = byGroup.get(groupId);
    if (!ai || ai.candidateId === 'NONE' || Number(ai.confidence) < XRAY_AI_MIN_CONFIDENCE) continue;

    const shortlist = shortlists.get(groupId) || [];
    const chosen = shortlist.find((row) => String(row.sku.skuId) === String(ai.candidateId));
    if (!chosen || chosen.structured?.contradiction) continue;

    const scored = await xrayScoreSkuAgainstReference(chosen.reference, chosen.sku, true);
    if (scored.structured?.contradiction) continue;

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
  }

  return { used: true, resolved };
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
  badge.textContent = `Xray: matching 0/${candidates.length}`;
  badge.style.background = 'rgba(90,70,20,.90)';
  let completed = 0;

  try {
    const matches = await xrayMapWithConcurrency(candidates, XRAY_SORT_FETCH_CONCURRENCY, async (candidate) => {
      const result = await xrayFetchCandidateResult(candidate);
      const match = result?.ok ? await xrayBestSkuForResult(result) : null;
      completed += 1;
      badge.textContent = `Xray: matching ${completed}/${candidates.length}`;
      return { candidate, result, match };
    });

    const aiOutcome = await xrayAiApplyMatches(matches, badge);
    xraySortState.lastMatches = new Map(matches.map((item) => [String(item.candidate.productId), item]));
    xrayRefreshSkuHighlights();
    const confidentCount = xrayApplyCardOrdering(matches);
    badge.textContent = aiOutcome.used && aiOutcome.resolved
      ? `Xray: sorted ${confidentCount}/${candidates.length} · AI resolved ${aiOutcome.resolved}`
      : `Xray: sorted ${confidentCount}/${candidates.length}`;
    badge.style.background = confidentCount ? 'rgba(20,100,45,.88)' : 'rgba(150,80,20,.90)';
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
