# Antigravity behavior

- This native global rules entry serves Antigravity CLI and App. Its asset root is the adjacent `antigravity-cli/` directory: references to the product delivery root in shared instructions mean that asset root, not the directory containing this entry. Shared policy, skill, and tool links below resolve through that root.
- Use the running CLI or App's actual tools, instruction discovery, and project context. Verify the repository and candidate for each supported executor under the [execution context contract](../policy/tool-contracts.md#执行上下文). Do not assume the App and CLI share a current directory, tool inventory, session state, or accepted permissions.
- Honor the actual client's native file-editing and permission mechanisms. Resolve missing capabilities within existing authority; this entry does not provide Codex chat tools, Codex model defaults, or a substitute for native client permissions.
