#!/usr/bin/env bash
# Contract wrapper: `node` -> `scripts/check.ts`.
# - Read [executor](check.ts). Use tool `bash`.
set -euo pipefail
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
node="$repository_root/.cache/agents-tools/bin/node"
[[ -f $node && ! -L $node && -x $node ]] || {
  echo 'Missing pinned Node; run bash scripts/install-tools.sh' >&2
  exit 1
}
exec "$node" "$repository_root/scripts/check.ts" "$@"
