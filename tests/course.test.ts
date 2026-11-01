import {describe, expect, it} from "vitest";
import {
  CheckpointError,
  HOLES,
  PocketGolfSession,
  decodeCheckpoint,
  encodeCheckpoint,
} from "../src/model/golf.js";

function activeHole(index = 0): PocketGolfSession {
  const session = new PocketGolfSession("test");
  session.selectHole(index);
  session.resume();
  return session;
}

describe("Pocket Golf checkpoint rules", () => {
  it("commits one bounded stroke and requires a settled lie before another", () => {
    const session = activeHole();
    const velocity = session.commitPutt({x: 0, z: 2}, 0.5);
    expect(Math.hypot(velocity.x, velocity.z)).toBeCloseTo(6.6, 5);
    expect(session.strokes[0]).toBe(1);
    expect(session.rolling).toBe(true);
    expect(() => session.commitPutt({x: 0, z: 1}, 1)).toThrow(CheckpointError);
  });

  it("captures only a sufficiently slow ball inside the cup", () => {
    const session = activeHole();
    session.commitPutt({x: 0, z: 1}, 0.4);
    expect(session.observe({x: HOLES[0].cup.x, z: HOLES[0].cup.z}, 3)).toBe("rolling");
    expect(session.observe({x: HOLES[0].cup.x, z: HOLES[0].cup.z}, 0.7)).toBe("captured");
    expect(session.complete).toBe(true);
    expect(session.completed[0]).toBe(1);
  });

  it("updates the safe lie only after motion settles", () => {
    const session = activeHole();
    session.commitPutt({x: 0, z: 1}, 0.4);
    expect(session.checkpointForSave().checkpoint.ball).toEqual(HOLES[0].tee);
    session.observe({x: 1, z: 4}, 0.04);
    expect(session.checkpointForSave().usedLastStable).toBe(false);
    expect(session.lastSafe).toEqual({x: 1, z: 4});
  });

  it("uses and labels the last stable checkpoint while rolling", () => {
    const session = activeHole();
    session.commitPutt({x: 0, z: 1}, 0.8);
    session.observe({x: 0.4, z: 2}, 1.8);
    const result = session.checkpointForSave();
    expect(result.usedLastStable).toBe(true);
    expect(result.checkpoint.ball).toEqual(HOLES[0].tee);
    expect(result.checkpoint.strokes[0]).toBe(0);
    const encoded = encodeCheckpoint(session);
    expect(decodeCheckpoint(encoded).ball).toEqual(HOLES[0].tee);
    expect(decodeCheckpoint(encoded).strokes[0]).toBe(0);
  });

  it("restores the last safe lie with a penalty after an out-of-bounds roll", () => {
    const session = activeHole();
    session.commitPutt({x: 0, z: 1}, 0.8);
    expect(session.observe({x: 99, z: 99}, 2)).toBe("out");
    expect(session.ball).toEqual(HOLES[0].tee);
    expect(session.strokes[0]).toBe(2);
    expect(session.paused).toBe(true);
  });

  it("validates save envelopes and bounded scorecards", () => {
    const session = activeHole(5);
    session.settings.highContrast = true;
    session.commitPutt({x: 0, z: 1}, 0.4);
    session.observe({x: HOLES[5].cup.x, z: HOLES[5].cup.z}, 0.2);
    const restored = new PocketGolfSession();
    restored.applyCheckpoint(decodeCheckpoint(encodeCheckpoint(session)));
    expect(restored.hole.id).toBe(6);
    expect(restored.complete).toBe(true);
    expect(restored.settings.highContrast).toBe(true);
    expect(() => decodeCheckpoint('{"format":"wrong"}')).toThrow(CheckpointError);
  });
});
