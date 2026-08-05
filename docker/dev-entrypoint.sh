#!/bin/sh
set -eu

lock_hash="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
installed_hash=""

if [ -f node_modules/.alabaster-lock-hash ]; then
  installed_hash="$(cat node_modules/.alabaster-lock-hash)"
fi

if [ "$lock_hash" != "$installed_hash" ]; then
  echo "package-lock.json changed; refreshing container dependencies"
  npm ci
  printf '%s\n' "$lock_hash" > node_modules/.alabaster-lock-hash
fi

exec "$@"
