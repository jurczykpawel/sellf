#!/usr/bin/env bash
# Block commits that include agent implementation briefs.
# Triggered by .pre-commit-config.yaml via `files:` regex matching
# docs/superpowers/ or docs/plans/ markdown anywhere in the tree.
#
# Agent briefs reference private vault paths and internal workflow
# (REQUIRED SUB-SKILL, subagent dispatch). They belong in .claude/
# (gitignored), not in a public repo.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

echo "ERROR: agent implementation plans must live in .claude/ (gitignored), not in the public repo:"
printf "  %s\n" "$@"
echo ""
echo "Fix: move with"
echo "  mkdir -p .claude/plans && git mv <file> .claude/plans/"
echo ""
echo "If the file legitimately belongs in docs/, rename the directory away from 'superpowers' or 'plans'."
exit 1
