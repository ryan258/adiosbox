#!/bin/sh
set -eu

if [ -n "${CF_PAGES_URL:-}" ] && [ "${CF_PAGES_BRANCH:-}" != "main" ]; then
  exec hugo --panicOnWarning --baseURL "${CF_PAGES_URL%/}/"
fi

exec hugo --panicOnWarning
