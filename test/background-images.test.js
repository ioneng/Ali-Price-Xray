const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function parseSkus(result) {
  const context = {
    skuEntries: (source, priceMap) => source.SKU.skuPaths.map((skuPath) => ({
      skuId: skuPath.skuId,
      entry: priceMap[skuPath.skuId],
      path: skuPath
    })),
    normalizeSkuEntries: (entries) => entries.map(({ skuId }) => ({ skuId }))
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'extension', 'background-images.js'), 'utf8'),
    context
  );

  const priceMap = Object.fromEntries(result.SKU.skuPaths.map(({ skuId }) => [skuId, {}]));
  return context.normalizeSkuEntries(context.skuEntries(result, priceMap));
}

test('matches an object-shaped image map entry using a skuAttr value ID', () => {
  const [sku] = parseSkus({
    HEADER_IMAGE_PC: {
      skuImagesMap: {
        200006151: { imageUrl: '//cdn.example/tips.jpg' }
      }
    },
    SKU: {
      skuPaths: [{ skuId: 'sku-a', skuAttr: '14:200006151#Tips only' }],
      skuProperties: []
    }
  });

  assert.equal(sku.imageUrl, '//cdn.example/tips.jpg');
  assert.equal(sku.imageDebug.source, 'HEADER_IMAGE_PC.skuImagesMap[200006151]');
  assert.deepEqual([...sku.imageDebug.valueIds], ['200006151']);
  assert.deepEqual(
    [...sku.imageDebug.candidateFields],
    ['HEADER_IMAGE_PC.skuImagesMap[200006151].imageUrl']
  );
});

test('falls back to an image on a matching SKU property value', () => {
  const [sku] = parseSkus({
    HEADER_IMAGE_PC: { skuImagesMap: {} },
    SKU: {
      skuPaths: [{ skuId: 'sku-b', skuAttr: '14:200006152#Iron' }],
      skuProperties: [{
        skuPropertyValues: [{
          propertyValueIdLong: '200006152',
          skuPropertyImagePath: '//cdn.example/iron.jpg'
        }]
      }]
    }
  });

  assert.equal(sku.imageUrl, '//cdn.example/iron.jpg');
  assert.equal(sku.imageDebug.source, 'SKU.skuProperties[].skuPropertyValues[200006152]');
  assert.deepEqual(
    [...sku.imageDebug.candidateFields],
    ['SKU.skuProperties[].skuPropertyValues[200006152].skuPropertyImagePath']
  );
});

test('keeps useful diagnostics when no image matches', () => {
  const [sku] = parseSkus({
    HEADER_IMAGE_PC: { skuImagesMap: {} },
    SKU: {
      skuPaths: [{ skuId: 'sku-c', path: '14:200006153', skuAttr: '5:100014064#136cm' }],
      skuProperties: []
    }
  });

  assert.equal(sku.imageUrl, null);
  assert.equal(sku.imageDebug.source, null);
  assert.deepEqual([...sku.imageDebug.valueIds], ['200006153', '100014064']);
  assert.deepEqual([...sku.imageDebug.candidateFields], []);
});
