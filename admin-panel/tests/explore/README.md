# Exploratory Tests (AI-driven)

Python Playwright scripts for AI-driven exploratory testing of Sellf on remote instances.

These are NOT automated test suites — they're reconnaissance and exploration scripts
that an AI agent runs, takes screenshots, and analyzes visually.

## Requirements

- Python 3.10+
- `pip install playwright && playwright install chromium`
- Target instance with `E2E_MODE=true` (enables password login)

## Usage

```bash
# Full admin exploration
python tests/explore/admin_explore.py

# Regular user perspective
python tests/explore/user_explore.py

# Guest/checkout flow
python tests/explore/guest_explore.py
```

## Target

Default: `https://sellf.tojest.dev`
Override: `SELLF_URL=https://other.instance python tests/explore/admin_explore.py`

## Seed users (E2E_MODE)

| Email | Password | Role |
|-------|----------|------|
| demo@sellf.app | demo123 | Admin |
| john.doe@example.com | password123 | User |
| maria.schmidt@example.com | password123 | User |
| anna.kowalska@example.com | password123 | User |
