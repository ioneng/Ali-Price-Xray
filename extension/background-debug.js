// TEMPORARY diagnostics for AliExpress PDP request failures during live testing.
// Do not log cookies, request signatures, request payloads, or API keys.

const XRAY_PDP_TEMP_DEBUG = true;
const xrayDebugOriginalFetchSkuPrices = fetchSkuPrices;

fetchSkuPrices = async function xrayFetchSkuPricesWithTempDebug(productId, senderUrl, productUrl) {
  const startedAt = Date.now();
  try {
    const result = await xrayDebugOriginalFetchSkuPrices(productId, senderUrl, productUrl);
    if (XRAY_PDP_TEMP_DEBUG) {
      console.log('[Ali-Price-Xray:PDP debug]', {
        productId: String(productId),
        ok: Boolean(result?.ok),
        error: result?.error || null,
        ret: String(result?.ret || '').slice(0, 600),
        durationMs: Date.now() - startedAt
      });
    }
    return result;
  } catch (error) {
    if (XRAY_PDP_TEMP_DEBUG) {
      console.log('[Ali-Price-Xray:PDP debug]', {
        productId: String(productId),
        ok: false,
        error: error?.message || String(error),
        ret: null,
        durationMs: Date.now() - startedAt
      });
    }
    throw error;
  }
};
