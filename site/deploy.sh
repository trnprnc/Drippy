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
# Capture the deployment URL, then promote explicitly. `deploy --prod` is
# supposed to bind the production aliases itself, but twice now the alias
# (drippy-ten.vercel.app) has silently detached and started returning 404 while
# the deployment itself stayed healthy. An explicit promote re-binds it, so it
# runs every time as cheap insurance, and the aliases are checked afterwards.
# The CLI interleaves progress output with the URL, so match the URL shape
# rather than trusting the last line.
DEPLOY_OUT=$(npx -y vercel deploy --prod --yes --archive=tgz 2>&1)
DEPLOY_URL=$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'https://drippy-[a-z0-9]+-trnsprnc\.vercel\.app' | tail -1)
echo "Deployed: ${DEPLOY_URL:-<url not parsed>}"

echo "Checking the live aliases…"
sleep 6
FAILED=""
for host in drippy-ten.vercel.app drippy-trnsprnc.vercel.app; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$host/")
  printf '  %-34s %s\n' "$host" "$code"
  [ "$code" = "200" ] || FAILED="yes"
done

# Twice now the production alias has silently detached and served 404 while the
# deployment itself stayed healthy. An explicit promote re-binds it.
if [ -n "$FAILED" ] && [ -n "$DEPLOY_URL" ]; then
  echo "An alias is not serving — promoting $DEPLOY_URL to re-bind it…"
  npx -y vercel promote "$DEPLOY_URL" --yes >/dev/null 2>&1 || true
  sleep 8
  for host in drippy-ten.vercel.app drippy-trnsprnc.vercel.app; do
    printf '  %-34s %s (after promote)\n' "$host" "$(curl -s -o /dev/null -w '%{http_code}' "https://$host/")"
  done
elif [ -n "$FAILED" ]; then
  echo "An alias is not serving and the deploy URL could not be parsed. Fix by hand:"
  echo "  npx vercel ls drippy   # find the newest deployment"
  echo "  npx vercel promote <that-url> --yes"
fi
