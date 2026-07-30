#!/bin/bash
# Builds distributable Drippy artifacts into dist/:
#   Drippy-<version>.dmg           — disk image
#   Drippy-<version>-mac-arm64.zip — the download users install from
#
# The app is ad-hoc signed, which is enough for a valid signature but NOT
# enough for frictionless distribution: users still get an "unidentified
# developer" prompt. Proper distribution needs an Apple Developer ID
# certificate plus notarisation (see the release checklist).
#
# Signing must happen AFTER the bundle is modified (icon, locale pruning), or
# the signature no longer matches the contents. An invalid signature plus the
# quarantine flag a browser download adds is what macOS reports as
# "Drippy is damaged and can't be opened", which has no user-facing recovery
# path — not even removing the quarantine attribute helps. So this script signs
# last, and verifies before packaging.
#
# Signing also has to happen outside the repo: this project lives in a
# cloud-synced folder whose provider keeps re-applying `com.apple.FinderInfo`
# xattrs, and codesign refuses to sign anything carrying them ("resource fork,
# Finder information, or similar detritus not allowed"). /tmp is not synced.
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
  --ignore="^/site" --ignore="^/promo" --ignore="^/test" \
  --ignore="^/server" --ignore="\.env" >/dev/null

APP="dist/Drippy-darwin-arm64/Drippy.app"
# packager's --icon flag is unreliable; place the icns directly
cp build/icon.icns "$APP/Contents/Resources/electron.icns"

# Drop Chromium's non-English locale packs (~47MB uncompressed, ~12MB zipped).
# Drippy's own UI is English only, so these only ever supplied Chromium's
# built-in strings, which fall back to English.
FW_RES="$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"
find "$FW_RES" -maxdepth 1 -name '*.lproj' ! -name 'en.lproj' ! -name 'en_GB.lproj' -exec rm -rf {} + 2>/dev/null || true

# --- sign in a clean, unsynced staging area -----------------------------------
STAGE=$(mktemp -d /tmp/drippy-sign.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Drippy.app"
(
  cd "$STAGE"
  xattr -cr Drippy.app
  find Drippy.app -name '.DS_Store' -delete 2>/dev/null || true
  # Inner code first, outer bundle last: signing the wrapper before its nested
  # helpers and frameworks leaves the outer seal stale.
  find Drippy.app/Contents/Frameworks -maxdepth 1 \( -name '*.app' -o -name '*.framework' \) -print0 |
    while IFS= read -r -d '' b; do
      codesign --force --sign - --timestamp=none "$b" 2>&1 | grep -v 'replacing existing signature' || true
    done
  codesign --force --sign - --timestamp=none Drippy.app 2>&1 | grep -v 'replacing existing signature' || true

  # Refuse to ship an invalid signature: that is the "damaged" failure.
  if ! codesign --verify --strict Drippy.app 2>/dev/null; then
    echo "FATAL: signature did not verify after signing." >&2
    codesign --verify --strict --verbose=2 Drippy.app || true
    exit 1
  fi
  echo "Signed and verified (ad-hoc)."
)

# The signed copy replaces the staged build, so dist/ and the archives agree.
rm -rf "$APP"
ditto "$STAGE/Drippy.app" "$APP"

ditto -c -k --keepParent "$STAGE/Drippy.app" "dist/Drippy-$VERSION-mac-arm64.zip"
hdiutil create -volname Drippy -srcfolder "$STAGE/Drippy.app" -ov -format UDZO "dist/Drippy-$VERSION.dmg" -quiet

echo "Artifacts:"
ls -lh "dist/Drippy-$VERSION.dmg" "dist/Drippy-$VERSION-mac-arm64.zip" | awk '{print "  " $9 " (" $5 ")"}'
