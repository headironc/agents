#!/usr/bin/env bash
# Contract wrapper: `pinned-tool-bootstrap` -> `scripts/tool-bootstrap.sh`.
# - Read [contract](../delivery/policy/tool-contracts.md). Use tool `jq`.
# - Read [executor](check.ts). Use tool `bash`.
# - Read [executor](check.ts). Use tool `node`.
# - Read [executor](check.ts). Use tool `bun`.
# - Read [executor](check.ts). Use tool `shellcheck`.
# - Read [executor](check.ts). Use tool `actionlint`.
# - Read [executor](check.ts). Use tool `zizmor`.
# - Read [executor](check-docs.ts). Use tool `lychee`.
# - Read [executor](check.ts). Use tool `gitleaks`.
# - Read [adapter](check-skills.ts). Use tool `skill-validation`.
# - Read [validator](skill-validator.py). Use tool `python`.
set -euo pipefail
umask 077
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# shellcheck source=scripts/tool-bootstrap.sh
source "$repository_root/scripts/tool-bootstrap.sh"
command -v jq >/dev/null 2>&1 || { echo 'Install jq before bootstrapping tools' >&2; exit 1; }
platform="$(uname -s)-$(uname -m)"
manifest="$repository_root/scripts/tool-versions.json"
cache_root="$repository_root/.cache/agents-tools"
prepare_validators=false
if [[ $# == 0 ]]; then
  set -- node bun shellcheck actionlint zizmor lychee gitleaks
  prepare_validators=true
fi

# Validate every selector and manifest entry before any download or cache write.
for name in "$@"; do
  case "$name" in node|bun|shellcheck|actionlint|zizmor|lychee|gitleaks) ;;
    *) printf 'Unsupported tool selector: %s\n' "$name" >&2; exit 2 ;;
  esac
  jq -e --arg name "$name" --arg platform "$platform" '
    .tools[$name] as $tool | $tool.platforms[$platform] as $target |
    ($tool.versionFlag | test("^--?[a-z-]+$")) and
    (($tool.format // "archive") | IN("archive", "binary")) and
    ($target.url | startswith("https://")) and
    (($tool.format // "archive") == "binary" or ($target.url | test("\\.(tar\\.gz|tar\\.xz|zip)$"))) and
    ($target.sha256 | test("^[a-f0-9]{64}$"))
  ' "$manifest" >/dev/null || { echo "No verified $name input for $platform" >&2; exit 2; }
  case "$name" in
    node) version=$(jq -er '.engines.node' "$repository_root/package.json") ;;
    bun) version=$(jq -er '.packageManager | capture("^bun@(?<version>[0-9.]+)$").version' "$repository_root/package.json") ;;
    *) version=$(jq -er --arg name "$name" '.tools[$name].version' "$manifest") ;;
  esac
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid pinned version' >&2; exit 2; }
done
for directory in "$repository_root/.cache" "$cache_root" "$cache_root/bin"; do
  [[ ! -L $directory ]] || { echo 'Symlink in tool destination' >&2; exit 1; }
  mkdir -p "$directory"
  [[ -d $directory && -O $directory ]] || { echo 'Invalid tool destination' >&2; exit 1; }
done
candidate=
trap 'if [[ -n $candidate ]]; then rm -f -- "$candidate"; fi' EXIT
for name in "$@"; do
  case "$name" in
    node) version=$(jq -er '.engines.node' "$repository_root/package.json") ;;
    bun) version=$(jq -er '.packageManager | sub("^bun@"; "")' "$repository_root/package.json") ;;
    *) version=$(jq -er --arg name "$name" '.tools[$name].version' "$manifest") ;;
  esac
  format=$(jq -er --arg name "$name" '.tools[$name].format // "archive"' "$manifest")
  url=$(jq -er --arg name "$name" --arg platform "$platform" '.tools[$name].platforms[$platform].url' "$manifest")
  expected=$(jq -er --arg name "$name" --arg platform "$platform" '.tools[$name].platforms[$platform].sha256' "$manifest")
  flag=$(jq -er --arg name "$name" '.tools[$name].versionFlag' "$manifest")
  target="$cache_root/bin/$name"
  [[ ! -L $target && ( ! -e $target || ( -f $target && -O $target ) ) ]] || {
    echo "Invalid installed target for $name" >&2; exit 1;
  }
  candidate=$(prepare_pinned_tool "$name" "$version" "$format" "$url" "$expected" "$flag" "$cache_root")
  [[ ! -L $target && ( ! -e $target || ( -f $target && -O $target ) ) ]] || {
    echo "Tool destination changed for $name" >&2; exit 1;
  }
  mv -f -- "$candidate" "$target"
  candidate=
  # Installer runtime copies carry the pinned Node license from the same verified archive.
  if [[ $name == node ]]; then
    license_root="$cache_root/licenses"
    [[ ! -L $license_root ]] || { echo 'Symlink in license destination' >&2; exit 1; }
    mkdir -p "$license_root"
    [[ -d $license_root && -O $license_root ]] || { echo 'Invalid license destination' >&2; exit 1; }
    candidate=$(prepare_pinned_license "$name" "$url" "$expected" "$cache_root")
    mv -f -- "$candidate" "$license_root/$name-LICENSE"
    candidate=
  fi
  printf 'Installed verified %s %s\n' "$name" "$version"
done
if [[ $prepare_validators == true ]]; then
  command -v python3 >/dev/null 2>&1 || { echo 'Python 3.9 or later is required' >&2; exit 1; }
  python3 -I -B "$repository_root/scripts/skill-validator.py" install
fi
echo 'Repository tools prepared; personal configuration is unchanged.'
