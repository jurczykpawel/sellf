#!/usr/bin/env bash
# Populated release upgrade gate. @see tests/upgrade-matrix/README.md
set -euo pipefail
exec python3 "$(dirname "$0")/upgrade-data-test.py" "$@"
