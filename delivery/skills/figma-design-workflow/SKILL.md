---
name: figma-design-workflow
description: Create and iterate authorized editable design drafts through Codex, with Figma when needed, pixel-based critique, and lead-agent visual acceptance. Use for page or state drafts and refinements to an approved visual direction. Excludes product-code implementation and ordinary read-only design analysis.
---

# Figma Design Workflow

This is a Codex design workflow. Codex owns requirements, authorization, bounded draft work, and acceptance. Use the design route in the [model policy](../../policy/models.md#current-defaults). Figma is an output option when the task needs it; Claude Code with DeepSeek and a separate Design plugin are not required for the default route.

## Bind the design task

Read project instructions, goals, existing material, and the actual target artifact. Distinguish exploration, continuation of an approved direction, and a local correction. Bind the current pages or states, approved references, intended outcome, required output, and acceptance checks. Resolve changed page scope against the project's authoritative requirements and responsible owner before producing dependent drafts. Preserve existing drafts and assets outside the target. If the user rejects an earlier visual constraint, remove it from the brief rather than quietly reusing it.

Use the user's effective project or task authorization for the requested design work. The lead selects necessary project material, identifies the target files and pages or nodes from the task context, and performs reversible design edits within that scope. These execution bindings do not require a separately approved material package or permission for each file, node, or edit. Ask only for a business decision that context cannot resolve, a material scope expansion, or an external operation outside the effective authorization. Preserve explicit user restrictions, exclude secrets and unrelated material, and protect existing drafts. Design authorization covers necessary local preview code and assets within the selected draft; it does not extend to product-code implementation, personal configuration changes, plugin installation, or pages outside the selected outcome.

## Select the route and output

Read the [model and execution policy](../../policy/models.md#task-start-and-execution-routing) and apply its design-specific model and effort through supported controls. Honor an explicit Human choice. Keep requested model and effort, saved settings, active-turn metadata, and server identity separate under [runtime limits](../../policy/models.md#runtime-limits). If a required model or effort is unavailable, report the specific gap and seek the user's choice only for the dependent run; continue independent preparation. Do not silently replace an explicit choice or change persistent personal settings. A client request does not establish server-side effort or design quality.

Choose an editable artifact that meets the task's output requirements. Local HTML/CSS or another project-supported editable source with rendered previews can satisfy a design-only task. Use Figma when the user requests that destination or the design work benefits from its editable layers. Preserve an explicitly required Figma deliverable rather than substituting a local preview. A missing optional Figma or Design plugin does not block a local draft or pixel-based critique.

When using Figma, discover and load the actual installed skills appropriate to the operation, including `figma-use` before programmatic file operations and `figma-generate-design` for composed screens. Follow their current prerequisites, native editable-layer requirements, and technical rules for fonts, auto-layout, text sizing, and readback. Discover other Figma skills only when their operation is needed. Do not copy an API handbook, pin a plugin cache version, or rebuild an approved design system on every correction. Report a missing required skill or connection and pause only its dependent operation.

If an effective Human instruction selects Claude Code for draft work, read the [Claude Code invocation contract](../../policy/claude-code.md), including its explicit design mode. Use tool `claude-code` only within that contract and the bound authorization. Verify its actual provider, supported model and effort, material, tools, plugins, and permissions. If Design critique is selected, discover its actual entrypoint and verify its invocation and image reading; the previously observed name is `design:design-critique`. An installed plugin or a prompt mentioning Design does not prove critique ran. Preserve an explicitly required critique route and report a missing capability without silently replacing it.

## Produce bounded editable work

Use the authoritative brief, project and target bindings, accepted style, current scope, excluded work, and expected evidence. Include enough original material to evaluate the product's core information and handling paths. Supply only authorized material when delegating through an available authorized route. Limit writes and preview commands to the selected draft and necessary assets; product-source changes retain their own implementation authority.

Keep text, controls, and hierarchy editable in the selected source. In Figma, use native editable layers rather than a flattened screen image, and follow the loaded skills for incremental construction and returned-ID readback. Inspect the existing target before creating or editing. Treat an external write with an unknown result as unresolved: inspect the same target before retrying. Do not repeat a creation because a response or local process was lost.

Retain changed artifact paths or Figma node IDs and openable links, readback results, readable full-screen previews, actual critique and image-reading evidence, findings and proposed repairs, and remaining limitations. Preserve original delegated reports and runtime provenance under the applicable execution contract. Diagnose failures and incomplete output before another attempt; take delegated work back when necessary.

## Critique and accept the actual picture

Critique the actual whole-screen pixels with product context and the current stage, using the selected available inspection route. A screenshot URL, node JSON, image dimensions, or a failed `Read` does not establish visual inspection. Tool-returned container paths may be unreadable on the client host. Use a verified readable local PNG or an inline screenshot supported by that client; otherwise report that the image was not inspected.

When Terra is selected to assist inspection, supply the candidate artifact, frame or node, a complete readable preview of that same revision, and the current requirements. Return Terra's observations and limitations to the lead for verification under the existing [delegation and acceptance rules](../../policy/models.md#delegation-and-acceptance). Terra's assistance does not replace an explicitly required critique route or lead acceptance. After repairs, recheck affected observations against the preview corresponding to the final artifact and reuse valid unaffected evidence.

The lead agent also opens the actual previews. First judge the overall aesthetic, attention, and core product information. Then inspect reading hierarchy, spacing, color responsibilities, visible buttons and their actual touch bounds. Absence of overlap, clipping, or broken prototype links establishes only basic checks.

Verify each actionable critique against pixels, artifact structure, requirements, and the approved direction before accepting it. Check color and image-type claims rather than trusting the report. Do not impose fixed name heights or flatten intentional hierarchy just for uniformity. A critique skill does not establish a separate reviewer identity. If the same model generated and critiqued the draft, label the critique as self-check and retain the lead agent's acceptance responsibility. Preserve corrected or declined findings and their reasons without rewriting the original report.

Check affected content at the target device's actual reading size. Exercise long names and other essential text, such as complete locations when relevant to the product. For mobile input flows, check applicable keyboard-occlusion and focus/scroll layouts. Reuse valid checks for unaffected content. Static keyboard placeholders demonstrate layout only; do not claim real OS input, keyboard behavior, focus, scrolling, or implemented functionality from them. Restore realistic examples in final drafts. Clean up only temporary nodes created by this task after retaining useful previews and verifying their identity.

## Deliver and stop

Provide editable artifact paths or openable Figma node links and persistent previews in the project's agreed artifact location. Verify that the previews correspond to the final artifact; a short-lived asset URL is not a durable handoff. Report the scope, visual tradeoffs, accepted repairs, checks actually performed, model-request and runtime evidence, and remaining limits. Keep design completion, visual acceptance, prototype interaction, and implementation as separate claims.

Freeze an approved visual direction. Make later local repairs for concrete evidence; do not repeatedly reselect a design system or run mechanical QA without a changed input or unresolved issue. Stop after the authorized slice and wait for the user's next choice before expanding pages or implementing code.
