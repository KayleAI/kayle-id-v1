# Linting

This repo uses [Ultracite](https://www.ultracite.dev), a zero-config preset over [Biome](https://biomejs.dev). Ultracite handles both formatting and linting; there's no separate ESLint or Prettier config.

## Commands

```bash
bun run lint       # full lint suite (format + runtime-logs + actions-pinning)
bun run format     # auto-fix Biome-fixable issues (alias for `ultracite fix`)
bun run check      # lint without fixing (alias for `ultracite check`)
bunx ultracite doctor  # diagnose a broken setup
```

`bun run lint` chains three checks:

- **`lint:format`** — `ultracite check` runs the Biome rule set across the workspace.
- **`lint:runtime-logs`** — `scripts/check-runtime-console.ts` blocks `console.log`, `debugger`, and `alert` from runtime code paths. Tests, scripts, and seeding files are exempt; production code under `apps/`, `packages/`, and `infra/` is not.
- **`lint:actions`** — `scripts/check-github-actions-pinned.ts` enforces that every `uses:` reference in `.github/workflows/*.yml` is pinned to a 40-character commit SHA, never a tag or branch.

## Pre-commit hook

`.husky/pre-commit` runs `bunx ultracite fix` against staged files. If the formatter rewrites files, they're re-staged automatically. If a rule can't be auto-fixed, the commit fails — fix the issue, re-stage, and commit again. **Never bypass the hook with `--no-verify`** unless you've been told to in writing.

## What Biome won't catch

Biome handles formatting and most idiomatic-JavaScript rules automatically. It can't validate:

- **Business logic correctness** — a passing lint is not a passing test.
- **Naming** — variable, function, and type names need to express intent. Aim for self-documenting code.
- **Architecture** — Biome won't flag a parallel implementation, a leaky abstraction, or a duplicated utility. That's review territory, and it's covered in [AGENTS.md](../../AGENTS.md).
- **Edge cases** — boundary conditions and error states.
- **Accessibility, performance, UX** — Biome catches some accessibility issues (alt text, ARIA), but a real review is still required for UI work.

## When to break a rule

Biome rules can be disabled inline with `// biome-ignore lint/<rule>: <reason>`. Only do this when:

1. The rule is a false positive for the specific case (rare).
2. The fix would be more confusing than the violation.

In both cases, leave a one-line reason on the disable comment so a reviewer can evaluate it. Project-wide rule changes go through `biome.jsonc` and require sign-off — don't quietly disable rules to make CI green.

## Editor setup

Biome has [first-class editor integrations](https://biomejs.dev/guides/editors/first-party-extensions/). The repo doesn't enforce a specific editor, but install the Biome extension for your editor so format-on-save matches the CI checker — that prevents the "lint passes locally, fails in CI" loop.
