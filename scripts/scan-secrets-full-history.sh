#!/usr/bin/env bash
# Full-history TruffleHog scan including Sellf custom detectors.
# Use this for audits and right after rotating a key that may have leaked —
# the pre-commit hook only covers new commits, so historical leaks need a
# manual run. Exit code 183 means TruffleHog found verified/unverified hits.
set -u
trufflehog git file://. \
  --config .trufflehog-config.yaml \
  --results=verified,unverified,unknown \
  --fail
