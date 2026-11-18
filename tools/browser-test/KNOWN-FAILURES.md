# Known headless failures on main

Scenarios that fail on `main` WITHOUT any change under test. The browser-tester reports them as "known, not caused by this change" and does not investigate them. When one is fixed, delete its line in the same PR. Last confirmed: 2026-11-18 (origin/main c7557cf).

| Scenario | Check | What happens |
|---|---|---|
| `settings-tab-with-export.mjs` | C14 | a `waitForFunction` times out after 5000 ms |
| `export-one-card.mjs` | C5 | "weekly days 1" assertion fails |

Both are logged here instead of being fixed in the feature PRs they showed up in. Fixing them is its own small piece of work (a spec'd change to the scenarios, no app change expected).
