#!/usr/bin/env bash
# Release gate: fail when open Dependabot PRs labelled `release-batch` or `security` are
# older than MAX_AGE_HOURS (default 24). Those PRs are never auto-merged; they must be
# folded into the release branch (or closed with a reason) before a release is built.
#
# Input: JSON from `gh pr list --json number,title,createdAt,labels` on stdin
# (the workflow pipes it in; tests feed sample data). NOW_EPOCH overrides the clock.
set -euo pipefail

max_age_hours="${MAX_AGE_HOURS:-24}"
now="${NOW_EPOCH:-$(date +%s)}"

stale=$(jq -r --argjson now "$now" --argjson max "$max_age_hours" '
  .[]
  | select(any(.labels[]; .name == "release-batch" or .name == "security"))
  | select(($now - (.createdAt | fromdateiso8601)) > ($max * 3600))
  | "#\(.number) \(.title) [\([.labels[].name] | join(","))]"')

if [ -n "$stale" ]; then
  echo "::error::Open Dependabot PRs (release-batch/security) older than ${max_age_hours}h block this release:"
  echo "$stale"
  echo "Merge them into the release branch and run them through the gate, or close them with a reason, then rebuild."
  exit 1
fi
echo "No stale release-batch/security Dependabot PRs."
