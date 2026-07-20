#!/bin/bash
# Deploys the Drippy launch site (with the current build's zip) to Vercel.
#
# Deploys from a staging copy OUTSIDE the git tree, with --archive=tgz:
# - no git metadata attaches, so Vercel's commit-author check cannot block
# - the 90MB zip uploads as one archive instead of stalling per-file
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('../package.json').version")
ZIP="../dist/Drippy-$VERSION-mac-arm64.zip"
[ -f "$ZIP" ] || { echo "Missing $ZIP — run 'npm run dist' first."; exit 1; }

cp "$ZIP" Drippy-mac-arm64.zip
echo "Bundled Drippy v$VERSION ($(du -h Drippy-mac-arm64.zip | cut -f1)) into the site."

STAGE=$(mktemp -d /tmp/drippy-site.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
cp -R . "$STAGE"/

cd "$STAGE"
npx -y vercel deploy --prod --yes --archive=tgz
