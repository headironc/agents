---
name: figma-design-workflow
description: Orchestrate authorized Figma design creation and iteration through local Claude Code with DeepSeek, Design critique, and lead-agent visual acceptance. Use when delegating editable design drafts or refining an approved visual direction with these plugins. Excludes product-code implementation and ordinary read-only design analysis.
---

# Figma Design Workflow

This is a Codex orchestration skill. Codex owns requirements, authorization, delegation, and acceptance; Claude Code is the local client that performs the bounded design work. Do not pass this orchestration role back to Claude Code or ask it to delegate to itself.

## Bind the design task

Read project instructions, goals, existing material, and the actual target Figma file. Distinguish exploration, continuation of an approved direction, and a local correction. Bind the current pages or states, approved references, intended outcome, and acceptance checks. Preserve existing drafts and assets outside the target. If the user rejects an earlier visual constraint, remove it from the delegated brief rather than quietly reusing it.

Use the user's effective project or task authorization for the requested design work. The lead selects necessary project material, uses the established provider, identifies the target file and pages or nodes from the task context, and performs reversible design edits within that scope. These execution bindings do not require a separately approved material package or permission for each file, node, or edit. Ask only for a business decision that context cannot resolve, a material scope expansion, or an external operation outside the effective authorization. Preserve explicit user restrictions, exclude secrets and unrelated material, and protect existing drafts. Design authorization does not extend to product-code implementation, personal configuration changes, plugin installation, or pages outside the selected outcome.

## Discover capabilities and prepare the client

Read [model and delegation policy](../../policy/models.md) and the [Claude Code invocation contract](../../policy/claude-code.md), including its explicit design mode, before invocation. Use tool `claude-code` only within those contracts and the bound authorization.

Discover the plugins and skills available to the actual Claude Code process, using its current catalog and readable installed entrypoints. Verify the provider endpoint without exposing credentials. Keep requested model and effort separate from response identity. Select a DeepSeek model verified as available through the chosen authorized official route under the [model policy](../../policy/models.md#claude-code-and-deepseek-delegation) and invocation contract. Honor an explicit Human model choice. For drawing, design iteration, and design critique, request effort `max` unless the user chooses otherwise. Apply the invocation contract's process-local effort controls. This design preference remains separate from ordinary bounded execution; that mode does not grant Figma permissions. If the requested model or effort is unsupported, report the gap and seek the user's choice for the dependent run rather than silently substituting. A client request does not establish server-side effort or better design quality.

Require the executing client to load the actual installed Figma skills appropriate to the task, including `figma-use` before programmatic file operations and `figma-generate-design` for composed screens. Follow their current prerequisites, native editable-layer requirements, and technical rules for fonts, auto-layout, text sizing, and readback. Discover other Figma skills only when their operation is needed. Do not copy an API handbook, pin a plugin cache version, or rebuild an approved design system on every correction.

Discover Design's critique entrypoint; the observed invocation is `design:design-critique`. Verify the actual installed name and invoke it through `Skill`. A plugin being enabled, a prompt mentioning Design, or loading this workflow does not prove critique ran. If a required plugin, skill, image-read path, or connection is unavailable, report the specific gap and pause only the dependent operation. Continue independent work or use an available alternative the user selects; do not silently install or replace the requested route.

## Delegate bounded editable work

Pass the authoritative brief, project and target bindings, accepted style, current scope, excluded work, and expected return evidence. Include enough original material to evaluate the product's core information and handling paths. Supply only authorized material. Keep model, effort, tools, plugins, and MCP permissions scoped to the child process under the invocation contract. Do not enable shell or product-source writes merely to draw a screen.

Ask for native editable Figma text, controls, and hierarchy. Inspect the existing target before creating or editing. Follow the loaded Figma skills for incremental construction and returned-ID readback. Treat an external write with an unknown result as unresolved: inspect the same target before retrying. Do not repeat a creation because a response or local process was lost.

Require a return report containing changed node IDs and openable links, readback results, readable full-screen previews, actual critique invocation and image-reading evidence, findings and proposed repairs, and remaining limitations. Preserve the original report and runtime provenance under the invocation contract. Diagnose failures and incomplete output before another attempt; take the task back when necessary.

## Critique and accept the actual picture

Have Design critique read the actual whole-screen pixels with product context and the current stage. A screenshot URL, node JSON, image dimensions, or a failed `Read` does not establish visual inspection. Tool-returned container paths may be unreadable on the client host. Use a verified readable local PNG or an inline screenshot supported by that client; otherwise report that the image was not inspected.

When Terra is selected to assist inspection, supply the candidate frame or node, a complete readable preview of that same revision, and the current requirements. Return Terra's observations and limitations to the lead for verification under the existing [delegation and acceptance rules](../../policy/models.md#delegation-and-acceptance). Terra's assistance does not replace actual Design critique or lead acceptance. After repairs, recheck affected observations against the preview corresponding to the final nodes and reuse valid unaffected evidence.

The lead agent also opens the actual previews. First judge the overall aesthetic, attention, and core product information. Then inspect reading hierarchy, spacing, color responsibilities, visible buttons and their actual touch bounds. Absence of overlap, clipping, or broken prototype links establishes only basic checks.

Verify each actionable critique against pixels, node facts, requirements, and the approved direction before accepting it. Check color and image-type claims rather than trusting the report. Do not impose fixed name heights or flatten intentional hierarchy just for uniformity. Design supplies a skill framework; it is not a separate reviewer identity. If the same model generated and critiqued the draft, label the critique as self-check and retain the lead agent's acceptance responsibility. Preserve corrected or declined findings and their reasons without rewriting the original report.

Check affected content at the target device's actual reading size. Exercise long names and other essential text, such as complete locations when relevant to the product. For mobile input flows, check applicable keyboard-occlusion and focus/scroll layouts. Reuse valid checks for unaffected content. Static keyboard placeholders demonstrate layout only; do not claim real OS input, keyboard behavior, focus, scrolling, or implemented functionality from them. Restore realistic examples in final drafts. Clean up only temporary nodes created by this task after retaining useful previews and verifying their identity.

## Deliver and stop

Provide openable Figma node links and persistent previews in the project's agreed artifact location. Verify that the previews correspond to the final nodes; a short-lived asset URL is not a durable handoff. Report the scope, visual tradeoffs, accepted repairs, checks actually performed, and remaining limits. Keep design completion, visual acceptance, prototype interaction, and implementation as separate claims.

Freeze an approved visual direction. Make later local repairs for concrete evidence; do not repeatedly reselect a design system or run mechanical QA without a changed input or unresolved issue. Stop after the authorized slice and wait for the user's next choice before expanding pages or implementing code.
