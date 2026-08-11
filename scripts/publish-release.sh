#!/usr/bin/env bash
# Publish a new Bard release: build the DMG, push tags, attach to GitHub Releases.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:?Usage: ./scripts/publish-release.sh <version> (e.g. 0.2.0)}"
REPO="marcpadz/bard"

# 1. Bump version in package.json + tauri.conf.json
node -e "
const fs = require('fs');
for (const f of ['package.json', 'src-tauri/tauri.conf.json']) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
console.log('version bumped to $VERSION');
"

# 2. Build the DMG (temporarily disables the app bundle target check so a
#    valid macOS app is built; the DMG is produced by step 2b below).
npm run tauri build -- --no-bundle

# 2b. Build the DMG explicitly — tauri's bundled script runs in the background
#     and can exit non-zero without failing the build (the DMG silently
#     missing), so we invoke it synchronously here.
DMG_DIR="src-tauri/target/release/bundle/dmg"
DMG_PATH="${DMG_DIR}/Bard_${VERSION}_aarch64.dmg"
rm -f "$DMG_PATH" "$DMG_DIR"/rw.*.dmg
if [[ ! -f "$DMG_DIR/bundle_dmg.sh" ]]; then
  echo "DMG bundling script missing after build — something went wrong" >&2
  exit 1
fi
bash "$DMG_DIR/bundle_dmg.sh" \
  --volname Bard \
  --window-size 400 300 \
  --icon-size 128 \
  --app-drop-link 340 190 \
  --icon Bard.app 140 190 \
  "$DMG_PATH" "src-tauri/target/release/bundle/macos" >/dev/null
if [[ ! -s "$DMG_PATH" ]]; then
  echo "DMG was not produced — aborting release" >&2
  exit 1
fi

# 3. Re-sign the app bundle ad-hoc so Gatekeeper doesn't flag it as damaged
APP_BUNDLE="src-tauri/target/release/bundle/macos/Bard.app"
codesign --force --deep --sign - "$APP_BUNDLE"

# 4. Copy DMG to project root
cp "src-tauri/target/release/bundle/dmg/Bard_${VERSION}_aarch64.dmg" "./Bard_${VERSION}_aarch64.dmg"

# 5. Commit + tag
git add package.json src-tauri/tauri.conf.json
git commit -m "Release v${VERSION}" || true
git tag "v${VERSION}"
git push origin main --tags

# 6. Publish GitHub release with DMG
gh release create "v${VERSION}" \
  "./Bard_${VERSION}_aarch64.dmg" \
  --repo "$REPO" \
  --title "Bard v${VERSION}" \
  --notes "Bard v${VERSION} — see the changelog for details."

echo "✓ Published v${VERSION} → https://github.com/${REPO}/releases/tag/v${VERSION}"
