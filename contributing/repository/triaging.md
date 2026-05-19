# Triaging

Issues and feature requests are tracked in two places:

- **GitHub Issues** — the public-facing entry point for outside contributors and bug reports.
- **Linear (`ID`)** — the internal source of truth for what's being worked on, prioritised, and shipped.

Maintainers triage GitHub issues into Linear weekly. Outside contributors don't need a Linear account to file or follow an issue — GitHub is the front door.

## Filing an issue

Use one of the issue templates (`.github/ISSUE_TEMPLATE/`):

- **Bug report** for anything that's broken, regressed, or behaves differently from documented behaviour.
- **Feature request** for new functionality.

For security issues, do not open a public issue or pull request — see [SECURITY.md](../../SECURITY.md) and email `security@kayle.id` instead.

## Triage labels

Maintainers apply labels during the weekly triage:

| Label              | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `triage`           | Hasn't been looked at yet (set by the issue templates).                  |
| `bug`              | Confirmed bug — promoted to Linear and queued for a fix.                 |
| `enhancement`      | Confirmed feature request — added to the Linear backlog.                 |
| `needs-info`       | Waiting on the reporter for a repro, version, or environment details.   |
| `wontfix`          | Out of scope or working as intended. The issue is closed with an explanation. |
| `duplicate`        | Closed in favour of an existing issue, with a link to it.                |
| `good first issue` | Self-contained, well-scoped — a reasonable first contribution.           |

## Reproducible reports

A bug report is much easier to triage if it includes:

- The version of Kayle ID (`package.json#version`) or the commit SHA you're running.
- The command you ran or the request you made.
- The full output (with stack traces if any), redacted of any PII.
- What you expected vs. what happened.

If a maintainer applies `needs-info` and the report goes silent for 14 days, the issue is closed. It can be reopened once the missing details are supplied — closing isn't a verdict, it's bookkeeping.

## Promoting to Linear

When a maintainer accepts an issue, it gets:

1. A Linear ticket (`ID-NN`) created in the `KID` team.
2. A comment on the GitHub issue linking to the Linear ticket.
3. Either an `accepted` label or, if scoped, a `good first issue` label.

The Linear ticket is the source of truth from that point on. PRs that close the issue should reference both the GitHub number (`Closes #N`) and the Linear ID (`Closes ID-NN`).

## What outside contributors can pick up

Any open issue tagged `good first issue` or `accepted` is fair game. Drop a comment claiming the issue ("I'd like to work on this") so two people don't end up duplicating work — a maintainer will react with 👍 to confirm. If the comment goes unacknowledged for a week, the claim is open again.

## Stale issues

There's no automated stale-bot. Maintainers periodically prune issues that have been open for more than six months without activity, but only after re-pinging the reporter. If you've filed an issue that's been quiet for a while, a friendly "still seeing this on v<x.y.z>" comment helps it surface.
