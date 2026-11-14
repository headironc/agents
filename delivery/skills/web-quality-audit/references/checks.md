# Applicable page checks

## Interaction and accessibility

Inspect the rendered accessibility tree when available and exercise the relevant flow with real keyboard input. Verify that controls are reachable in a logical order, have visible focus, expose useful names/roles/states and work with the expected keys. A pointer click or programmatic focus/click is not evidence of keyboard operability. Prefer native controls when repairing a custom control that lacks their behavior.

Check labels, instructions, validation messages, focus restoration and dynamic state where they affect the selected journey. Decorative images can correctly use empty alt text; meaningful images need useful alternatives. Do not infer every component's semantics solely from visible DOM attributes: custom elements may expose semantics through platform APIs. Check contrast or target-size claims against the applicable standard and exceptions; do not turn a universal pixel size or a category recommendation into a conformance requirement.

Automated tools and tree snapshots do not prove complete WCAG conformance, screen-reader usability or every interaction state. Report manual checks actually performed, and identify relevant untested assistive technology or user testing. Retest the affected keyboard path after a fix, not just the automated score.

## Performance and browser behavior

Use measured bottlenecks to select loading, image, font, script or caching changes. Preloading every asset, changing every font to swap or adding preconnects indiscriminately can hurt the page; apply relevant Modern Web Guidance with the project's browser support policy. Check observed console/network failures in context rather than treating all diagnostics as exploitable defects.

Evaluate HTTPS, mixed content and headers against the actual deployment. HSTS advice for a public production origin does not make an HTTP localhost fixture a failed deployment. Source maps alone do not prove secret exposure; inspect the actual published content and intended threat boundary. A browser quality audit is not a vulnerability scan or a substitute for security review.

## Search and agent access

Apply crawlability, robots, canonical URL, titles and structured-data checks only to pages intended for indexing and the requested search goals. A private application's noindex policy can be correct. Do not require a sitemap or public crawl access for an authenticated workflow, fail valid HTML only for multiple h1 elements, or promise a ranking change from a performance score.

Useful names and rendered semantics can help automated clients as well as people. If optional agent interfaces exist, review their exposed behavior within the requested scope; do not install WebMCP or generate llms.txt solely to improve a category score. A passing technical audit does not establish ingestion, ranking or citation by an external service.
