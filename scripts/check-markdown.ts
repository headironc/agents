import { listSourcePaths } from "./source.ts";

/** Return all Markdown files in the candidate source tree for editorial checks. */
export function editableMarkdown(
  directory: string,
  files?: string[],
): string[] {
  return (
    files ?? listSourcePaths(directory).filter((file) => file.endsWith(".md"))
  );
}
