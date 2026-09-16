const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function storageArea() {
  const values = {};
  return {
    values,
    setAccessLevel: async () => {},
    get: async (keys) => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    set: async (items) => Object.assign(values, items),
    remove: async (key) => { delete values[key]; }
  };
}

function loadSettings() {
  const local = storageArea();
  const session = storageArea();
  const context = {
    console,
    browser: { storage: { local, session } }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'settings.js'), 'utf8');
  vm.runInContext(source, context);
  return { context, local, session };
}

test('storage access helper supports Chromium options-object shape', async () => {
  const { context } = loadSettings();
  const calls = [];
  await context.xraySetTrustedStorageAccess({
    setAccessLevel: async (value) => calls.push(value)
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].accessLevel, 'TRUSTED_CONTEXTS');
});

test('storage access helper falls back to Firefox direct-string shape', async () => {
  const { context } = loadSettings();
  const calls = [];
  await context.xraySetTrustedStorageAccess({
    setAccessLevel: async (value) => {
      calls.push(value);
      if (typeof value === 'object') throw new TypeError('Firefox-style test');
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'TRUSTED_CONTEXTS');
});

test('Gemini key defaults to session storage and can opt into local storage', async () => {
  const { context, local, session } = loadSettings();
  await context.xrayStoreGeminiApiKey('session-key', 'session');
  assert.equal(session.values.geminiApiKey, 'session-key');
  assert.equal(local.values.geminiApiKey, undefined);

  await context.xrayStoreGeminiApiKey('local-key', 'local');
  assert.equal(local.values.geminiApiKey, 'local-key');
  assert.equal(session.values.geminiApiKey, undefined);
});
