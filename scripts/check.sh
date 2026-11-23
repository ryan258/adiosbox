#!/bin/sh
set -eu

output=$(mktemp -d "${TMPDIR:-/tmp}/adiosbox-check.XXXXXX")
trap 'rm -rf -- "$output"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

build_site() {
  printf 'Building %s site\n' "$1"
  if hugo --panicOnWarning --environment "$1" --baseURL "$2" --destination "$3" > "$output/$1.log" 2>&1; then
    return 0
  else
    status=$?
    cat "$output/$1.log" >&2
    return "$status"
  fi
}

staging_url=${ADIOSBOX_STAGING_URL:-https://example.invalid/adiosbox/}
staging_url=${staging_url%/}/
staging_dir=${ADIOSBOX_GITHUB_PAGES_OUTPUT:-"$output/staging"}
build_site staging "$staging_url" "$staging_dir"
if [ -n "${ADIOSBOX_GITHUB_PAGES_OUTPUT:-}" ]; then
  rm -f -- "$staging_dir/_headers"
fi
build_site local http://127.0.0.1:1313/ "$output/local"
printf 'Running Node tests\n'
ADIOSBOX_STAGING_URL="$staging_url" ADIOSBOX_STAGING_HTML="$staging_dir/index.html" \
  ADIOSBOX_LOCAL_HTML="$output/local/index.html" node --test tests/*.test.mjs
