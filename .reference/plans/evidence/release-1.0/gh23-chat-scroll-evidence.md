# GH23 — chat scrolling ("gimpy", stuck when scrolling into history)

> Status: **verified** (2026-10-22)

Issue: <https://github.com/robjvan/icos/issues/23> — *"Scrolling web chat UI is
gimpy"*: the transcript gets stuck and refuses to scroll up into history.

## What was actually wrong

Three defects in the auto-stick logic, all in
`web-client/src/app/components/chat-ui-component/`:

1. **Distance, not direction.** The pin was released only when more than
   **48 px** from the bottom. A trackpad gesture moves 10–20 px per event, so
   the reader could never get far enough to unpin before the next tick put them
   back at the bottom — the "stuck" feeling.
2. **Wrong trigger.** Auto-scroll ran in `ngAfterViewChecked`. In a zoneless
   OnPush tree that hook is **not emitted for the committed-message render**
   (confirmed with an instrumented build: the token/user-message renders fired
   it, the result render did not), so the view silently stopped following the
   turn and settled a result-message short of the bottom — measured live at a
   **279.5 px gap** after every command turn.
3. **Our own scroll event released the pin.** The bottom write fires a `scroll`
   event at frame time. By then the turn had grown, so the handler judged
   "279 px from the bottom" and treated it as the reader scrolling away.

A fourth, smaller issue: `.messages` was a second scroll container inside
`.scroll-host`, which traps wheel/trackpad chaining.

## What changed

- `pinnedToBottom` is a signal. **Any upward movement releases it**, however
  small; coming back within 8 px of the bottom re-arms it.
- **Upward intent is read synchronously** from `wheel` and `touchmove`, before a
  token-triggered render can re-stick the view (scroll events arrive at frame
  time — too late).
- Auto-scroll moved to **`afterRenderEffect`**, keyed to `messages`,
  `pendingText`, and `pendingTyping` (the signals that change the transcript's
  height), and only writes when the scrollport geometry actually changed.
- **Our own write is not user intent**: its scroll event is ignored unless the
  reader has moved since (`readerMovedSinceWrite`).
- Session open / new / send re-anchor to the live edge (acting is an explicit
  "take me to the newest message").
- **"Jump to latest"** pill when unpinned; click returns to the bottom and
  resumes following.
- `.messages` no longer scrolls; the transcript region is keyboard-focusable
  (`tabindex="0"`, visible focus ring) so PageUp/Home work and AXE's
  scrollable-region rule holds.

## Verification

**Unit** — `web-client`, `ng test`:

- `chat-ui-component.spec.ts`: **15 tests** (11 new), all green. The new ones
  fail on the old implementation:
  - trackpad-sized 15 px upward scroll releases the pin and the view is left
    alone while the turn grows;
  - returning to the bottom re-arms, and following resumes;
  - upward wheel intent releases *before* any scroll event;
  - downward wheel keeps following;
  - touch drag into history releases;
  - jump-to-latest returns and resumes;
  - our own late scroll event does not release the pin;
  - an unchanged transcript is not re-written;
  - open/new/send re-anchor; the region is keyboard-scrollable.

  The fake scrollport clamps `scrollTop` to `scrollHeight - clientHeight`, as a
  browser does — without that clamp the late-event race cannot be reproduced.

- Suite: **52 files, 219 tests passed** (was 208). `npm run lint` clean,
  `npm run build` clean.

**Live run** — `docker compose up` (core + web client), real Chromium against
`http://localhost:4200`, transcript built from `/health` command turns
(no model needed; the configured provider returns an invalid completion today,
see below):

| Check | Result |
| --- | --- |
| Gap to bottom after each turn, 7 turns | **0 px every time** (was 279.5 px) |
| 15 px upward nudge mid-turn, result renders | scrollTop **2399 constant** across 12 samples; not yanked to 2693 |
| `Jump to latest` visible while unpinned | yes (screenshot) |
| Click `Jump to latest` | scrollTop 2694 / max 2693, pill gone |
| Next turn after re-arming | gap **0 px**, following resumed |

Screenshots: `gh23-scroll-unpinned.png` (unpinned, pill visible, newest result
cut off below).

## Honest remainder

- The live transcript was built with deterministic `/health` turns because the
  configured provider (`opencode` / `deepseek-v4.1-flash`) answered
  `LLM endpoint returned an invalid completion`. Token-by-token streaming was
  therefore **not** exercised live; it is covered by the unit tests, which drive
  the same signals (`pendingText` appended per token) through real
  change-detection and the real after-render pass.
- The live wheel gesture was a synthetic `WheelEvent` plus a real `scrollTop`
  change (the harness has no trusted trackpad input). The scroll position,
  clamping, and render timing were the browser's own.
- Mobile momentum scrolling was not exercised on a device; the touch path is
  covered by unit tests only.
