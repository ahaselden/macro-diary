# Spec: nutrition-label photo, camera or upload

## Purpose
In Add food > Custom, the single "Read a nutrition label from a photo" button is replaced by two buttons: "Take a photo" (opens the camera on phones/tablets) and "Choose an image" (gallery/files). Both feed the existing label reader, which fills the form (unchanged).

Provenance: written AFTER the implementation existed (not red-first). The author deliberately did not read `js/ui/custom-food.js`; expectations come from the plan only, but the separation is weaker than normal.

## Contract (UI only; no domain/service change)
| Id | Element | Requirement |
|---|---|---|
| `cCam` | `<button>` "Take a photo" | triggers `cFileCam` |
| `cPick` | `<button>` "Choose an image" | triggers `cFile` |
| `cFileCam` | hidden `<input type=file accept="image/*" capture="environment">` | camera on mobile; picker on desktop (capture ignored) |
| `cFile` | hidden `<input type=file accept="image/*">` | must NOT have `capture` |
| `cLabel` | old button | must no longer exist |
| `sw.js` | `const CACHE = 'macro-diary-vNN'` | bumped to v18 (was v17) |

## Behaviours
1. `#cFileCam` exists exactly once: file input, `accept="image/*"`, `capture="environment"`.
2. `#cFile` exists exactly once: file input, `accept="image/*"`, no `capture` attribute.
3. Both inputs are hidden from view.
4. `#cCam` ("Take a photo") and `#cPick` ("Choose an image") exist once each, as buttons, side by side.
5. No element with id `cLabel` remains.
6. The old label text "Read a nutrition label from a photo" no longer ships.
7. Service worker `CACHE` is `macro-diary-v18` or later.
8. Ids are not duplicated (a duplicate id would make `getElementById` pick the wrong input).
9. (manual) Choosing a file in either input clears that input's value, then reads the photo; choosing the same photo twice works.
10. (manual) While reading, BOTH buttons are disabled; afterwards both are re-enabled, also after an error.
11. (manual) A photo over 25 MB is refused with a message and neither button stays disabled.
12. (manual) Both inputs feed the same reader and fill the form as before.

Automated: 1-8 (`tests/label-camera-or-upload.test.js`). Manual: 9-12 and the real-device camera behaviour.

## How weak the automated tests are
They are regex checks over the shipped source text. They show that the markup strings, ids, attributes and cache version are present. They do NOT show that the click handlers are wired, that the right input is triggered, that values are cleared, that buttons disable/re-enable, that the 25 MB limit works, or that the camera opens. Tag matching works on any opening tag in `js/`, `css/` (excl. `vendor/`) and `index.html`, so markup inside a JS template string counts. Test 5 only checks for an element id; a leftover `cLabel` in a comment/variable is not caught. Test 3 accepts `hidden`, inline `display:none` or a `hidden` class and cannot verify the CSS actually hides it. Not attempted: a hand-written fake DOM, because it would have to mimic the module's internals and would mostly test the fake.

## Edge cases and hostile input
- Duplicate ids or a `capture` attribute accidentally copied onto `cFile` (would remove the gallery option on phones): covered by 2 and 8.
- Non-image files, 0-byte files, huge files, corrupt images, user cancelling the chooser: manual (error path must re-enable both buttons).
- Text from the label is escaped by the existing reader (unchanged; not in scope).

## Manual checklist (real devices)
- [ ] Android Chrome: "Take a photo" opens the camera (rear); "Choose an image" opens gallery/files, not the camera.
- [ ] iPhone Safari (and installed PWA): "Take a photo" offers camera; "Choose an image" offers Photo Library/Files. iOS behaviour for `capture` may differ.
- [ ] Desktop browser: both buttons open the normal file picker.
- [ ] Pick the same photo twice in a row via each button: it is read both times.
- [ ] During a read both buttons are disabled; both enabled after success.
- [ ] Force an error (e.g. a non-label image or unreadable file): both enabled afterwards.
- [ ] A file over 25 MB: message shown, buttons usable.
- [ ] After the update, the phone picks up v18 (reload twice) and shows two buttons side by side at narrow width.

## Open questions
- Exact "side by side" layout (CSS) is untested; no testable contract was given.
- Whether the 25 MB message wording is fixed: not specified, so not asserted.
