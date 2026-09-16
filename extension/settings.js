const XRAY_AI_DEFAULTS = Object.freeze({
  aiMatchingEnabled: false,
  aiProvider: 'gemini',
  aiModel: 'gemini-3.5-flash-lite',
  aiKeyStorage: 'session'
});

function xrayExtensionApi() {
  return globalThis.browser ?? globalThis.chrome;
}

async function xrayRestrictSensitiveStorage() {
  const api = xrayExtensionApi();
  try {
    await api.storage?.local?.setAccessLevel?.('TRUSTED_CONTEXTS');
  } catch {}
  try {
    await api.storage?.session?.setAccessLevel?.('TRUSTED_CONTEXTS');
  } catch {}
}

async function xrayGetAiSettings() {
  const api = xrayExtensionApi();
  const values = await api.storage.local.get(Object.keys(XRAY_AI_DEFAULTS));
  return { ...XRAY_AI_DEFAULTS, ...values };
}

async function xraySetAiSettings(next) {
  const api = xrayExtensionApi();
  const safe = {
    aiMatchingEnabled: Boolean(next.aiMatchingEnabled),
    aiProvider: next.aiProvider === 'gemini' ? 'gemini' : 'gemini',
    aiModel: String(next.aiModel || XRAY_AI_DEFAULTS.aiModel).trim() || XRAY_AI_DEFAULTS.aiModel,
    aiKeyStorage: next.aiKeyStorage === 'local' ? 'local' : 'session'
  };
  await api.storage.local.set(safe);
  return safe;
}

async function xrayGetGeminiApiKey() {
  const api = xrayExtensionApi();
  const session = await api.storage.session.get('geminiApiKey').catch(() => ({}));
  if (session?.geminiApiKey) return session.geminiApiKey;
  const local = await api.storage.local.get('geminiApiKey').catch(() => ({}));
  return local?.geminiApiKey || '';
}

async function xrayStoreGeminiApiKey(apiKey, storageMode = 'session') {
  const api = xrayExtensionApi();
  const key = String(apiKey || '').trim();
  await Promise.all([
    api.storage.session.remove('geminiApiKey').catch(() => undefined),
    api.storage.local.remove('geminiApiKey').catch(() => undefined)
  ]);
  if (!key) return;
  const area = storageMode === 'local' ? api.storage.local : api.storage.session;
  await area.set({ geminiApiKey: key });
}

xrayRestrictSensitiveStorage();
