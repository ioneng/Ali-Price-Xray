const api = globalThis.browser ?? globalThis.chrome;
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';

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

async function requestGeminiPermissions() {
  if (!api.permissions?.request) return true;

  if (typeof api.runtime?.getBrowserInfo === 'function') {
    try {
      const dataGranted = await api.permissions.request({
        data_collection: ['websiteContent', 'authenticationInfo']
      });
      if (!dataGranted) return false;
    } catch (error) {
      console.warn('[Ali-Price-Xray:options] optional data permission request failed', error);
      return false;
    }
  }

  try {
    return await api.permissions.request({ origins: [GEMINI_ORIGIN] });
  } catch (error) {
    console.warn('[Ali-Price-Xray:options] Gemini host permission request failed', error);
    return false;
  }
}

async function persistForm({ requirePermission = false } = {}) {
  const settings = currentSettings();
  if ((settings.aiMatchingEnabled || requirePermission) && !(await requestGeminiPermissions())) {
    throw new Error('Gemini permission was not granted.');
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
