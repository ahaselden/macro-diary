---
name: ship-feature
description: The Macro Diary feature workflow. Use for any new feature or non-trivial change - a separate test-designer agent writes the spec and failing tests first, you implement to green, push the feature branch, open a PR, then a separate pr-reviewer agent reviews it. Never merges.
---

# Ship a feature (Macro Diary)

Roles are kept separate on purpose: the **test-designer** defines "done", **you** implement, the **pr-reviewer** judges. You may not edit the designer's tests to make them pass.

**No self-exemptions.** Small, UI-only or "obvious" changes follow every step too. What shrinks is the size of the spec (a few behaviours plus a manual checklist is enough, and static or source-text tests are acceptable when the project has no way to test the behaviour, if the spec says how weak they are), never whether the steps happen. Only the owner can waive a step, in the chat, for that change. If you skipped a step by mistake, say so and retrofit it (spec/tests written afterwards by a separate agent, verified to fail against the old code) rather than hiding it.

**Agents not registered?** New files in `.claude/agents/` only load when a session starts. If `test-designer` or `pr-reviewer` is not found, run a `general-purpose` agent with the instructions "read `.claude/agents/<name>.md` and follow it exactly", restate its limits (test-designer: may not read the implementation, may write only `docs/specs/` and `tests/`; reviewer: read-only), and say in the PR that a stand-in was used.

**State what ran.** Every PR body lists which steps ran (spec first or retrofitted, designer tests, review, browser test) and which did not, and why.

1. **Plan.** Write a short plan (what, why, layers touched, UI or not). For anything user-visible or design-heavy, show it to the owner first. Create `feature/<short-name>` from `main` (or from the current feature branch if the work builds on it).
2. **Spec and tests first.** Spawn the `test-designer` agent (fresh context, not a fork) with the plan. It writes `docs/specs/<name>.md` and failing tests under `tests/` only. Confirm yourself with `npm test` that the new tests fail for the right reason. Commit as its own commit: `Spec and failing tests for <name>`. Note the commit hash.
3. **Implement to green.** Implement in the right layers, in small commits (pure logic first). Do not edit those tests. If a test is wrong, say so in the PR description and send the question back to the test-designer (SendMessage) rather than fixing it yourself. Tests you add later are fine; say so in the commit message.
4. **Verify.** `npm test` all green. For UI changes a quick look that the page runs is enough here; the full browser test is step 7, after the review, so it only runs once. Update `sw.js` (SHELL and CACHE), `docs/DECISIONS.md`, `docs/KNOWN-ISSUES.md`, and the spec's manual checklist. State what you could not verify.
5. **Push and open the PR** (the owner authorised this; see CLAUDE.md): `git push -u origin feature/<name>`, then `gh pr create --base main --head feature/<name> --title ... --body ...` (gh is at `C:\Program Files\GitHub CLI\gh.exe` if not on PATH). The body has: what and why, a link to the spec, a test summary (counts, which came from the designer), changes to designer tests (should be "none"), and what is unverified. **Never** merge, never push `main`, never force-push, and add no `Co-Authored-By` or "Generated with" lines.
6. **Review.** Spawn the `pr-reviewer` agent on the branch with the spec path. Post its report on the PR with `gh pr comment <n> --body-file <file>`. Fix blocking findings in new commits, push, and ask for one re-review.
7. **Browser test, once, after the review.** When the change is user-visible and the review fixes are done (so major fixes never cause repeated browser runs), run the `browser-tester` agent (headless Edge or Chrome via `tools/browser-test`, see its README; use a `general-purpose` stand-in with the same instructions if it is not registered yet). It runs the spec's manual checklist with the network stubbed and reports PASS, FAIL or NOT TRIED per item. Post its report on the PR with `gh pr comment`. A failure is fixed in new commits, pushed, and only the failed items are re-run. It cannot cover a real phone, camera, wake lock, installing the app, iPhone Safari or real food-database data: list those as unverified.
8. **Hand over, with the same report every time.** Tell the owner the PR link, then this short table in plain words, one line per row, saying "not run" or "stand-in" honestly. Post the same table on the PR as a comment, then stop: the owner merges.
   - **Spec and failing tests first:** who wrote them, and how many failed before the code.
   - **Implementation:** tests passing (count); designer tests changed (should be none).
   - **Review:** who ran it, the verdict, what was fixed, what was left.
   - **Browser test:** when it ran (before the PR, during the review, after the review), what ran it (the `browser-tester` agent, a stand-in, or the implementer directly), the commit it ran on, and PASS or FAIL per scenario. If it only ran before the review, say so and run it again after the fixes.
   - **Not verified:** the real-phone, real-data and other gaps.

If a push or `gh` call is blocked by permissions, do not work around it: give the owner the exact command to run.
