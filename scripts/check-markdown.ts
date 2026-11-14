import { listSourcePaths } from "./source.ts";
import { verifiedModernWebFiles } from "./modern-web-source.ts";

/** Only verified original bytes retain upstream editorial conventions. */
export function editableMarkdown(
  directory: string,
  files?: string[],
): string[] {
  const originals = verifiedModernWebFiles(directory);
  return (
    files ?? listSourcePaths(directory).filter((file) => file.endsWith(".md"))
  ).filter((file) => !originals.has(file));
}
