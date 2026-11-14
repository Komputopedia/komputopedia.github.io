#!/bin/sh
# Stamp every app file reference with a new version so browsers fetch fresh copies after a deploy.
# Run from the repo root or this folder before committing a front-end change.
set -e
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d%H%M)
sed -i -E "s#(app/(main\.js|style\.css|cloud\.svg))(\?v=[0-9]+)?#\1?v=$V#g" index.html
for f in app/main.js app/api.js; do
  sed -i -E "s#\"\./(engine|api|i18n)\.js(\?v=[0-9]+)?\"#\"./\1.js?v=$V\"#g" "$f"
done
sed -i -E "s#const APP_BUILD = \"[0-9]+\"#const APP_BUILD = \"$V\"#" app/main.js
echo "version $V"
