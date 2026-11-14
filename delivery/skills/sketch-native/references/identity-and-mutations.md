# Native identity and mutation handling

Read this reference before the related inspection or operation. Keep the main skill's native-only, required Library consumption, and authorization boundaries. Read-only review reports gaps without saving, repairing, closing windows, or changing host state. The version-specific observations below concern Sketch 2026.3.1 (234013); verify installed public APIs before using alternatives.

## Document identity and safe closure

Bind the full source path and document ID using `sketch.Document.getDocuments()`. Two open copies can share an ID, so `targetDocumentID` alone can select the wrong document for inspection or screenshots. When a newly created layer exists in the path-bound object but a screenshot reports it missing, resolve the open-document ambiguity before retrying. Do not assume the frontmost window is the target.

Before closing a conflicting copy, establish ownership and whether unsaved work must be preserved. The public API exposes no reliable dirty-state property; an absent property or a title without an Edited marker does not prove the document is clean. Reuse sufficient task authorization and evidence. If safe closure is not established, preserve the window and resolve the specific missing decision; do not add a confirmation gate to every close.

When authorized to preserve unsaved work in a recovery copy, verify that copy is natively readable before closing the original. Keep its separate identity explicit. If no safe resolution is available, report screenshot or reopen acceptance as incomplete instead of closing an unknown-state window. Rebind the exact path, document ID, and layer ID after resolving the conflict.

## Saving with identity preservation

For an existing edited candidate, bind the correct open document by full path and record `doc.id`, `doc.path`, and any associated Library ID and real source path. Use the no-path `doc.save()` for an in-place save. Verify those identities after saving and again after reopening, including the registered Library's source relationship. A successful save or unchanged filename does not prove identity was preserved.

Do not replace an in-place save with `doc.save(doc.path, callback)`. The path-taking form defaults to SaveAs and was observed to change document and Library identity. SaveTo recovery copies were also observed to receive new document identity; they preserve recoverable content, not the original Library identity. Use copy/save-as operations only for a purpose that permits a distinct identity. Do not use them to manufacture a candidate whose acceptance requires retaining the original Library ID. A new document's first save likewise needs its intended destination and resulting identity verified. Resolve the actual copy invocation from the installed public API before use.

The installed public implementation's `y[o] || o || NSSaveAsOperation` fallback can select SaveAs when Save resolves to zero. This is a static risk, not validation of an explicit Save-mode workaround. Recheck the installed public API before using any alternate form; never infer identity preservation from the enum name alone.

Use the main skill's read-only duplicate-ID check and native reopen acceptance, subject to safe closure above. Trace the registered source and affected consumers; saving a source does not prove consumer synchronization. Report the verified consumer scope without claiming coverage of undiscovered external consumers.

At coherent batch boundaries, verify persisted results independently of the mutation call. An immediate in-memory read and a synchronous save return do not prove that the file contains the change. A native-observed recovery for one persistence discrepancy was to finish the edits, read back in the next native call, save separately, and then verify in another call and after reopening; compare file digests when file-change evidence is required. The cause of that discrepancy is unconfirmed. Use this as a recovery and verification sequence, not a claim that every combined edit/save fails or a requirement to save every property separately.

## Library import identity

Locate the concrete importable reference within the verified Library. A name is a lookup aid only when unique there; same-name Libraries are not interchangeable. `ImportableObject.id` can map to a new local ID during `import()`. Retain the reference and cache the returned object, using its actual `symbolId` or `id` for subsequent work. Do not repeatedly look up imports by a recorded source ID or assume `ref.id` remains unchanged.

For example, use `const imported = ref.import()` and then `imported.createNewInstance()` for a symbol, or assign the returned swatch. Verify the imported object's `getLibrary().id` against the bound Library and trace its actual consumer assignment. After a failed import loop, read back already imported assets before resuming; failure does not imply rollback or justify repeating every import.

## Shared-style corners

Mutating `sharedStyle.style.corners.radii` directly can throw `setNeedsUpdateConcentricCorners is not a function` after earlier fills, borders, or shadows have already changed. Read back that partial state before repair; do not replay the whole creation script.

For a mutable local shared style in its owning document, the native-verified route is to set the intended corner values on a real Frame's style, update with the public setter `sharedStyle.style = frame.style`, and then bind `frame.sharedStyle = sharedStyle`. Assign the intended radii array through the public setter; mutating a returned array element is not proof of a native write. Use the intended Frame or an authorized task-owned staging Frame, preserve the other intended style fields, process pending changes, and verify affected consumers and pixels.

The setter rejects imported foreign styles. Update their owning Library and synchronize authorized consumers instead. If source access or authorization is missing, report the dependent repair as incomplete while continuing independent work. Do not use private APIs to bypass this distinction.

## Public override verification

After swapping a nested `<prefix>_symbolID`, clear stale overrides exposed by the public API under that prefix that refer to the former master's child IDs, or duplicate a clean compatible template instance and reapply intended values. For example, `Control/Rest` to `Control/Focused` is an illustrative swap, not a required naming scheme. Preserve unrelated and intended explicit overrides.

Inspect public `overrides`, their `affectedLayer`, symbol/style targets, Library references, and rendered results. There is no public `instance.unresolvedOverrides` in this version; `undefined` is not a zero count. Report that hidden underlying residual records cannot be established by these public checks rather than claiming exhaustive cleanup.

## Native collection cleanup

During authorized cleanup, verify that real consumers of a local swatch or shared style have migrated before removing it. Resolve each obsolete item by its exact current ID and remove one item with the public collection's `splice(index, 1)`, reading back the native collection and resolving the current index again before the next removal. Multi-item deletion can shift indices within the native wrapper. Do not treat the mutation's return value as proof or rebuild the entire swatch or shared-style array and lose retained identities. Verify removed items, preserved IDs, and remaining consumer references.

No public API supports arbitrary purging of invalid foreign records; shared-style removal also rejects foreign entries. Native saving was observed to remove unused foreign symbols. Inspect the result after reopening and report any remaining limitation instead of using private APIs or promising that all foreign records will be removed.
