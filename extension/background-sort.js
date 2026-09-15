// Privileged image hashing helper for reference-SKU sorting.
// Keeps remote image bytes in the extension background and returns only a 64-bit dHash.

const XRAY_SORT_IMAGE_HOSTS = [
  'aliexpress.com',
  'aliexpress.us',
  'alicdn.com',
  'aliexpress-media.com'
];

function xraySortAllowedImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowed = XRAY_SORT_IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

function xraySortCanvas() {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(9, 8);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    return canvas;
  }
  return null;
}

async function xraySortDHashFromRemote(rawUrl) {
  const url = xraySortAllowedImageUrl(rawUrl);
  if (!url) throw new Error('Unsupported image host.');

  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Image fetch failed (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (typeof createImageBitmap !== 'function') throw new Error('Image decoding is unavailable in this background context.');

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = xraySortCanvas();
    if (!canvas) throw new Error('Canvas is unavailable in this background context.');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context is unavailable.');
    ctx.drawImage(bitmap, 0, 0, 9, 8);
    const pixels = ctx.getImageData(0, 0, 9, 8).data;
    const gray = [];
    for (let i = 0; i < pixels.length; i += 4) {
      gray.push((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
    }

    let hash = '';
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const left = gray[(y * 9) + x];
        const right = gray[(y * 9) + x + 1];
        hash += left > right ? '1' : '0';
      }
    }
    return hash;
  } finally {
    bitmap.close?.();
  }
}

api.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'xray:image-dhash' || !message.url) return undefined;
  return xraySortDHashFromRemote(message.url)
    .then((hash) => ({ ok: true, hash }))
    .catch((error) => ({ ok: false, error: error?.message || String(error) }));
});
