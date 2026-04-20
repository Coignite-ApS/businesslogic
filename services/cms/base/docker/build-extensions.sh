#!/bin/sh
# =============================================================================
# Build Local Directus Extensions
# =============================================================================
# Builds extensions from one or more source directories.
#
# Usage:
#   build-extensions.sh /path/to/extensions [/path/to/more/extensions ...]
#
# Each directory should contain extension subdirectories with package.json.
# Built extensions are installed to /directus/extensions/
# =============================================================================

set -e

TOTAL_BUILT=0

echo "========================================"
echo "Building local extensions..."
echo "========================================"

for SRC_DIR in "$@"; do
    if [ ! -d "$SRC_DIR" ]; then
        echo "Skipping non-existent directory: $SRC_DIR"
        continue
    fi

    for ext_dir in "$SRC_DIR"/*/; do
        if [ -d "$ext_dir" ] && [ -f "$ext_dir/package.json" ]; then
            name=$(basename "$ext_dir")

            # Shared libraries carry a no-op directus:extension bundle manifest
            # (see bl:shared-lib convention). They are pre-seeded by the Dockerfile
            # before this script runs. Build them normally — their no-op entries []
            # produce dist/app.js + dist/api.js which the post-build check accepts.
            if ! grep -q '"directus:extension"' "$ext_dir/package.json"; then
                # Legacy path: truly manifest-less dir — copy in-place and skip build.
                echo "Copying $name (no directus:extension manifest)"
                cp -r "$ext_dir" "/directus/extensions/$name"
                continue
            fi

            echo "----------------------------------------"
            echo "Building: $name"
            echo "----------------------------------------"

            # Copy to extensions directory
            cp -r "$ext_dir" "/directus/extensions/$name"
            cd "/directus/extensions/$name"

            # Install dev deps and build
            npm install --include=dev
            npx directus-extension build

            # Verify build succeeded — hook extensions produce dist/index.js,
            # bundle extensions produce dist/app.js + dist/api.js; accept either.
            if [ ! -f "dist/index.js" ] && [ ! -f "dist/app.js" ] && [ ! -f "dist/api.js" ]; then
                echo "ERROR: Build failed - no dist output found for $name"
                exit 1
            fi

            echo "OK $name built successfully"

            # Cleanup node_modules to save space
            rm -rf node_modules

            TOTAL_BUILT=$((TOTAL_BUILT + 1))
        fi
    done
done

echo "========================================"
echo "OK Built $TOTAL_BUILT local extension(s)"
echo "========================================"
