const api = globalThis.browser ?? globalThis.chrome;
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';
const GEMINI_DATA_COLLECTION = ['websiteContent', 'authenticationInfo'];

const fields = {
  enabled: document.querySelector('#aiMatchingEnabled'),
  provider: document.querySelector('#aiProvider'),
  model: document.querySelector('#aiModel'),
  apiKey: document.querySelector('#geminiApiKey'),
  remember: document.querySelector('#rememberKey'),
  save: document.querySelector('#save'),
  test: document.querySelector('#test'),
  status: document.querySelector('#status')
};

function setStatus(message, kind = '') {
  fields.status.textContent = message;
  fields.status.className = kind;
}

function currentSettings() {
  return {
    aiMatchingEnabled: fields.enabled.checked,
    aiProvider: fields.provider.value,
    aiModel: fields.model.value.trim() || XRAY_AI_DEFAULTS.aiModel,
    aiKeyStorage: fields.remember.checked ? 'local' : 'session'
  };
}

function isFirefox() {
  return typeof api.runtime?.getBrowserInfo === 'function';
}

async function geminiPermissionStatus() {
  if (!api.permissions?.contains) {
    return { dataGranted: true, originGranted: true };
  }

  const originGranted = await api.permissions
    .contains({ origins: [GEMINI_ORIGIN] })
    .catch(() => false);

  let dataGranted = true;
  if (isFirefox()) {
    dataGranted = await api.permissions
      .contains({ data_collection: GEMINI_DATA_COLLECTION })
      .catch(() => false);
  }

  return { dataGranted, originGranted };
}

function geminiPermissionError({ dataGranted, originGranted }) {
  if (!dataGranted && !originGranted) {
    return 'Gemini data-sharing and API access permissions were not granted.';
  }
  if (!dataGranted) {
    return 'Gemini data-sharing permission was not granted.';
  }
  if (!originGranted) {
    return 'Gemini API access permission was not granted.';
  }
  return 'Gemini permission was not granted.';
}

async function requestGeminiPermissions() {
  if (!api.permissions?.request) return true;

  const request = { origins: [GEMINI_ORIGIN] };
  if (isFirefox()) {
    request.data_collection = GEMINI_DATA_COLLECTION;
  }

  try {
    const granted = await api.permissions.request(request);
    if (granted) return true;
  } catch (error) {
    console.warn('[Ali-Price-Xray:options] Gemini permission request failed', error);
  }

  throw new Error(geminiPermissionError(await geminiPermissionStatus()));
}

async function persistForm({ requirePermission = false } = {}) {
  const settings = currentSettings();
  if (settings.aiMatchingEnabled || requirePermission) {
    await requestGeminiPermissions();
  }

  if ((settings.aiMatchingEnabled || requirePermission) && !fields.apiKey.value.trim()) {
    throw new Error('Enter a Gemini API key first.');
  }

  await xraySetAiSettings(settings);
  await xrayStoreGeminiApiKey(fields.apiKey.value, settings.aiKeyStorage);
  return settings;
}

async function load() {
  await xrayRestrictSensitiveStorage();
  const [settings, apiKey] = await Promise.all([
    xrayGetAiSettings(),
    xrayGetGeminiApiKey()
  ]);

  fields.enabled.checked = settings.aiMatchingEnabled;
  fields.provider.value = settings.aiProvider;
  fields.model.value = settings.aiModel;
  fields.remember.checked = settings.aiKeyStorage === 'local';
  fields.apiKey.value = apiKey;
}

fields.save.addEventListener('click', async () => {
  fields.save.disabled = true;
  setStatus('Saving…');
  try {
    const settings = await persistForm();
    setStatus(
      settings.aiMatchingEnabled
        ? 'Saved. Gemini assistance will be used only for ambiguous matches.'
        : 'Saved. AI-assisted matching is disabled.',
      'success'
    );
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
  } finally {
    fields.save.disabled = false;
  }
});

fields.test.addEventListener('click', async () => {
  fields.test.disabled = true;
  setStatus('Testing Gemini connection…');
  try {
    await persistForm({ requirePermission: true });
    const result = await api.runtime.sendMessage({ type: 'xray:gemini-test' });
    if (!result?.ok) throw new Error(result?.error || 'Gemini test failed.');
    setStatus(`Gemini connection successful (${result.model}).`, 'success');
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
  } finally {
    fields.test.disabled = false;
  }
});

load().catch((error) => setStatus(error?.message || String(error), 'error'));
