# Agent workflow template (spec first, separate roles, owner merges)

A portable copy of the workflow used on Macro Diary, with the project specifics replaced by `{{PLACEHOLDERS}}`. It works in any repo that has a test command and a pull-request flow; the browser-tester part is optional (web UIs only).

## The idea in one paragraph
Three roles are kept apart on purpose. A **test-designer** agent defines "done" (a spec plus failing tests) BEFORE anyone implements. **You** (the main session) implement until the tests pass, without editing those tests. A read-only **pr-reviewer** agent and (for UI) a **browser-tester** agent judge the result, at the same time. The **owner** merges; agents never merge, never push the main branch and never force-push. Every hand-over uses the same table, so you always see what ran, who ran it and what was not verified.

```
plan (you show it to the owner if user-visible)
  -> branch from origin/main
  -> test-designer: spec + failing tests (own commit)
  -> you: implement to green (designer test fixes go back to the designer, own commits)
  -> push, draft PR
  -> pr-reviewer  +  browser-tester   (same time, both post on the PR)
  -> fix findings, re-run only what changed
  -> mark ready -> hand-over table -> owner merges
```

## What is in this folder
| Path | Goes to | What it is |
|---|---|---|
| `project/CLAUDE.md.template` | repo root `CLAUDE.md` | project rules: commands, layers, workflow, attribution, backlog |
| `project/.claude/agents/test-designer.md` | repo `.claude/agents/` | writes spec + failing tests; may only touch spec and test folders |
| `project/.claude/agents/pr-reviewer.md` | repo `.claude/agents/` | read-only review against the spec, test integrity, security, shipping |
| `project/.claude/agents/browser-tester.md` | repo `.claude/agents/` | (optional) runs the spec's checklist in a headless browser, network stubbed |
| `project/.claude/skills/ship-feature/SKILL.md` | repo `.claude/skills/ship-feature/` | the 8-step workflow |
| `project/tools/browser-test/KNOWN-FAILURES.md.template` | repo `tools/browser-test/` | scenarios that already fail on main, so reports do not re-investigate them |
| `user/CLAUDE.md.template` | `~/.claude/CLAUDE.md` | your personal working agreements across all projects |
| `user/skills/ship/SKILL.md`, `user/skills/preflight/SKILL.md` | `~/.claude/skills/` | `/ship` (test, commit, push, true PR status) and `/preflight` (environment check) |
| `user/settings.hooks.example.json` | merge into `~/.claude/settings.json` | Stop hook that kills leftover test hosts (Windows/.NET example) |

## Adopting it (about 20 minutes)
1. Copy the `project/` contents into the repo, the `user/` contents into `~/.claude/` (merge, do not overwrite your own files). Remove `.template` from the file names.
2. Search for `{{` and replace each placeholder (list below). Delete the browser-tester pieces if there is no UI.
3. Make sure the repo has: a test command that exits non-zero on failure, a `docs/specs/` folder and a `tests/` folder (or change the paths in the designer's rules), and a CI job that runs the tests on every push.
4. Start a NEW session in the repo (agents and skills only load at session start). If an agent is not found, the skill says how to use a `general-purpose` stand-in.
5. Ask for a first small feature and read the hand-over table: if a row says "not run", that is the gap to close.

## Placeholders
| Placeholder | Meaning | Macro Diary value |
|---|---|---|
| `{{PROJECT}}` | project name | Macro Diary |
| `{{TEST_CMD}}` | one command that runs all unit tests | `npm test` |
| `{{SPEC_DIR}}` / `{{TEST_DIR}}` | where specs and tests live | `docs/specs` / `tests` |
| `{{SOURCE_DIRS}}` | code the test-designer must never edit | `js/, css/, sw.js, index.html` |
| `{{LAYER_RULES}}` | the dependency rule between layers, one line each | domain is pure; services never import ui; ... |
| `{{ESCAPING_RULE}}` | how external text must reach output | every string from a database or file goes through `esc()` before HTML |
| `{{SHIPPING_CHECKS}}` | the checklist for a shippable change | new file listed in the service-worker `SHELL`, cache bumped, saved-shape change has a version bump + migration + test |
| `{{DOCS_TO_UPDATE}}` | docs updated in the same PR | `DECISIONS`, `KNOWN-ISSUES`, `ROADMAP` |
| `{{UI_TEST_RUNNER}}` | headless runner command and folder | `node tools/browser-test/run.mjs`, `tools/browser-test/` |
| `{{OWNER}}` | who merges | the owner |
| `{{DEPLOY_NOTE}}` | what is needed after a merge before testing live | a deploy and a service-worker refresh |
| `{{MAIN}}` | the default branch | `main` |

## Lessons baked in (each cost real time)
- The designer lists the OLD tests and scenarios the feature will break, up front.
- Designer test edits go in their own commit, so git shows who changed what.
- Fake keys and IDs must not look real (push protection blocks the push).
- Source-text tests read code, not comments; every spec example is checked against the spec's own rule; no shared counters across awaits.
- The reviewer diffs against `origin/main`, never a stale local main.
- Reviewer and browser-tester run at the same time, are time-boxed, and re-runs cover only what the fixes touched.
- Known failing scenarios live in a file, not in every report.
- The hand-over table has an "owner actions" row (merge, outside settings, deploy/refresh, real-device checks).

## Things deliberately not in the template
Refactor-only agents (a module extractor and a regression reviewer) were used once to split a single-file app into modules. They need a legacy baseline and golden files; add them back only for a similar migration.
