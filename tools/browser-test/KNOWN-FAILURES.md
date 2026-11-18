# Known headless failures on main

Scenarios that fail on `main` WITHOUT any change under test. The browser-tester reports them as "known, not caused by this change" and does not investigate them. When one is fixed, delete its line in the same PR. Last confirmed: 2026-11-18 (origin/main c7557cf).

| Scenario | Check | What happens |
|---|---|---|
| `settings-tab-with-export.mjs` | C14 | a `waitForFunction` times out after 5000 ms |
| `export-one-card.mjs` | C5 | "weekly days 1" assertion fails |

Both are logged here instead of being fixed in the feature PRs they showed up in. Fixing them is its own small piece of work (a spec'd change to the scenarios, no app change expected).

## Added 2026-11-18 (confirmed on origin/main cdbcc23 by running each scenario alone, twice)
| Scenario | Check | What happens |
|---|---|---|
| `google-health-seamless.mjs` | after C23 | the runner process dies (exit 1) with an unhandled `TargetClosedError` from playwright-core (`crPage.js` dispose rejecting a pending navigation) AFTER all 24 checks have printed PASS; no summary line is printed |
| `google-health-sync.mjs` | after the last check | the same crash after 21 PASS lines |

Likely cause (not investigated): a navigation still in flight when the scenario's context closes, with nothing catching the rejection in the runner. The crash also stops the whole-suite summary line ("N passed, M failed"), so read the PASS/FAIL lines instead. `export-one-card` C5 passed in the 2026-11-18 run, so it may be flaky rather than failing; keep it listed until it passes several runs in a row.
