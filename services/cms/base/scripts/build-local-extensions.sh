#!/bin/sh
# =============================================================================
# Build Local Extensions
# =============================================================================
# Builds all local extensions for hot-reload development.
# Called automatically by dev.sh before starting Docker.
#
# Usage:
#   ./base/scripts/build-local-extensions.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BASE_DIR")"

printf "Building local extensions...\n"

build_extension() {
    dir="$1"
    name=$(basename "$dir")

    if [ ! -f "$dir/package.json" ]; then
        return
    fi

    printf "  %-45s" "$name"

    # Check if dist exists and is newer than src
    if [ -d "$dir/dist" ] && [ -f "$dir/dist/index.js" ]; then
        # Find newest src file
        newest_src=$(find "$dir/src" -type f -newer "$dir/dist/index.js" 2>/dev/null | head -1)
        if [ -z "$newest_src" ]; then
            printf "up to date\n"
            return
        fi
    fi

    cd "$dir"

    # Install deps if needed
    if [ ! -d "node_modules" ]; then
        if ! npm install; then
            printf "FAILED (npm install)\n"
            exit 1
        fi
    fi

    # Build
    if npx directus-extension build; then
        printf "built\n"
    else
        printf "FAILED (build)\n"
        exit 1
    fi

    cd - >/dev/null
}

# Build base extensions
if [ -d "$BASE_DIR/extensions/local" ]; then
    for dir in "$BASE_DIR/extensions/local"/*; do
        [ -d "$dir" ] && build_extension "$dir"
    done
fi

# Build project extensions
if [ -d "$PROJECT_ROOT/extensions/local" ]; then
    for dir in "$PROJECT_ROOT/extensions/local"/*; do
        [ -d "$dir" ] && build_extension "$dir"
    done
fi

printf "Done.\n"
