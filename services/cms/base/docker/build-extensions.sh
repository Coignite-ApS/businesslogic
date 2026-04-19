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

            # Directories without a directus:extension manifest are shared libraries.
            # Copy them in-place (siblings to built extensions) so relative imports resolve,
            # but do NOT try to build them with `directus-extension build`.
            if ! grep -q '"directus:extension"' "$ext_dir/package.json"; then
                echo "Copying $name (shared library — no directus:extension manifest)"
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

            # Verify build succeeded
            if [ ! -f "dist/index.js" ]; then
                echo "ERROR: Build failed - dist/index.js not found for $name"
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
