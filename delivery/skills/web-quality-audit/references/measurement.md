# Measurement and evidence

## Identify what was observed

| Evidence | Meaning and limit |
| --- | --- |
| CrUX | Aggregated eligible Chrome user experience, usually a rolling 28-day window; record URL or origin scope and form factor |
| First-party RUM | Measurements collected from actual user sessions and aggregated by the product |
| Browser trace or injected PerformanceObserver | One observed session under stated conditions; it is not field data or RUM by itself |
| Lighthouse or another lab audit | A synthetic run under that tool's conditions; scores and coverage depend on its version |
| Rendered tree and keyboard interaction | Evidence about the inspected state and exercised flow, not every state or assistive technology |
| Source inspection | A hypothesis about runtime behavior unless the code itself establishes the reported fact |

Missing CrUX data is unavailable, never a passing result. Local, private, new and low-traffic pages commonly lack it. Origin-level results do not establish the audited route's result. Keep field percentile and collection window separate from individual lab samples; a fresh deployment cannot instantly change a rolling field window.

## Collect only what the decision needs

Record the final URL, page state, browser/tool identity and available version, viewport or device, throttling, cache and authentication/consent state. Label unknown conditions; do not infer a device profile from viewport width alone. Use a supported existing trace or lab tool when relevant. Verify the tool's actual capabilities, modes and returned metrics rather than assuming a named audit includes performance.

Preserve user state. A navigation audit reloads the page and can discard input; choose a supported snapshot/current-state observation when that matters. Do not log out, submit forms, change experiments or run destructive journeys merely to obtain a benchmark. Sending private URLs, content or traces to a public service is a separate external effect; local access does not authorize it. Do not require a cloud API key or permanent dependency for an ordinary audit.

Start with a focused trace or observation. Inspect only the relevant network, main-thread, layout or loading evidence. When a decision depends on a headline lab metric, collect multiple equivalent samples (normally at least three) and report the median and range. A single sample can identify a hypothesis or support a bounded interaction observation; it does not establish a stable performance improvement. Do not compare different versions, throttles, states or cache conditions as if only the code changed.

## Report and recheck

Associate each conclusion with the observed state and evidence source. A practical result includes baseline, after-fix result when actually measured, conditions and remaining verification. Browser source APIs or a successful HTTP response alone do not prove that the page rendered or a user could complete the action.

Keep poor field/good lab results as a coverage gap to investigate using representative conditions. Good field/poor lab suggests a fragile synthetic case, not proof that users are currently failing. Missing field data permits useful lab diagnosis without an invented universal deployment block. Preserve traces only while diagnosis, review or delivery still needs them, then apply host cleanup.
