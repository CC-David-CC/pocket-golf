# Acceptance — Pocket Golf

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../docs/ACCEPTANCE-COMMON.md). Also apply X01–X16 on the actual Galaxy XR.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| pocket-golf-G01 | Repeated release creates one impulse/stroke. | not_run |
| pocket-golf-G02 | Hole capture rejects high-speed grazing. | not_run |
| pocket-golf-G03 | One owner steps physics; 60/90 Hz presentation does not double speed. | not_run |
| pocket-golf-G04 | Save while rolling reports checkpoint semantics accurately. | not_run |
| pocket-golf-G05 | Phone cancel does not launch. | not_run |
| pocket-golf-G06 | XR scale does not alter selected putt energy in model coordinates. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
