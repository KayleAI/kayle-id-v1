# Pull request descriptions

A good PR description gets the change merged faster, gives the release notes a head start, and survives long enough to be useful when someone reads `git log` six months from now.

## Use the template

`.github/PULL_REQUEST_TEMPLATE.md` auto-populates new PRs with a Summary / Why / Test plan / Notes structure. Don't delete the headings — fill them in. If a section truly doesn't apply, write `n/a` and a one-line reason.

## What each section is for

### Summary

Two or three sentences (or up to three bullets) describing **what** changed at a behavioural level. Frame it from a user-facing or system-behaviour perspective, not a file-by-file diff.

> ✅ "Adds an `attest` field to the verify hello so the iOS client can opt into Apple App Attest. Hellos missing the field continue to work as before."
>
> ❌ "Modified `apps/api/src/v1/verify/socket-hello.ts` to add a new field."

### Why

The motivation. This is the most important section because it's what survives — the *what* is recoverable from `git diff`, the *why* often isn't. Link to the Linear issue or incident if there is one.

> "Closes ID-48. Required for Series C anti-cloning roll-out — without this gate, an attacker could replay a captured NFC session against our API."

### Test plan

A bulleted checklist of what you actually verified, and what would tell you this regressed. Reviewers use this to decide whether to also test by hand. Include:

- which automated suites you ran (`bun run lint`, the relevant `bun test`)
- any manual verification (browser flows, iOS device runs)
- known untested paths (be honest — "didn't test the iOS NFC fallback because I don't have a Series C passport handy" is more useful than silence)

### Notes (optional)

Anything that won't fit cleanly elsewhere: rollout order, follow-ups, screenshots, perf measurements, migration steps for ops.

## Title format

PR titles drive squash-commit messages, which drive release notes. Use:

```
<type>: <imperative summary>
```

Where `<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Cap titles at ~70 characters; let the body do the heavy lifting.

> ✅ `feat: gate verify hello on App Attest assertion`
>
> ❌ `Some changes to the verify socket and a couple of other things`

If the change closes a Linear issue, append the ID:

> `feat: clickable org name with relying-party details dialog (ID-49)`

## Linking issues

- Close issues with `Closes ID-NN` (Linear's convention) or `Closes #NN` (for GitHub issues) in the description.
- Reference (without closing) related issues with `Related: ID-NN`.

## Stacked PRs

If the change is large enough that it should be split, open the stack as separate PRs and link them in order in the description ("Builds on #N. Followed by #M."). One reviewer should be able to walk the stack top-to-bottom without losing context.

## Screenshots and recordings

For UI changes, include a before/after screenshot or a short screen recording. The PR template has a placeholder; embed the file directly rather than linking to an external host.

## Drafts

Open the PR as a draft if you want CI to run but aren't ready for review. Mark it ready when:

- the description is filled in
- the test plan is honest
- you've self-reviewed the diff
