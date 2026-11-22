#!/usr/bin/env bash
set -euo pipefail

ZIP="${1:?Usage: ./scripts/import_ubs.sh path/to/ubs.zip}"

mkdir -p external

if [ -e external/ubs ]; then
    echo "external/ubs already exists."
    exit 1
fi

unzip -q "$ZIP" -d external
mv external/ai-financial-twin-lauzhack-2026-main external/ubs

echo "UBS resources imported into external/ubs/"
