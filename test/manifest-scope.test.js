const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'manifest.json'),
  'utf8'
));

test('content scripts are limited to AliExpress wholesale search-result routes', () => {
  const matches = manifest.content_scripts?.[0]?.matches || [];
  assert.deepEqual(matches, [
    'https://aliexpress.com/w/wholesale-*',
    'https://*.aliexpress.com/w/wholesale-*',
    'https://aliexpress.us/w/wholesale-*',
    'https://*.aliexpress.us/w/wholesale-*'
  ]);
  assert.equal(matches.some((pattern) => pattern.endsWith('/*')), false);
});
