#!/usr/bin/env bash
# Publish a new Bard release: build the app, ad-hoc sign it, package the DMG,
# verify the signed app inside the DMG, push tags, and attach to GitHub Releases.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:?Usage: ./scripts/publish-release.sh <version> (e.g. 0.3.2)}"
REPO="marcpadz/bard"
APP_BUNDLE="src-tauri/target/release/bundle/macos/Bard.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"
DMG_PATH="${DMG_DIR}/Bard_${VERSION}_aarch64.dmg"

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

# 2. Build the app bundle using --bundles app so the .app bundle is produced cleanly;
#    the DMG is still built explicitly after signing below so we never package a pre-signing app.
npm run tauri build -- --bundles app
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: app bundle not produced at $APP_BUNDLE" >&2
  exit 1
fi

# 3. Strip quarantine xattrs and ad-hoc sign the app bundle BEFORE packaging
#    so the DMG contains a clean, signed app.
xattr -cr "$APP_BUNDLE"
codesign --force --deep --options runtime --sign - "$APP_BUNDLE"

# 4. Verify the source bundle before packaging.
if ! /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" 2>&1; then
  echo "ERROR: source bundle failed signature verification — aborting release" >&2
  exit 1
fi

# 5. Build the DMG synchronously. Tauri's bundled script can exit non-zero
#    without failing `tauri build`, so we invoke it explicitly here with --skip-jenkins.
rm -f "$DMG_PATH" "$DMG_DIR"/rw.*.dmg "src-tauri/target/release/bundle/macos"/rw.*.dmg
if [[ ! -f "$DMG_DIR/bundle_dmg.sh" ]]; then
  echo "ERROR: DMG bundling script missing after build" >&2
  exit 1
fi
bash "$DMG_DIR/bundle_dmg.sh" \
  --skip-jenkins \
  --volname Bard \
  --window-size 400 300 \
  --icon-size 128 \
  --app-drop-link 340 190 \
  --icon Bard.app 140 190 \
  "$DMG_PATH" "src-tauri/target/release/bundle/macos" >/dev/null
if [[ ! -s "$DMG_PATH" ]]; then
  echo "ERROR: DMG was not produced — aborting release" >&2
  exit 1
fi

# 5b. Ad-hoc sign the DMG itself for clean quarantine handling.
codesign --force --sign - "$DMG_PATH"

# 6. Verify the app INSIDE the DMG (not just the source bundle). This is the
#    artifact users actually install/update with.
if ! scripts/verify-dmg.sh "$DMG_PATH"; then
  echo "ERROR: DMG verification failed — aborting release" >&2
  exit 1
fi

# 7. Copy DMG to project root
cp "$DMG_PATH" "./Bard_${VERSION}_aarch64.dmg"

# 8. Commit + tag
git add package.json src-tauri/tauri.conf.json
git commit -m "Release v${VERSION}" || true
git tag "v${VERSION}"
git push origin main --tags

# 9. Publish GitHub release with DMG
gh release create "v${VERSION}" \
  "./Bard_${VERSION}_aarch64.dmg" \
  --repo "$REPO" \
  --title "Bard v${VERSION}" \
  --notes "Bard v${VERSION} — see the changelog for details."

echo "✓ Published v${VERSION} → https://github.com/${REPO}/releases/tag/v${VERSION}"
