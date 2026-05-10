# Adding documentation

The public docs at [docs.kayle.id](https://docs.kayle.id) are built from the `docs/` directory using [Mintlify](https://mintlify.com). This page covers what goes in `docs/` and how to preview your changes.

## Where to put docs

| Audience                                | Path                                       |
| --------------------------------------- | ------------------------------------------ |
| Public docs (developers integrating Kayle ID) | `docs/`                              |
| Repo-internal contributor docs          | `contributing/` (this folder)              |
| AGENTS / AI-assist guardrails           | `AGENTS.md` at the repo root               |
| README quick start                      | `README.md` at the repo root               |

If you're documenting a thing **users of Kayle ID** need to know (an API, a webhook payload, an SDK), it goes in `docs/`. If you're documenting a thing **contributors** need to know (how to test, how to build, why we made an architectural decision), it goes in `contributing/` and links from `CONTRIBUTING.md`.

## Local preview

```bash
cd docs
bunx mint dev
```

The dev server reloads on file changes. The Solo entry "Docs" runs the same command — useful when you want it managed alongside the rest of the local stack.

## Structure

`docs/docs.json` is the Mintlify config. The `navigation.tabs` array is the source of truth for the left-nav structure; if you add a new page, add it to the matching group there. Pages are `.mdx` files (MDX = Markdown + JSX) so you can use Mintlify components like `<Card>`, `<CodeGroup>`, `<Note>`.

Common locations:

- `docs/index.mdx` — landing page
- `docs/quickstart.mdx` — first integration
- `docs/api-reference/` — REST API reference
- `docs/auth/` — authentication and key management
- `docs/concepts/` — explainer pages ("how it works")
- `docs/verifications/`, `docs/webhooks/` — feature-specific guides

## Writing guidelines

These mirror what `docs/CONTRIBUTING.md` already says, but they're worth repeating because they're the same conventions used across the repo's prose:

- **Active voice.** "Run the command" not "the command should be run."
- **Address the reader directly.** "You" instead of "the user."
- **One idea per sentence.** If a sentence has more than one verb in the same clause, it can probably be split.
- **Lead with the goal.** "To verify a session, …" reads better than "The verification process is initiated by …"
- **Consistent terminology.** Don't alternate between synonyms — pick one and stick with it. (e.g. "verification session" vs. "verify run" — pick one.)
- **Show, don't tell.** Include a code sample whenever you describe an API or CLI behaviour.

## Code samples

- Use real, runnable examples — not pseudo-code.
- Include the full request/response, not just the URL.
- For multi-language samples, use Mintlify's `<CodeGroup>` so the reader can switch languages.
- Mark fields that are sensitive (`Bearer kayle_…`) with placeholder values, never real keys.

## Publishing

Docs publish automatically when changes land on `main`. Mintlify watches the `docs/` directory and redeploys the live site. There is no separate release tag for docs — a typo fix can ship in the same PR as the code change it documents.

## Reviewing docs PRs

When reviewing a docs-only PR:

- Check that any code in the docs would actually run against the current API (`apps/api/src/v1/`).
- If the docs reference an env var, an endpoint, or a webhook event, confirm the name and casing exactly match the implementation.
- Run `bunx mint dev` against the branch and click through the rendered output — broken links and incorrectly-nested groups don't always show up in the diff.
