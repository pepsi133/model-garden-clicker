#!/bin/sh
# Build the Chrome Web Store upload: dist/model-garden-clicker-<version>.zip
# holding only the extension's runtime files, with manifest.json at the zip
# root. Test files, node_modules, package.json and editor leftovers are not
# included. Usage: sh scripts/build-extension-zip.sh [--out DIR]
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
OUT="$ROOT/dist"
if [ "${1:-}" = "--out" ]; then OUT="$2"; fi

command -v zip >/dev/null 2>&1 || { echo "zip is not installed" >&2; exit 2; }
VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT/manifest.json" | head -1)
[ -n "$VERSION" ] || { echo "no \"version\" in $EXT/manifest.json" >&2; exit 2; }

mkdir -p "$OUT"
ZIP="$OUT/model-garden-clicker-$VERSION.zip"
rm -f "$ZIP"

# Runtime files: the manifest, the model list, and every directory the
# manifest references. Nothing under test/ ships, and neither does the
# 512 px icon master (icons/icon-master.png, the source of the sized icons
# and of icons/avatar96.png, which the pages show).
cd "$EXT"
zip -q -X -r "$ZIP" \
  manifest.json \
  models.json \
  background common content icons options popup \
  -x '*/.*' -x '*.map' -x 'icons/icon-master.png'

echo "built $ZIP"
unzip -Z1 "$ZIP" | sed 's/^/  /'
