#!/usr/bin/env bash
# Publish a new Bard release: build the DMG, push tags, attach to GitHub Releases.
set -euo pipefail

cd "$(dirname "$0")"

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

# 2. Build the DMG
npm run tauri build

# 3. Copy DMG to project root
cp "src-tauri/target/release/bundle/dmg/Bard_${VERSION}_aarch64.dmg" "./Bard_${VERSION}_aarch64.dmg"

# 4. Commit + tag
git add -A
git commit -m "Release v${VERSION}" || true
git tag "v${VERSION}"
git push origin main --tags

# 5. Publish GitHub release with DMG
gh release create "v${VERSION}" \
  "./Bard_${VERSION}_aarch64.dmg" \
  --repo "$REPO" \
  --title "Bard v${VERSION}" \
  --notes "Bard v${VERSION} — see the changelog for details."

echo "✓ Published v${VERSION} → https://github.com/${REPO}/releases/tag/v${VERSION}"
