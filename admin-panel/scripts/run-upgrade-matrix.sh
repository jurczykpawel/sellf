#!/usr/bin/env bash
# Run the isolated deployment upgrade suite. @see tests/upgrade-matrix/README.md
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun scripts/upgrade-matrix-runner.ts "$@"
