# Prototype Behavior and Visible Content

Apply these requirements during native prototype creation, editing, and review. Preserve the main skill's required Library consumption, project contract, and authorization boundaries. Read-only review reports gaps without changing flows, layers, content, documents, or host state.

## Verify the Intended Graph

Identify intended entry points, paths promised to be interactive, static reference frames, and legitimate terminal states. Set `flowStartPoint` accordingly, without a fixed number or naming prefix. Check every promised path for reachability from its intended entry, and report unintended dead ends and self-loops. A completion frame may have no outgoing flow; a static reference does not need invented interaction.

Resolve `layer.flow` targets and `flowDestination` overrides to actual valid frames or `sketch.Flow.BackTarget` (`'back'`). Use `layer.flow.isValidConnection()`, target IDs, and `isBackAction()` as applicable; graph traversal must reflect the intended scope and actual back behavior. Confirm the important transitions in the native prototype, since a valid target ID alone does not prove interaction behavior. Clear stale unintended flows during authorized edits, not all links in a category of frames.

Report accidental theme or device jumps; preserve explicit theme switching, device handoff, and appropriately sized overlays. Current-navigation clicks, cross-module entries, and return behavior follow the product contract and prototype scope. Do not hijack a real control to a placeholder destination or remove a required link merely to satisfy a generic graph check. If a required destination is unavailable, report that coverage gap.

## Preserve Context and Use Real Interaction Targets

Menus, dialogs, and transitions must preserve the applicable filters, form state, record context, and unchanged identity. Use capabilities verified in the installed prototyping guide and actual document. If the API lacks a needed overlay operation, choose an authorized supported implementation or report the limitation; do not turn a tool workaround into a product-wide menu restriction. Context-preserving paired frames, native overlays, and other supported approaches follow the actual requirement.

Keep the same record's fields and the unchanged logged-in identity consistent across connected views. Explicit account switching and legitimate business-state transitions may change them. After an action, use the destination and recovery path required by the business flow, including completion pages or continued work where appropriate.

Wire visible controls or other genuine interaction targets. A `sketch.HotSpot` may match a visible sub-control when a composite instance lacks a suitable nested flow override; a dismissible scrim may itself be a real target. Verify bounds, stacking, modal blocking, and resulting behavior. Never add hidden corner hotspots, off-control targets, or concealed error jumps to fabricate reachability.

## Review User Copy Separately from Metadata

Inspect rendered Text and instance string overrides as user content. Treat layer names, tracking IDs, and design annotations according to their audience; internal identifiers are not copy leaks unless rendered or otherwise exposed to the user. Do not apply one blacklist to all three categories.

User-facing screens must not accidentally expose irrelevant debugging controls, internal workflow notes, or predetermined results. Judge technical terms, examples, help text, and keyboard instructions by context: developer tools and help pages may legitimately display them. Verify the final pixels as well as the source text.

Refresh, retry, recovery, back navigation, draft saving, cancel, and submit actions follow the product contract. Keep actions real and results accurate; button labels must not reveal a presumed outcome before it is known. Avoid purposeless duplicate actions without imposing universal button counts, footer layouts, or wording.
