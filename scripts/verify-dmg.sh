#!/usr/bin/env bash
# Verify that a DMG contains a valid, ad-hoc-signed Bard.app before it is
# published or installed. Fails the pipeline if the bundle is missing,
# unsigned, or structurally invalid.
set -euo pipefail

DMG="${1:?Usage: ./scripts/verify-dmg.sh <Bard_<version>_aarch64.dmg>}"
BUNDLE_ID="com.bard.prompter"

if [[ ! -f "$DMG" || ! -s "$DMG" ]]; then
  echo "ERROR: DMG missing or empty: $DMG" >&2
  exit 1
fi

# Mount read-only, no browsing/no auto-open so Finder doesn't pop up.
MOUNT_INFO="$(hdiutil attach -nobrowse -readonly -noverify -noautoopen "$DMG")"
# Extract the mount point (last tab-separated field of the last line).
MOUNT_POINT="$(printf '%s\n' "$MOUNT_INFO" | tail -1 | sed 's/.*[[:space:]]//')"
if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
  echo "ERROR: could not determine mount point for $DMG" >&2
  echo "$MOUNT_INFO" >&2
  exit 1
fi

cleanup() {
  hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

APP="$MOUNT_POINT/Bard.app"
if [[ ! -d "$APP" ]]; then
  echo "ERROR: no Bard.app found inside $DMG (mounted at $MOUNT_POINT)" >&2
  exit 1
fi

PLIST="$APP/Contents/Info.plist"
if [[ ! -f "$PLIST" ]]; then
  echo "ERROR: $APP/Contents/Info.plist missing" >&2
  exit 1
fi

# The Info.plist is binary in release bundles; read it via plutil.
ACTUAL_ID="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$PLIST" 2>/dev/null || true)"
ACTUAL_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$PLIST" 2>/dev/null || true)"
ACTUAL_EXEC="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$PLIST" 2>/dev/null || true)"

if [[ "$ACTUAL_ID" != "$BUNDLE_ID" ]]; then
  echo "ERROR: unexpected bundle identifier: '$ACTUAL_ID' (expected '$BUNDLE_ID')" >&2
  exit 1
fi
if [[ -z "$ACTUAL_EXEC" || ! -x "$APP/Contents/MacOS/$ACTUAL_EXEC" ]]; then
  echo "ERROR: executable '$ACTUAL_EXEC' not found in $APP" >&2
  exit 1
fi

# Strict signature verification: this is what distinguishes a "damaged" app.
if ! /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP" 2>&1; then
  echo "ERROR: code signature verification failed for $APP" >&2
  exit 1
fi

SIGN_AUTHORITY="$(/usr/bin/codesign -dv --verbose=4 "$APP" 2>&1 | grep -E 'Authority=|TeamIdentifier=' || true)"
echo "Verified $APP"
echo "  version:   ${ACTUAL_VERSION:-unknown}"
echo "  identifier: $ACTUAL_ID"
echo "  executable: $ACTUAL_EXEC"
echo "  signature: $SIGN_AUTHORITY"

# Ad-hoc signed builds won't pass Gatekeeper assessment; that's expected and
# not treated as a failure, but we surface it so the release notes are honest.
if ! /usr/sbin/spctl --assess --type execute --verbose=4 "$APP" 2>&1; then
  echo "NOTE: spctl assessment failed (expected for ad-hoc signed apps);" >&2
  echo "      users may need Finder → Open or xattr -cr on first launch." >&2
fi
