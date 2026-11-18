---
name: ship
description: Test, commit, push and open or report a PR with accurate status. Use when the user says ship, "commit and push", or asks for the PR state. Never merges and never pushes main.
---

# Ship the current work

1. `git fetch`. Report the branch, whether it is behind or ahead of its upstream, and whether local `main` is behind `origin/main`. If the branch is `main`, stop and create a branch first.
2. Run the project's test command (look in CLAUDE.md, package.json, the solution or Makefile). Stop and report if anything fails; do not commit failing work.
3. Stop any dev server, test host or other process you started during this task.
4. Review `git status` and `git diff`; never stage secrets, key files or build output. Commit with a clear message (follow any attribution rules in the project's CLAUDE.md; this overrides default trailers).
5. Push the branch (never force-push, never push `main`).
6. Pull request: if one exists, show its true state with `gh pr view <n> --json state,baseRefName,mergeable`; otherwise open one with `gh pr create` (a draft if review is still to come). If `gh` is missing, give the compare URL instead.
7. Report in a short table: branch, commit, tests (count), PR link and state, and anything not verified. A PR merged into a branch other than `main` is not merged into `main`; say so.

Do not merge, and do not start extra branches or PRs that were not asked for.
