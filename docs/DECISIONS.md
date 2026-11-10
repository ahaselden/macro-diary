# Decisions log

Short records of non-obvious choices and **why**, in the order they were made. Anything marked **(made without the owner)** was decided while the owner was away and is the first thing to review or overrule. Format: context → decision → consequences.

---

## D1. Vanilla ES modules, no framework, no bundler
**Context:** The app was one 727-line HTML file; a meal planner is coming. **Decision:** split into native ES modules served as-is (no build step, no dependencies). **Why:** the app is small; a bundler/framework adds tooling, upgrade chores and a build in CI for little gain, and GitHub Pages serves static files fine. **Consequences:** `index.html` no longer works from `file://` (browsers block module loading) — use `npm start`. Revisit (Vite + TypeScript) if the UI layer grows past what hand-written render functions handle comfortably.

## D2. Strict layers: `ui → services → domain → core`
**Decision:** `core/` has no dependencies; `domain/` is pure logic that may import only `core/` (constants, format, dates) and itself; `services/` talks to the outside world and may import `domain/` and `core/`; `ui/` is the only layer that touches the DOM. **Why:** pure `domain/` code is trivially unit-testable in Node and reusable by features that don't exist yet (recipes and shopping lists reuse the units/density logic). Violations are checked in review (`.claude/agents/regression-reviewer.md`).

## D3. Golden-file tests captured from the original app
**Decision:** before moving any code, the *old* code was run in a browser against a deterministic fixture (`tests/fixtures/`) and its outputs saved (`tests/golden/`). New modules must reproduce them exactly. **Why:** a refactor's main risk is silently changing behaviour; the old code is the best specification we have, and capturing it mechanically beats re-deriving expectations by hand. **Consequences:** `tests/golden/reports.json` is large (~700 KB) because it holds full CSV outputs; acceptable for a byte-exact check. If behaviour is *intentionally* changed later, regenerate the affected golden file in the same commit and say why.

## D4. Application state is one mutable object (`state`), replaced via `replace()`
**Decision:** `core/store.js` exports a single `state` object that is mutated in place; whole-state swaps (restore/wipe) go through `replace()`, which keeps the same object identity. **Why:** every module can hold a reference without stale-copy bugs, and there is exactly one place that touches `localStorage`. `createStore(storage)` takes the storage as a parameter so tests use a fake.

## D5. Storage key stays `macrodiary.v1`; shape changes are versioned
**Decision:** the key never changes. A `schemaVersion` field plus `migrate()` handle shape changes. **Why:** the key is where existing users' phones/PCs keep their diary; changing it would orphan their data. Old data without `schemaVersion` is treated as v1 and stamped.

## D6. Domain functions return new state instead of mutating (`mergeBackup`)
**Decision:** `mergeBackup(state, backup)` returns a new object; the caller `replace()`s and saves. **Why:** pure functions are easier to test and reason about, and the caller decides when to persist.

## D7. Agents extract modules in parallel but only create *new* files
**Decision:** each extraction agent wrote only its own new module and test; the main session did all edits to `index.html`. **Why:** no merge conflicts, and the single integration point stays under one owner. Each agent's report was verified by re-running the whole suite and grepping the layer rule, not taken on trust.

## D8. Bugs found during a refactor are logged, not fixed
Reported by extraction agents/reviewer and kept as-is so behaviour stays identical; collected in `docs/KNOWN-ISSUES.md` for deliberate fixing later.
