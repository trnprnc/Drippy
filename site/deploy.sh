#!/bin/bash
# Deploys the Drippy launch site (with the current build's zip) to Vercel.
#
# Deploys from a staging copy OUTSIDE the git tree, with --archive=tgz:
# - no git metadata attaches, so Vercel's commit-author check cannot block
# - the 90MB zip uploads as one archive instead of stalling per-file
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('../package.json').version")
# The binary is NOT bundled here any more: it is a GitHub release asset, and
# the site links to /releases/latest/download/Drippy-mac-arm64.zip. That keeps
# the deploy tiny (Vercel Hobby caps static uploads at 100MB, and the app is
# already past it) and gives every build a permanent, versioned download URL.
echo "Deploying the Drippy site (v$VERSION). Binary is served from GitHub releases."
rm -f Drippy-mac-arm64.zip

STAGE=$(mktemp -d /tmp/drippy-site.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
cp -R . "$STAGE"/

cd "$STAGE"
npx -y vercel deploy --prod --yes --archive=tgz
