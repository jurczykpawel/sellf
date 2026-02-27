# Contributing to Sellf

Thank you for your interest in contributing to Sellf! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.1+ (runtime & package manager)
- [Node.js](https://nodejs.org/) v20+ (for some tooling)
- [Docker](https://www.docker.com/) (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli) v2.45+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/jurczykpawel/sellf.git
cd sellf

# Start local Supabase
npx supabase start

# Install dependencies
cd admin-panel
bun install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your local Supabase keys (shown by `supabase start`)

# Run development server
bun dev

# Run tests
bun test
```

### Project Structure

```
sellf/
  admin-panel/     # Next.js application (main codebase)
  mcp-server/      # MCP server for AI integrations
  supabase/        # Database migrations and seed data
  scripts/         # Utility scripts
  bruno/           # API collection (Bruno client)
  templates/       # HTML templates for content protection
```

## Making Changes

### Branch Naming

- `feature/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code improvements

### Commit Messages

Write concise commit messages that explain **why**, not just what:

```
feat: add currency filtering for BLIK payment method
fix: filter out pending transactions from My Purchases page
refactor: remove unused link_display_mode config
```

### Code Style

- TypeScript strict mode
- Follow existing patterns in the codebase
- No unnecessary abstractions — keep it simple
- Tests for new features and bug fixes

### Running Tests

```bash
# Unit tests
cd admin-panel && bun test

# E2E tests (requires running dev server)
bun run test:e2e

# Type checking
bun run typecheck

# Build verification
bun run build
```

## Pull Request Process

1. Create a branch from `dev`
2. Make your changes with tests
3. Ensure `bun run build` passes cleanly
4. Ensure `bun test` passes
5. Open a PR against `dev` with a clear description
6. Wait for review

### PR Description Template

```markdown
## Summary
Brief description of the change.

## Test Plan
How to verify this works.
```

## Releases & Versioning

Releases are created manually. The **Build & Release** CI workflow builds the `sellf-build.tar.gz` artifact automatically.

### How to release

```bash
# Create a new release (triggers CI build)
gh release create v1.0.2 --title "Sellf v1.0.2" --notes "Changelog here"

# Or trigger build manually (without creating a release tag first)
gh workflow run build-release.yml -f version=v1.0.2
```

### Deploying to server

```bash
# Update existing installation (downloads latest release from GitHub)
./local/deploy.sh sellf --ssh=mikrus --update

# Or with a local build file
./local/deploy.sh sellf --ssh=mikrus --update --build-file=~/sellf-build.tar.gz

# Restart only (after .env.local changes)
./local/deploy.sh sellf --ssh=mikrus --update --restart
```

### Commit message conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) prefixes for clarity:

| Prefix | Example |
|---|---|
| `fix:` | `fix: prevent stale session after DB reset` |
| `feat:` | `feat: add variant group support` |
| `chore:` | `chore: update dependencies` |
| `docs:` | `docs: update CONTRIBUTING.md` |

## Reporting Issues

Use [GitHub Issues](https://github.com/jurczykpawel/sellf/issues) to report bugs or request features. Include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (OS, browser, Node version)

## Security

For security vulnerabilities, please use [GitHub Security Advisories](https://github.com/jurczykpawel/sellf/security/advisories/new) instead of public issues. See [SECURITY.md](./SECURITY.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
