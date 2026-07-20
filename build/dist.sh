#!/bin/bash
# Builds distributable Drippy artifacts into dist/:
#   Drippy-<version>.dmg           — the download users install from
#   Drippy-<version>-mac-arm64.zip — alternative archive
#
# Note: the app is ad-hoc signed. Public distribution additionally needs an
# Apple Developer ID certificate + notarization (see README release checklist).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
echo "Building Drippy v$VERSION (darwin-arm64)…"

npx electron-packager . Drippy \
  --platform=darwin --arch=arm64 \
  --app-bundle-id=com.drippy.companion \
  --app-version="$VERSION" \
  --out=dist --overwrite \
  --ignore="design_handoff_drippy" --ignore="^/dist" --ignore="^/build" \
  --ignore="^/site" --ignore="^/promo" --ignore="^/test" >/dev/null

APP="dist/Drippy-darwin-arm64/Drippy.app"
# packager's --icon flag is unreliable; place the icns directly
cp build/icon.icns "$APP/Contents/Resources/electron.icns"
touch "$APP"

ditto -c -k --keepParent "$APP" "dist/Drippy-$VERSION-mac-arm64.zip"
hdiutil create -volname Drippy -srcfolder "$APP" -ov -format UDZO "dist/Drippy-$VERSION.dmg" -quiet

echo "Artifacts:"
ls -lh "dist/Drippy-$VERSION.dmg" "dist/Drippy-$VERSION-mac-arm64.zip" | awk '{print "  " $9 " (" $5 ")"}'
