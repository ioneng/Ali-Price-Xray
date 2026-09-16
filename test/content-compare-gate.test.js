const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGate() {
  const context = {
    console,
    URL,
    location: { href: 'https://www.aliexpress.com/w/wholesale-test.html' },
    candidateCards: () => [],
    log: () => {},
    xrayDecorateSkuRow: (row) => ({ ...row, decorated: true }),
    xrayAddPanelControls: () => 'controls-added',
    xraySortAllCards: async () => 'sorted'
  };
  vm.createContext(context);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'content-compare-gate.js'),
    'utf8'
  );
  vm.runInContext(source, context);
  return context;
}

function candidates(titles) {
  return titles.map((title, index) => ({
    productId: String(index + 1),
    title
  }));
}

test('enables comparison when a model identifier from the search repeats across listings', () => {
  const context = loadGate();
  const result = context.xrayCompareEvaluate(
    candidates([
      'HS-02B soldering iron 3 tips toolbox',
      'Portable HS02B soldering station kit',
      'HS 02B smart soldering iron set',
      'Another HS-02B iron EU plug',
      'Unrelated soldering iron'
    ]),
    'https://www.aliexpress.com/w/wholesale-hs-02b-soldering-iron.html'
  );

  assert.equal(result.feasible, true);
  assert.equal(result.matchingIdentifier, 'hs02b');
  assert.equal(result.matchingCards, 4);
});

test('keeps comparison hidden for broad specification searches', () => {
  const context = loadGate();
  const result = context.xrayCompareEvaluate(
    candidates([
      '100W GaN USB C charger 4 port',
      '100W GaN desktop charger PD3.0',
      '100W GaN travel charger EU plug',
      '100W GaN laptop charger with cable'
    ]),
    'https://www.aliexpress.com/w/wholesale-100w-gan-charger.html'
  );

  assert.equal(result.feasible, false);
  assert.deepEqual(Array.from(result.queryIdentifiers), []);
});

test('requires at least three cards carrying the same model identifier', () => {
  const context = loadGate();
  const result = context.xrayCompareEvaluate(
    candidates([
      'M365 replacement wheel',
      'M365 scooter wheel',
      'Generic scooter wheel',
      'Universal scooter tyre'
    ]),
    'https://www.aliexpress.com/w/wholesale-m365-wheel.html'
  );

  assert.equal(result.feasible, false);
  assert.equal(result.matchingIdentifier, 'm365');
  assert.equal(result.matchingCards, 2);
});

test('recognizes compact model codes such as G30', () => {
  const context = loadGate();
  const result = context.xrayCompareEvaluate(
    candidates([
      'Ninebot G30 rear wheel',
      'G30 Max hub motor wheel',
      'Replacement tyre for G30',
      'G30 scooter accessory'
    ]),
    'https://www.aliexpress.com/w/wholesale-g30-wheel.html'
  );

  assert.equal(result.feasible, true);
  assert.equal(result.matchingIdentifier, 'g30');
  assert.equal(result.matchingCards, 4);
});
