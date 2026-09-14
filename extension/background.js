const api = globalThis.browser ?? globalThis.chrome;

const TAG = '[Ali-Price-Xray:bg]';
const PDP_API = 'mtop.aliexpress.pdp.pc.query';
const PDP_APP_KEY = '12574478';
const PDP_HOST = 'https://acs.aliexpress.com/';

const log = (...args) => console.debug(TAG, ...args);

function parsePrice(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  if (typeof input !== 'string') return null;

  // AliExpress also exposes salePriceLocal values such as "$9.80|9|80".
  // Only the first segment is the actual amount; the rest are integer/fraction parts.
  const safe = input.split('|', 1)[0];
  const match = safe.match(/\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function detectCurrency(text) {
  if (typeof text !== 'string') return null;
  if (/\bAUD\b|AU\s?\$/i.test(text)) return 'AUD';
  if (/\bUSD\b|US\s?\$/i.test(text)) return 'USD';
  if (/\bNZD\b|NZ\s?\$/i.test(text)) return 'NZD';
  if (/\bCAD\b|CA\s?\$/i.test(text)) return 'CAD';
  if (/\bSGD\b|SG\s?\$/i.test(text)) return 'SGD';
  if (/\bHKD\b|HK\s?\$/i.test(text)) return 'HKD';
  if (/\bEUR\b|€/i.test(text)) return 'EUR';
  if (/\bGBP\b|£/i.test(text)) return 'GBP';
  return null;
}

async function tokenFor() {
  try {
    const cookie = await api.cookies.get({ url: PDP_HOST, name: '_m_h5_tk' });
    return cookie?.value ? cookie.value.split('_')[0] : null;
  } catch (error) {
    log('token lookup failed', error);
    return null;
  }
}

async function localePreferences(senderUrl) {
  let siteUrl = 'https://www.aliexpress.com/';
  try {
    const parsed = new URL(senderUrl);
    if (parsed.hostname.endsWith('aliexpress.us')) siteUrl = 'https://www.aliexpress.us/';
    else if (parsed.hostname.endsWith('aliexpress.com')) siteUrl = 'https://www.aliexpress.com/';
  } catch {}

  try {
    const cookie = await api.cookies.get({ url: siteUrl, name: 'aep_usuc_f' });
    const values = new URLSearchParams(cookie?.value || '');
    return {
      currency: values.get('c_tp') || 'AUD',
      country: values.get('region') || 'AU',
      locale: values.get('b_locale') || 'en_US',
      source: cookie?.value ? 'aep_usuc_f' : 'prototype-default'
    };
  } catch (error) {
    log('locale cookie lookup failed', error);
    return { currency: 'AUD', country: 'AU', locale: 'en_US', source: 'prototype-default' };
  }
}

async function pdpCall(data, token) {
  const timestamp = Date.now();
  const sign = md5(`${token || ''}&${timestamp}&${PDP_APP_KEY}&${data}`);
  const query = new URLSearchParams({
    jsv: '2.5.1',
    appKey: PDP_APP_KEY,
    t: String(timestamp),
    sign,
    api: PDP_API,
    v: '1.0',
    type: 'originaljson',
    dataType: 'json',
    timeout: '15000'
  });

  const response = await fetch(`${PDP_HOST}h5/${PDP_API}/1.0/?${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(data)}`
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`AliExpress returned non-JSON data (HTTP ${response.status})`);
  }
}

function priceMapFromResponse(response) {
  const result = response?.data?.result;
  if (!result || typeof result !== 'object') {
    return { result: null, map: null, path: null };
  }

  const price = result.PRICE;
  if (!price || typeof price !== 'object') {
    return { result, map: null, path: null };
  }

  if (price.skuIdStrPriceInfoMap && typeof price.skuIdStrPriceInfoMap === 'object') {
    return { result, map: price.skuIdStrPriceInfoMap, path: 'data.result.PRICE.skuIdStrPriceInfoMap' };
  }

  if (price.skuPriceInfoMap && typeof price.skuPriceInfoMap === 'object') {
    return { result, map: price.skuPriceInfoMap, path: 'data.result.PRICE.skuPriceInfoMap' };
  }

  return { result, map: null, path: null };
}

function normalizeSkuMap(map) {
  if (!map || typeof map !== 'object') return [];

  return Object.entries(map).map(([skuId, entry]) => {
    // salePriceString is the verified safe field. salePriceLocal can contain
    // pipe-delimited components and must never be treated as one numeric string.
    const saleText = entry?.salePriceString
      || entry?.salePrice?.formattedAmount
      || entry?.salePrice?.formatedAmount
      || entry?.salePriceLocal?.split?.('|', 1)?.[0]
      || '';

    const currency = entry?.originalPrice?.currency
      || entry?.salePrice?.currency
      || detectCurrency(saleText)
      || null;

    return {
      skuId,
      salePrice: parsePrice(saleText),
      salePriceString: saleText || null,
      currency,
      discount: entry?.discount || null,
      originalPriceString: entry?.originalPrice?.formatedAmount
        || entry?.originalPrice?.formattedAmount
        || null
    };
  }).filter((sku) => sku.salePrice != null || sku.salePriceString);
}

function currenciesIn(skus) {
  return [...new Set(skus.map((sku) => sku.currency).filter(Boolean))];
}

async function fetchSkuPrices(productId, senderUrl) {
  const prefs = await localePreferences(senderUrl);
  const data = JSON.stringify({
    productId: String(productId),
    _currency: prefs.currency,
    country: prefs.country,
    locale: prefs.locale,
    pdp_ext_f: '{}'
  });

  let response = await pdpCall(data, await tokenFor());
  let retText = String(response?.ret || '');

  if (/TOKEN_(EMPTY|EXPIRED|EXOIRED)/i.test(retText)) {
    response = await pdpCall(data, await tokenFor());
    retText = String(response?.ret || '');
  }

  if (!response || /PUNISH|VALIDATE|RGV587|FAIL_SYS/i.test(retText)) {
    return {
      ok: false,
      productId: String(productId),
      prefs,
      ret: retText || 'No response',
      error: 'AliExpress rejected the product-data request.'
    };
  }

  const { result, map, path } = priceMapFromResponse(response);
  const skus = normalizeSkuMap(map);

  if (!skus.length) {
    return {
      ok: false,
      productId: String(productId),
      prefs,
      ret: retText,
      error: 'Request succeeded, but the expected PRICE SKU map was missing or empty.',
      debug: { mapPath: path }
    };
  }

  const apiCurrency = result?.GLOBAL_DATA?.globalData?.currencyCode || null;
  const skuCurrencies = currenciesIn(skus);
  const currencyMismatch = (apiCurrency && apiCurrency !== prefs.currency)
    || skuCurrencies.some((currency) => currency !== prefs.currency);

  if (currencyMismatch) {
    return {
      ok: false,
      productId: String(productId),
      prefs,
      ret: retText,
      error: `Currency mismatch: page requests ${prefs.currency}, API returned ${[apiCurrency, ...skuCurrencies].filter(Boolean).join(', ') || 'unknown'}.`,
      debug: {
        mapPath: path,
        apiCurrency,
        skuCurrencies,
        samplePrices: skus.slice(0, 5).map(({ skuId, salePriceString, currency }) => ({ skuId, salePriceString, currency }))
      }
    };
  }

  skus.sort((a, b) => (a.salePrice ?? Infinity) - (b.salePrice ?? Infinity));
  const numeric = skus.map((sku) => sku.salePrice).filter(Number.isFinite);
  const target = result?.PRICE?.targetSkuPriceInfo || null;

  return {
    ok: true,
    productId: String(productId),
    prefs,
    ret: retText,
    count: skus.length,
    min: numeric.length ? Math.min(...numeric) : null,
    max: numeric.length ? Math.max(...numeric) : null,
    skus,
    debug: {
      mapPath: path,
      apiCurrency,
      targetSalePriceString: target?.salePriceString || target?.salePriceLocal || null
    }
  };
}

api.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'xray:fetch-skus' || !message.productId) return undefined;

  log('fetching', message.productId, 'from', sender?.url);
  return fetchSkuPrices(message.productId, sender?.url)
    .catch((error) => ({
      ok: false,
      productId: String(message.productId),
      error: error?.message || String(error)
    }));
});

// MD5 is required by AliExpress's MTOP request signing. WebCrypto intentionally has no MD5.
function md5(str) {
  const s = utf8(str);
  const n = s.length;
  const words = [];
  for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] | 0) | (s.charCodeAt(i) << ((i % 4) * 8));
  words[n >> 2] = (words[n >> 2] | 0) | (0x80 << ((n % 4) * 8));
  const len = ((n + 8) >> 6) * 16 + 16;
  const x = new Array(len).fill(0);
  for (let i = 0; i < words.length; i++) x[i] = words[i] | 0;
  x[len - 2] = n * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < len; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a,b,c,d,x[i],7,-680876936); d = ff(d,a,b,c,x[i+1],12,-389564586);
    c = ff(c,d,a,b,x[i+2],17,606105819); b = ff(b,c,d,a,x[i+3],22,-1044525330);
    a = ff(a,b,c,d,x[i+4],7,-176418897); d = ff(d,a,b,c,x[i+5],12,1200080426);
    c = ff(c,d,a,b,x[i+6],17,-1473231341); b = ff(b,c,d,a,x[i+7],22,-45705983);
    a = ff(a,b,c,d,x[i+8],7,1770035416); d = ff(d,a,b,c,x[i+9],12,-1958414417);
    c = ff(c,d,a,b,x[i+10],17,-42063); b = ff(b,c,d,a,x[i+11],22,-1990404162);
    a = ff(a,b,c,d,x[i+12],7,1804603682); d = ff(d,a,b,c,x[i+13],12,-40341101);
    c = ff(c,d,a,b,x[i+14],17,-1502002290); b = ff(b,c,d,a,x[i+15],22,1236535329);

    a = gg(a,b,c,d,x[i+1],5,-165796510); d = gg(d,a,b,c,x[i+6],9,-1069501632);
    c = gg(c,d,a,b,x[i+11],14,643717713); b = gg(b,c,d,a,x[i],20,-373897302);
    a = gg(a,b,c,d,x[i+5],5,-701558691); d = gg(d,a,b,c,x[i+10],9,38016083);
    c = gg(c,d,a,b,x[i+15],14,-660478335); b = gg(b,c,d,a,x[i+4],20,-405537848);
    a = gg(a,b,c,d,x[i+9],5,568446438); d = gg(d,a,b,c,x[i+14],9,-1019803690);
    c = gg(c,d,a,b,x[i+3],14,-187363961); b = gg(b,c,d,a,x[i+8],20,1163531501);
    a = gg(a,b,c,d,x[i+13],5,-1444681467); d = gg(d,a,b,c,x[i+2],9,-51403784);
    c = gg(c,d,a,b,x[i+7],14,1735328473); b = gg(b,c,d,a,x[i+12],20,-1926607734);

    a = hh(a,b,c,d,x[i+5],4,-378558); d = hh(d,a,b,c,x[i+8],11,-2022574463);
    c = hh(c,d,a,b,x[i+11],16,1839030562); b = hh(b,c,d,a,x[i+14],23,-35309556);
    a = hh(a,b,c,d,x[i+1],4,-1530992060); d = hh(d,a,b,c,x[i+4],11,1272893353);
    c = hh(c,d,a,b,x[i+7],16,-155497632); b = hh(b,c,d,a,x[i+10],23,-1094730640);
    a = hh(a,b,c,d,x[i+13],4,681279174); d = hh(d,a,b,c,x[i],11,-358537222);
    c = hh(c,d,a,b,x[i+3],16,-722521979); b = hh(b,c,d,a,x[i+6],23,76029189);
    a = hh(a,b,c,d,x[i+9],4,-640364487); d = hh(d,a,b,c,x[i+12],11,-421815835);
    c = hh(c,d,a,b,x[i+15],16,530742520); b = hh(b,c,d,a,x[i+2],23,-995338651);

    a = ii(a,b,c,d,x[i],6,-198630844); d = ii(d,a,b,c,x[i+7],10,1126891415);
    c = ii(c,d,a,b,x[i+14],15,-1416354905); b = ii(b,c,d,a,x[i+5],21,-57434055);
    a = ii(a,b,c,d,x[i+12],6,1700485571); d = ii(d,a,b,c,x[i+3],10,-1894986606);
    c = ii(c,d,a,b,x[i+10],15,-1051523); b = ii(b,c,d,a,x[i+1],21,-2054922799);
    a = ii(a,b,c,d,x[i+8],6,1873313359); d = ii(d,a,b,c,x[i+15],10,-30611744);
    c = ii(c,d,a,b,x[i+6],15,-1560198380); b = ii(b,c,d,a,x[i+13],21,1309151649);
    a = ii(a,b,c,d,x[i+4],6,-145523070); d = ii(d,a,b,c,x[i+11],10,-1120210379);
    c = ii(c,d,a,b,x[i+2],15,718787259); b = ii(b,c,d,a,x[i+9],21,-343485551);

    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  return [a, b, c, d].map(hex).join('');
}

function utf8(value) { return unescape(encodeURIComponent(String(value))); }
function add(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
function ff(a,b,c,d,x,s,t) { return cmn((b & c) | (~b & d), a,b,x,s,t); }
function gg(a,b,c,d,x,s,t) { return cmn((b & d) | (c & ~d), a,b,x,s,t); }
function hh(a,b,c,d,x,s,t) { return cmn(b ^ c ^ d, a,b,x,s,t); }
function ii(a,b,c,d,x,s,t) { return cmn(c ^ (b | ~d), a,b,x,s,t); }
function hex(n) { let out = ''; for (let i = 0; i < 4; i++) out += ((n >> (i * 8 + 4)) & 0x0f).toString(16) + ((n >> (i * 8)) & 0x0f).toString(16); return out; }
