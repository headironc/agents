# Required Library consumption

Apply this reference before creating, changing, or reviewing a Sketch UI design. Keep the main skill's authorization and native-only boundaries. Read-only review inspects dependencies and reports gaps without registering, enabling, importing, synchronizing, or editing them.

## Select and consume the foundation

Creating or modifying a deliverable Sketch UI design **must use an applicable reusable foundation Library**. “Reusable” means its foundational components, variables, and styles can serve real consumers. The Library may come from an official, team, or project-adopted design system; no single name, component namespace, physical file, or directory is universal. A project-specific foundation Library can satisfy this requirement without a second physical Library.

1. Resolve source, path or remote origin, registration, Library ID, compatible version, and target-document association from project rules, the task, and actual dependencies. Inspect `get_libraries` or `sketch.Library.getLibraries()` and document imports. A display name alone does not establish identity; distinguish missing, inaccessible, disabled, stale, and same-name/different-ID resources.
2. Verify real consumption: applicable shared components, color variables, and text or layer styles use native Library references. Trace imported assets and their instances or style assignments to the selected Library. Merely listing or installing it, importing unrelated assets, using an empty Library, or copying layers that lose their references does not satisfy the requirement.
3. Reuse suitable existing components before drawing the same foundation again in a business document. Discover the selected Library's actual names and structure rather than requiring predetermined prefixes or variant organization.
4. Without a project-specific Library, select a suitable existing reusable Library. If none is applicable and accessible, report the concrete missing dependency. Within effective authorization, connect a suitable resource or add only the minimum shared assets needed by the current real consumer. Do not silently fall back to local clones, create an empty compliance Library, or prebuild a complete design system. Missing authorization stops only dependent operations; continue unaffected preparation and report incomplete acceptance honestly.
5. Use a compatible official platform Library when the target needs system components. Resolve the platform and version from the target contract. Apple UI resources are not a dependency of non-iOS work merely because they are installed. Default Templates and Inspire UI Kit are candidate resources, not mandatory companions for every task.

When Library registration or enabling is authorized, use the supported native API, for example `sketch.Library.getLibraryForDocumentAtPath('/absolute/path/to/foundation.sketch')` and `lib.enabled = true`. The path is illustrative. Verify the resulting identity, enabled state, document association, and actual consumption; do not assume a fixed `Libraries/` mirror is required.

## Master ownership and consumer updates

Keep shared master components in their owning Library. Within a document that owns masters, use the top level of its Symbols page (`sketch.Page.getSymbolsPage(doc)`), with instances on showcase or business pages. Avoid duplicate masters and repeated clones; discover actual component and variant organization from the selected Library.

Use native imported symbols, swatches, and shared text/layer styles. Saving a Library source does not prove that its registered resource or any consumer has updated. Trace the actual source-to-registration-to-consumer relationship; some setups use a separate registered copy, others do not.

For an authorized shared change, identify affected consumers and validate a representative consumer before wider propagation. Update the registered resource only where the actual setup requires it and authorization covers it. In affected consumers, call `syncWithLibrary()` on the changed imported `SymbolMaster`, `Swatch`, or `SharedStyle`, and `resizeWithSmartLayout()` on affected instances as appropriate. Verify references, layout, screenshots, and saved results. Do not blanket-sync unrelated consumers. Batch order, parallelism, and Human acceptance follow the existing project delivery policy and effective authorization; this skill adds no file-count trigger or approval gate.

Before authorized resource removal, migrate real consumers and follow [native collection cleanup](identity-and-mutations.md#native-collection-cleanup). Preserve retained identities; never replace whole collections to remove a few items.

### Native Overrides and Reference Integrity

Drive supported variations with `commonOverrideIDPrefix + '_' + property`, without arbitrary `detach()`. Relevant properties include `stringValue`, `symbolID`, `isVisible`, `preservesSpaceWhenHidden`, `swatchValue`, `color:fill-N`, `color:border-N`, `textColor`, `fillColor`, `textStyle`, `layerStyle`, `horizontalSizing`, `verticalSizing`, `image`, `imageResizeBehavior`, and `flowDestination`. Preserve API semantics, such as image resize values `2` for Fit and `3` for Fill, as defined by the installed guide; these are not visual tokens.

After a nested symbol swap or during override review, follow [public override verification](identity-and-mutations.md#public-override-verification). Preserve intended overrides and verify references and rendering. An undefined `unresolvedOverrides` is not a zero count or proof of exhaustive cleanup.
