#!/usr/bin/env bash
set -euo pipefail

package='@plif/cli'
version="${PLIF_VERSION:-latest}"
minimum_node_major=20
minimum_node_minor=11
uninstall=0

fail() {
  printf '\nplif: %s\n' "$1" >&2
  if [[ -n "${2:-}" ]]; then
    printf '%s\n' "$2" >&2
  fi
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || fail '--version needs a value.' 'Use --version latest or a published semantic version.'
      version="$2"
      shift 2
      ;;
    --uninstall)
      uninstall=1
      shift
      ;;
    --help|-h)
      printf '%s\n' 'Usage: install.sh [--version VERSION] [--uninstall]'
      exit 0
      ;;
    *)
      fail "unknown option: $1" 'Use --help to see the supported options.'
      ;;
  esac
done

printf '%s\n' '' '   ____  __    ___  _____' '  / __ \/ /   /   |/ ___/' ' / /_/ / /   / /| |\\__ \' '/ ____/ /___/ ___ /__/ /' '/_/   /_____/_/  |_/____/' '' '  Plif  |  terminal coding agent' '  Bring your model. Keep control of your workspace.' ''

if [[ "$uninstall" -eq 1 ]]; then
  command -v npm >/dev/null 2>&1 || fail 'npm was not found.' 'Install Node.js 20.11 or newer, then run this again.'
  printf '%s\n' "  > removing $package"
  npm uninstall -g "$package" --loglevel=error || fail 'npm could not remove plif.' "Try: npm uninstall -g $package"
  printf '%s\n' '  [ok] plif removed from this machine' '' '  Your sessions, containers, memory and saved credentials were left alone:' "  ${HOME}/.plif" ''
  exit 0
fi

command -v node >/dev/null 2>&1 || fail 'Node.js is not installed.' 'Install Node.js 20.11 or newer from https://nodejs.org, then run this again.'
node_version="$(node --version 2>/dev/null | sed 's/^v//')"
IFS=. read -r node_major node_minor _ <<< "$node_version"
[[ "${node_major:-0}" =~ ^[0-9]+$ && "${node_minor:-0}" =~ ^[0-9]+$ ]] || fail "could not read the Node.js version: $node_version"
if (( node_major < minimum_node_major || (node_major == minimum_node_major && node_minor < minimum_node_minor) )); then
  fail "Node.js $node_version is too old." 'Update Node.js from https://nodejs.org, then run this again.'
fi
command -v npm >/dev/null 2>&1 || fail 'npm was not found, though Node.js is installed.' 'Reinstall Node.js so npm is included.'

printf '%s\n' "  [ok] Node.js $node_version detected" "  [ok] npm $(npm --version) detected" "  > installing $package@$version"
npm install -g "$package@$version" --loglevel=error || fail 'npm could not install plif.' "Run directly to see why: npm install -g $package@$version"

global_npm_root="$(npm root -g --silent 2>/dev/null)" || fail 'npm installed plif but did not reveal its global package directory.' 'Run npm root -g and inspect the installation before starting plif.'
[[ -n "$global_npm_root" ]] || fail 'npm installed plif but did not reveal its global package directory.' 'Run npm root -g and inspect the installation before starting plif.'
package_root="$global_npm_root/@plif/cli"
manifest_file="$package_root/package.json"
changelog_file="$package_root/CHANGELOG.md"
[[ -f "$manifest_file" && -f "$changelog_file" ]] || fail 'the published package is missing package.json or CHANGELOG.md.' 'The install was stopped because every release must ship its versioned changelog.'
installed_version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$manifest_file")" || fail 'the installed package version could not be read.' 'Inspect the npm global package before starting plif.'
changelog_section="$(awk -v version="$installed_version" '
  $0 ~ /^##[[:space:]]+/ {
    candidate = $0
    sub(/^##[[:space:]]+/, "", candidate)
    sub(/^\[/, "", candidate)
    sub(/^v/, "", candidate)
    sub(/\].*$/, "", candidate)
    sub(/[[:space:]].*$/, "", candidate)
    if (started) exit
    if (candidate == version) started = 1
  }
  started { print }
' "$changelog_file")"
[[ -n "$changelog_section" ]] || fail "CHANGELOG.md has no section for installed version $installed_version." 'The install was stopped because the release cannot be reviewed safely.'
printf '%s\n' '' "  What's new in Plif $installed_version" "$changelog_section" | sed 's/^/  /'

preference_root="${PLIF_DATA_DIR:-${HOME}/.plif}"
preference_file="$preference_root/update-preferences.json"
preference='true'
if [[ -t 0 && -t 1 ]]; then
  printf '%s' '  Run the automatic NPM update checker when new versions are published? [Y/n] '
  read -r answer || answer=''
  case "${answer,,}" in
    n|no) preference='false' ;;
  esac
fi
mkdir -p "$preference_root"
chmod 700 "$preference_root" 2>/dev/null || true
temporary="$preference_file.$$"
printf '{"enabled":%s,"disabledVersions":[]}\n' "$preference" > "$temporary"
chmod 600 "$temporary" 2>/dev/null || true
mv -f "$temporary" "$preference_file"

if command -v plif >/dev/null 2>&1; then
  reported="$(plif version 2>/dev/null || true)"
  printf '%s\n' '' "  [ok] ${reported:-plif installed}" '' '  Welcome to Plif.' '  Your sessions, memory and configuration stay yours.' '' '  Start it:' '    plif' '' '  plif ships with no model configured and no keys of anyone else''s.' '  Start it, press / and pick the provider and model you want.'
else
  printf '%s\n' '' '  [ok] plif installed' '  Open a new terminal if the plif command is not on PATH yet.'
fi
