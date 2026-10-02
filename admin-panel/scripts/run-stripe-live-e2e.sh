#!/usr/bin/env bash
# Run the opt-in real Stripe test-mode suite. @see tests/stripe-live/README.md
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun --env-file=.env.local scripts/stripe-live-runner.ts "$@"
