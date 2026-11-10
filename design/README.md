> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Pocket Golf

**3D miniature golf · Babylon.js · single-player · phone required · immersive XR required**

> Planned design, not implemented or browser-tested. `index.pseudo.mjs` is an explanatory entry point, not a playable game.

## Experience

Play six compact holes with a clear aim guide, a readable power meter and physically simulated rolling balls.

## What this demonstrates

- Babylon physics plugin integration
- PBR materials and readable shadows
- Ray-to-surface aiming and in-world controls

## Rules and complete loop

- Ball must settle before next stroke. Drag defines bounded aim/power; release commits one stroke.
- Hole capture requires position and speed conditions. Out-of-bounds restores last safe lie with a declared penalty.
- Use Babylon Havok for this app only. Bind one stepping owner and qualify solver settings; do not run Rapier alongside it.

## Bounded polished release

Six handcrafted holes, one practice green and per-hole pars. No online leaderboard.

- Aim guide fades during motion
- Scoring based on actual physics conditions
- Nice feedback without screen flash; pause before file actions

No multiplayer, accounts, server simulation or generic editor is required. Start, rules/help, play/activity, pause, outcome/goal feedback and retry must all be complete. Settings include volume/mute, reduced motion, contrast and game-specific options where meaningful. State changes occur in the game model; animations illustrate them.

## Rive inside this app

Power meter, hole card and animated caddie on a world-space score stand. The requested asset is `golf-scoreboard.riv`; it is **not included**. See [RIVE.md](RIVE.md) for the authoring/integration contract. A placeholder or unrelated animated logo does not satisfy this requirement.

## Save behavior

Checkpoint save at settled lie or completed hole. During roll, Save offers the last stable checkpoint and labels it; XR transitions still preserve live physics. See [SAVE.md](SAVE.md). Loading starts paused; resume is explicit. Entering/exiting XR preserves the live current state even when exported saves are checkpoints.

## Build sequence

Implement the rule loop in [gameplay.pseudo.txt](gameplay.pseudo.txt); bind the exact app lifecycle from [index.pseudo.mjs](index.pseudo.mjs); complete [CONTROLS.md](CONTROLS.md); author/integrate [RIVE.md](RIVE.md); then satisfy [ACCEPTANCE.md](ACCEPTANCE.md). The full XR flow and game-specific presentation are in [XR.md](XR.md).

Target wave: **3**. Integrator first reads [AGENTS.md](../../../../../docs/games/design-reference/ORIGINAL-INSTRUCTIONS.md); do not guess host APIs from symbolic helper names.

Havok integration is a review gate: the web runtime is distributed under MIT, but this is not a claim that the full Havok engine source is public. See source/licensing notes.
