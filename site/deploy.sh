#!/bin/bash
# Deploys the Drippy launch site (with the current build's zip) to Vercel.
# First time: `npx vercel login` then `npx vercel link` in this directory.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('../package.json').version")
ZIP="../dist/Drippy-$VERSION-mac-arm64.zip"
[ -f "$ZIP" ] || { echo "Missing $ZIP — run 'npm run dist' first."; exit 1; }

cp "$ZIP" Drippy-mac-arm64.zip
echo "Bundled Drippy v$VERSION ($(du -h Drippy-mac-arm64.zip | cut -f1)) into the site."

npx vercel deploy --prod
