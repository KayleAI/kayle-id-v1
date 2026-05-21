<!--
Thanks for opening a PR! Please fill in every section below — write `n/a` if a
section truly does not apply, with a one-line reason. See
contributing/repository/pull-request-descriptions.md for the full guidance.

Do not disclose security vulnerabilities or proposed vulnerability fixes in a
public PR. Email security@kayle.id first.
-->

## Summary

<!--
Two or three sentences (or up to three bullets) describing what changed at a
behavioural level. Frame it from a user-facing or system-behaviour perspective,
not a file-by-file diff.
-->

## Why

<!--
The motivation. Link to the Linear issue with `Closes ID-NN` if there is one.
This section is the most important — it's what survives in `git log` long
after the diff is forgotten.
-->

## Test plan

<!--
A bulleted checklist of what you actually verified. Include automated suites
(`bun run lint`, `bun test ./path/...`) and any manual verification (browser
flow, iOS device run). Be honest about what's untested.
-->

- [ ] `bun run lint`
- [ ] relevant test suites
- [ ] `wrangler deploy --dry-run` for any Worker that changed
- [ ] manual verification (describe)

## Notes

<!--
Optional. Rollout order, follow-ups, screenshots/recordings for UI changes,
performance measurements, or anything else a reviewer should know.
-->
