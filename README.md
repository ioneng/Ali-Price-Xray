# Ali-Price-Xray

AliExpress price transparency experiment.

Goal: show the full SKU price set behind each search result while keeping every SKU, including accessories, relevant and visible. The search-card price should eventually represent the main advertised product instead of blindly using the cheapest SKU.

## Current prototype

The active prototype is now a Firefox-first Manifest V3 WebExtension in `extension/`.

It currently:

- detects AliExpress product cards without replacing AliExpress's displayed price;
- adds an `Xray` button to detected cards;
- fetches `mtop.aliexpress.pdp.pc.query` from the extension background context;
- reads AliExpress's own `aep_usuc_f` cookie for the active currency and shipping region;
- keeps every returned SKU and shows the complete SKU price list in a scrollable overlay;
- reports the SKU count and raw min/max sale price as a diagnostic.

It deliberately does **not** yet choose a representative/front-card price and does **not** re-sort search results. Those depend on first confirming the current AliExpress data path works reliably in Firefox.

The earlier root-level `ali-price-xray.user.js` is only the initial card-detection experiment and is no longer the preferred network prototype.

## First live test

Load `extension/manifest.json` as a temporary Firefox add-on, open an AliExpress search-results page, and click `Xray` on one result. Success means the panel shows multiple SKU IDs/prices (where the listing has multiple SKUs) and the locale line reflects the current AliExpress region/currency.
