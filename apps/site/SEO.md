# Website SEO and crawler maintenance

DataPad++ publishes complete HTML for every product page, workflow guide and datastore guide. Search engines and AI search crawlers can read the same content as visitors without running JavaScript. These practices improve accessibility and discovery; they do not guarantee indexing, rankings, rich results or AI citations.

## Build and verify

Run from the repository root:

```sh
npm run site:test
npm run site:build
```

The build typechecks the site, builds its browser and server-rendering bundles, and renders every canonical route into `apps/site/dist`. The server bundle in `.prerender` runs only during the build; no Node server is needed in production. Deploy **dist**, not the browser-only output from running `vite build` directly.

The build finishes by checking all generated pages for unique titles and descriptions, canonical URLs, social metadata, structured data, one primary heading and main landmark, intact internal links and anchors, existing assets, sitemap coverage and a non-indexable 404 page. The Cloudflare deployment workflow also runs the website tests before publishing. `npm run check:seo --workspace @datapadplusplus/site` reruns the output checks after a build.

## Adding or changing pages

- Workflow guides come from `src/data/docs.ts`; datastore guides come from `src/data/datastores.ts`. Their titles and summaries also supply their search metadata.
- Add new top-level product routes to both `src/App.tsx` and the primary page catalog in `src/lib/seo.ts`.
- `seo.ts` generates the sitemap, structured data, per-page metadata and optional `llms.txt` index from one route catalog. Do not maintain competing manual URL lists.
- Keep descriptions accurate and distinct. Do not add keyword stuffing, fake reviews, unsupported capabilities or invented release dates. Pre-release warnings and datastore limitations remain visible.
- When replacing screenshots, update their dimensions in `src/data/screenshots.ts`; tests compare those dimensions against the actual PNG files. Reserve image space and lazy-load below-the-fold screenshots.
- Do not add automatic build timestamps as sitemap `lastmod` values. A future content timestamp must reflect a genuine page update.

## Routing and hosting

Canonical URLs use HTTPS on `datapad-plus-plus.org`, without a trailing slash except for the home page. Static routes use `guide.html` rather than `guide/index.html`, matching Cloudflare Pages extensionless routing. Generated redirects normalize trailing slashes; `/downloads` remains a permanent redirect to `/download`.

Keep the top-level `404.html` and never restore a catch-all `/* /index.html 200` rule. Unknown URLs must return HTTP 404 instead of a duplicate homepage. Preview and `pages.dev` hosts have `X-Robots-Tag: noindex` rules; the production custom domain does not.

Vite preview is useful for checking rendering, but it does not emulate Cloudflare headers, redirects or error status codes. Validate those on a Pages deployment as well.

## Search and AI discovery

`robots.txt` permits public crawling and points to the canonical sitemap. The default wildcard policy includes search crawlers such as Googlebot, Bingbot and OAI-SearchBot. It preserves open crawling rather than introducing a separate model-training policy.

`llms.txt` is an optional human-readable and machine-readable guide index generated from existing content. It is not an established ranking requirement or a substitute for crawlable HTML. Google explicitly says special AI text files are unnecessary for its search and AI features. Search access and model-training consent are different: OpenAI documents independent controls for OAI-SearchBot and GPTBot. Decide any future training restrictions separately from search visibility.

Cloudflare WAF rules, bot challenges, authentication and account-level AI crawler controls can still prevent access despite an allowing robots file. Check verified crawler traffic and published provider IP guidance; do not disable security protections globally or trust a user-agent string alone.

## After deployment

1. Check `/`, `/docs/first-query` and several datastore guides using View Source or a no-JavaScript client. Each should contain its own title, canonical URL, heading and complete guide content.
2. Check `/robots.txt` returns plain text, `/sitemap.xml` returns XML, and `/llms.txt` returns text rather than homepage HTML.
3. Confirm `/downloads` and trailing-slash variants redirect to their canonical URLs. Confirm a random missing URL returns HTTP 404 and contains `noindex`.
4. Confirm production responses have no `noindex`, `nosnippet` or unexpected crawler challenge, while preview hosts stay non-indexable.
5. Verify the domain in Google Search Console and Bing Webmaster Tools, submit `https://datapad-plus-plus.org/sitemap.xml`, and inspect representative URLs. These account-level steps are not performed by the build.
6. Validate applicable structured data with Google's Rich Results Test or Schema.org's validator. SoftwareApplication markup describes the product but does not invent ratings or pricing to force eligibility.
7. Measure mobile and desktop page experience with PageSpeed Insights and real Core Web Vitals. Monitor crawl errors, indexed URLs, search impressions and referral traffic after publication. The build's link checks are not a performance score or proof that search engines indexed the site.

## Official guidance

- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google search and generative AI guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI crawler roles and access controls](https://developers.openai.com/api/docs/bots)
- [Cloudflare Pages static routing and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare Pages headers and preview indexing](https://developers.cloudflare.com/pages/configuration/headers/)
