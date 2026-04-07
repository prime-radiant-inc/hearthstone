#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

SCHEME="Hearthstone"
PROJECT="Hearthstone.xcodeproj"
ARCHIVE_DIR="/tmp/hearthstone-archive"
ARCHIVE_PATH="$ARCHIVE_DIR/Hearthstone.xcarchive"
EXPORT_DIR="/tmp/hearthstone-export"

# Bump build number automatically (timestamp-based so it always increments)
BUILD_NUMBER=$(date +%Y%m%d%H%M)
echo "→ Build number: $BUILD_NUMBER"

# Clean previous artifacts
rm -rf "$ARCHIVE_DIR" "$EXPORT_DIR"

echo "→ Archiving..."
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  -quiet

echo "→ Exporting and uploading to App Store Connect..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  -quiet

echo "→ Done! Build $BUILD_NUMBER uploaded to TestFlight."
echo "  It should appear in TestFlight within a few minutes."
