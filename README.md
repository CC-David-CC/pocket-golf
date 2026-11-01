# Pocket Golf

Pocket Golf is a six-hole Babylon.js miniature-golf preview. It uses Havok's
web runtime for the tabletop course, renders the game without an external
asset service, and saves checkpoints through the signed-in desktop's **My
files** storage.

## Controls

- Choose a hole or the practice green.
- Choose **Start / resume**, then drag on the course to aim and release.
- **Aim left**, **Aim right**, the power slider and **Putt** provide
  keyboard, touch and assistive alternatives to dragging.
- **Cancel aim** clears a pointer gesture without launching.
- **Reset lie** restores the last safe lie and adds a one-stroke penalty.
- Press Escape to pause; focus loss, minimizing, workspace changes, roll-up
  and browser visibility changes also pause play.
- **Enter XR** probes immersive VR/AR support when the browser exposes WebXR.

## Save behavior

Checkpoints are `.game.json` files with app ID `pocket-golf`. When the ball is
settled, Save records the current lie. If Save is selected during a roll, it
writes the last settled checkpoint and says that the current roll was not
included. Loading restores the round paused.

The current preview uses a clearly labeled procedural caddie and score stand.
`golf-scoreboard.riv` remains an acceptance-gated asset. Physical-phone input,
real Havok tuning beyond the bounded test course, a complete visual polish
pass and Galaxy XR hardware verification remain open.

## Development

```sh
npm ci --prefix apps/system/pocket-golf --ignore-scripts
npm run typecheck --prefix apps/system/pocket-golf
npm test --prefix apps/system/pocket-golf
```

Build a standalone fixture bundle from the repository root:

```sh
python3 active-system/scripts/build-public-apps.py --output .build/pocket-golf --apps pocket-golf
CODI_POCKET_GOLF_MANIFEST=.build/pocket-golf/apps.json python3 tests/prepare-pocket-golf-harness.py
python3 -m http.server 18320 --bind 127.0.0.1 --directory .build/pocket-golf
node tests/pocket-golf-browser.test.mjs
CODI_PHONE=1 node tests/pocket-golf-browser.test.mjs
```

The registered-account test must run against a preview bundle that includes
Files and a parent integration branch that registers the `pocket-golf` app ID.
