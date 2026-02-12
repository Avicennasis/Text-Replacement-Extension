#!/usr/bin/env bash
# =============================================================================
# build.sh — Text Replacement Extension Build Script
# =============================================================================
# Builds the extension for both Chromium (Chrome/Edge/Opera) and Firefox.
#
# What this script does:
#   1. Cleans any previous build output (dist/ directory).
#   2. Copies the shared source files (src/) to both build targets.
#   3. Copies the correct browser-specific manifest.json for each target.
#
# Usage:
#   ./build.sh              Build both targets
#   ./build.sh chromium     Build only Chromium
#   ./build.sh firefox      Build only Firefox
#
# Output:
#   dist/chromium/   → Load this in Chrome, Edge, or Opera
#   dist/firefox/    → Load this in Firefox
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"

# Determine which targets to build
if [ $# -gt 0 ]; then
    TARGETS=("$@")
else
    TARGETS=("chromium" "firefox")
fi

# Pre-flight check: verify all required source files exist before copying.
# This gives a clear, descriptive error instead of a cryptic "cp: cannot stat"
# message, making it easier to diagnose issues (especially in CI).
REQUIRED_FILES=("content.js" "manage.js" "manage.html" "manage.css" "background.js")
for required in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SRC_DIR/$required" ]; then
        echo "ERROR: Missing source file: src/$required"
        exit 1
    fi
done

echo "Building Text Replacement Extension..."
echo ""

for target in "${TARGETS[@]}"; do
    # Validate target name
    if [ ! -d "$SCRIPT_DIR/manifests/$target" ]; then
        echo "  ERROR: Unknown target '$target'. Expected 'chromium' or 'firefox'."
        exit 1
    fi

    TARGET_DIR="$DIST_DIR/$target"

    # Clean previous build for this target
    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"

    # Copy shared source files
    cp "$SRC_DIR/content.js" "$TARGET_DIR/"
    cp "$SRC_DIR/manage.js" "$TARGET_DIR/"
    cp "$SRC_DIR/manage.html" "$TARGET_DIR/"
    cp "$SRC_DIR/manage.css" "$TARGET_DIR/"
    cp "$SRC_DIR/background.js" "$TARGET_DIR/"
    cp -r "$SRC_DIR/images" "$TARGET_DIR/"

    # Copy browser-specific manifest
    cp "$SCRIPT_DIR/manifests/$target/manifest.json" "$TARGET_DIR/"

    echo "  Built $target → $TARGET_DIR/"
done

echo ""
echo "Build complete! Load the extension from:"
for target in "${TARGETS[@]}"; do
    echo "  $target: $DIST_DIR/$target/"
done
