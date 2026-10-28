#!/usr/bin/env bash
# Contract subject: `pinned-tool-bootstrap`.
# - Read [contract](../delivery/policy/tool-contracts.md). Use tool `curl`.
# - Read [executor](check.ts). Use tool `bash`.
# - Read [executor](check.ts). Use tool `node`.
# - Read [executor](check.ts). Use tool `bun`.
# - Read [executor](check.ts). Use tool `shellcheck`.
# - Read [executor](check.ts). Use tool `actionlint`.
# - Read [executor](check.ts). Use tool `zizmor`.
# - Read [executor](check.ts). Use tool `gitleaks`.
# - Read [executor](check-docs.ts). Use tool `lychee`.
# - Read [adapter](check-skills.ts). Use tool `skill-validation`.

# Prepare one verified executable; the caller owns publication and rollback.
prepare_pinned_tool() (
  set -euo pipefail
  umask 077
  [[ $# == 7 ]] || { echo 'Expected seven tool preparation arguments' >&2; exit 2; }
  # Subshell variables remain available to EXIT even after a function exits.
  name=$1 version=$2 format=$3 url=$4 expected=$5 flag=$6 cache_root=$7
  checksum_command=()
  [[ $name =~ ^[a-z][a-z0-9-]*$ && $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ &&
    $expected =~ ^[a-f0-9]{64}$ && $flag =~ ^--?[a-z-]+$ && $url == https://* &&
    $cache_root == /* && $cache_root != */../* && $cache_root != */./* ]] || {
    echo 'Invalid pinned tool input' >&2; exit 2;
  }
  case "$format:$url" in
    binary:*) ;;
    archive:*.tar.gz|archive:*.tar.xz|archive:*.zip) ;;
    *) echo 'Unsupported tool format' >&2; exit 2 ;;
  esac
  ancestor=$cache_root
  while [[ $ancestor != / ]]; do
    [[ ! -L $ancestor ]] || { echo 'Symlink in tool cache path' >&2; exit 1; }
    ancestor=$(dirname "$ancestor")
  done
  mkdir -p "$cache_root/archives"
  [[ -d $cache_root && -O $cache_root && -d $cache_root/archives &&
    ! -L $cache_root/archives && -O $cache_root/archives ]] || {
    echo 'Invalid tool cache ownership or type' >&2; exit 1;
  }
  if command -v sha256sum >/dev/null 2>&1; then checksum_command=(sha256sum)
  elif command -v shasum >/dev/null 2>&1; then checksum_command=(shasum -a 256)
  else echo 'A SHA-256 utility is required' >&2; exit 1; fi
  temporary=$(mktemp -d "$cache_root/.prepare.XXXXXX")
  candidate=
  trap 'rm -rf -- "$temporary"; if [[ -n $candidate ]]; then rm -f -- "$candidate"; fi' EXIT
  archive="$temporary/package"
  cached="$cache_root/archives/$expected"
  if [[ -e $cached || -L $cached ]]; then
    [[ -f $cached && ! -L $cached && -O $cached ]] || {
      echo 'Invalid cached archive' >&2; exit 1;
    }
    cp -- "$cached" "$archive"
  else
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 \
      --connect-timeout 15 --max-time 180 -o "$archive" "$url"
  fi
  actual=$("${checksum_command[@]}" "$archive")
  [[ ${actual%% *} == "$expected" ]] || { echo "Checksum mismatch for $name" >&2; exit 1; }
  candidate=$(mktemp "$cache_root/.candidate-$name.XXXXXX")
  if [[ $format == binary ]]; then
    cp -- "$archive" "$candidate"
  else
    case "$url" in
      *.tar.gz) listing=$(tar -tzf "$archive") ;;
      *.tar.xz) listing=$(tar -tJf "$archive") ;;
      *.zip) listing=$(unzip -Z1 "$archive") ;;
    esac
    # Only stream the selected member. No archive path is extracted to disk.
    member=$(printf '%s\n' "$listing" | awk -v name="$name" '
      /^\// || /(^|\/)\.\.($|\/)/ || /^-/ { bad = 1 }
      { n = split($0, parts, "/"); if (parts[n] == name) { count++; member = $0 } }
      END { if (bad || count != 1) exit 1; print member }
    ') || { echo "Expected one safe archive member named $name" >&2; exit 1; }
    case "$url" in
      *.tar.gz) tar -xOzf "$archive" "$member" > "$candidate" ;;
      *.tar.xz) tar -xOJf "$archive" "$member" > "$candidate" ;;
      *.zip) unzip -p "$archive" "$member" > "$candidate" ;;
    esac
  fi
  chmod 0755 "$candidate"
  actual=$("$candidate" "$flag" 2>&1) || { echo "Version probe failed for $name" >&2; exit 1; }
  printf '%s\n' "$actual" | tr '[:space:]' '\n' | sed 's/^v//' | \
    awk -v expected="$version" '$0 == expected { found = 1 } END { exit !found }' || {
      echo "Expected $name $version; found: $actual" >&2; exit 1;
    }
  if [[ ! -e $cached ]]; then
    cp -- "$archive" "$temporary/cache"
    chmod 0600 "$temporary/cache"
    mv -- "$temporary/cache" "$cached"
  fi
  printf '%s\n' "$candidate"
  candidate=
)

# Prepare the top-level license from an archive already cached by prepare_pinned_tool.
prepare_pinned_license() (
  set -euo pipefail
  umask 077
  [[ $# == 4 ]] || { echo 'Expected four license preparation arguments' >&2; exit 2; }
  name=$1 url=$2 expected=$3 cache_root=$4
  [[ $name =~ ^[a-z][a-z0-9-]*$ && $expected =~ ^[a-f0-9]{64}$ && $url == https://* &&
    $cache_root == /* && $cache_root != */../* && $cache_root != */./* ]] || {
    echo 'Invalid pinned license input' >&2; exit 2;
  }
  case "$url" in
    *.tar.gz|*.tar.xz|*.zip) ;;
    *) echo 'Unsupported license archive format' >&2; exit 2 ;;
  esac
  cached="$cache_root/archives/$expected"
  [[ -f $cached && ! -L $cached && -O $cached ]] || { echo "Missing verified archive for $name" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then checksum_command=(sha256sum)
  elif command -v shasum >/dev/null 2>&1; then checksum_command=(shasum -a 256)
  else echo 'A SHA-256 utility is required' >&2; exit 1; fi
  temporary=$(mktemp -d "$cache_root/.license.XXXXXX")
  candidate=
  trap 'rm -rf -- "$temporary"; if [[ -n $candidate ]]; then rm -f -- "$candidate"; fi' EXIT
  archive="$temporary/package"
  cp -- "$cached" "$archive"
  actual=$("${checksum_command[@]}" "$archive")
  [[ ${actual%% *} == "$expected" ]] || { echo "Checksum mismatch for $name" >&2; exit 1; }
  case "$url" in
    *.tar.gz) listing=$(tar -tzf "$archive") ;;
    *.tar.xz) listing=$(tar -tJf "$archive") ;;
    *.zip) listing=$(unzip -Z1 "$archive") ;;
  esac
  # Nested dependency licenses are not the runtime's own license.
  member=$(printf '%s\n' "$listing" | awk '
    /^\// || /(^|\/)\.\.($|\/)/ || /^-/ { bad = 1 }
    /^[^\/]+\/LICENSE$/ { count++; member = $0 }
    END { if (bad || count != 1) exit 1; print member }
  ') || { echo "Expected one top-level LICENSE member for $name" >&2; exit 1; }
  candidate=$(mktemp "$cache_root/.candidate-$name-license.XXXXXX")
  case "$url" in
    *.tar.gz) tar -xOzf "$archive" "$member" > "$candidate" ;;
    *.tar.xz) tar -xOJf "$archive" "$member" > "$candidate" ;;
    *.zip) unzip -p "$archive" "$member" > "$candidate" ;;
  esac
  [[ -s $candidate ]] || { echo "Empty license for $name" >&2; exit 1; }
  chmod 0600 "$candidate"
  printf '%s\n' "$candidate"
  candidate=
)
