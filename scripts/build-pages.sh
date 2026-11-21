#!/bin/sh
set -eu

npm ci --ignore-scripts --no-audit --no-fund

if [ -n "${CF_PAGES_URL:-}" ] && [ "${CF_PAGES_BRANCH:-}" != "main" ]; then
  exec hugo --panicOnWarning --baseURL "${CF_PAGES_URL%/}/"
fi

exec hugo --panicOnWarning
