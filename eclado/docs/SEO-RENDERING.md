# SEO rendering architecture

The storefront keeps the existing React/Vite client application, while public routes receive a build-time HTML snapshot.

## Rendering split

- Build-time static HTML: home, shop, category and series pages, products, journal, articles, about, shopping information, contact and privacy.
- Client rendering: cart, checkout, authentication, account, payment result and admin experiences.
- Cached product fallback: `/api/product-page` handles a product that was created after the latest deployment, a missing product, and legacy product redirects. Existing generated product files are served by Vercel's filesystem before the fallback rewrite.

`npm run build` runs Vite and then `scripts/prerender-seo.mjs`. The prerender step reads the public storefront RPC and intentionally fails when the catalog is unavailable or empty, so a deployment cannot silently publish a sitemap and HTML set without products.

## Routing rules

- Product and article links use real `<a href>` elements.
- Shop filters have stable paths under `/shop/category/*` and `/shop/series/*`.
- The broad SPA catch-all rewrite was removed. Unknown routes therefore use Vercel's real 404 response.
- Product requests that do not match a generated file fall through to `/api/product-page`; old Chinese slugs return HTTP 301 and unknown products return HTTP 404 with `noindex`.
- Event-only routes and private application routes remain `noindex`.

## Adding content

- New active products are immediately available through the cached product fallback, but the full static catalog, category pages and sitemap are refreshed at the next deployment.
- New journal articles must be added to `src/data/journalArticles.js`; the next build generates the article HTML and adds its existing sitemap entry.
- When adding a storefront category or series, update both `src/app/shopNavigation.js` and the matching route list in `scripts/prerender-seo.mjs` and `api/sitemap.js`.

## Verification

After a production deployment, verify server responses without relying on rendered DOM:

```sh
curl -sS https://ecladotaiwan.com/products/rebalancing-toner
curl -I https://ecladotaiwan.com/products/平衡爽膚水
curl -I https://ecladotaiwan.com/products/not-a-real-product
```

The first response must contain its H1, description, canonical, Open Graph and JSON-LD. The legacy URL must return 301 and the missing URL must return 404.
