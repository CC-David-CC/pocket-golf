export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "pocket-golf";
export const SAVE_KIND = "pocket-golf-checkpoint/1";
export const CONTENT_VERSION = "1";

export interface Vec2 {
  x: number;
  z: number;
}

export interface GolfObstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

export interface GolfHole {
  id: number;
  name: string;
  par: number;
  tee: Vec2;
  cup: Vec2;
  bounds: {minX: number; maxX: number; minZ: number; maxZ: number};
  obstacles: GolfObstacle[];
}

export const PRACTICE_HOLE: GolfHole = {
  id: 0,
  name: "Practice green",
  par: 0,
  tee: {x: 0, z: 0},
  cup: {x: 0, z: 7},
  bounds: {minX: -4, maxX: 4, minZ: -2, maxZ: 10},
  obstacles: [],
};

export const HOLES: GolfHole[] = [
  {id: 1, name: "Mossy Start", par: 2, tee: {x: 0, z: -2}, cup: {x: 0, z: 8}, bounds: {minX: -3, maxX: 3, minZ: -3, maxZ: 10}, obstacles: [{x: 1.4, z: 4.5, width: 1.1, depth: 0.7, height: 0.45}]},
  {id: 2, name: "Lantern Bend", par: 3, tee: {x: -1.8, z: -2}, cup: {x: 2.2, z: 8.5}, bounds: {minX: -3, maxX: 3.2, minZ: -3, maxZ: 10.5}, obstacles: [{x: 0, z: 3.3, width: 2.8, depth: 0.55, height: 0.55}]},
  {id: 3, name: "Garden Gate", par: 3, tee: {x: 0, z: -2}, cup: {x: -1.7, z: 9}, bounds: {minX: -3.2, maxX: 3.2, minZ: -3, maxZ: 11}, obstacles: [{x: -1.2, z: 2.8, width: 0.5, depth: 2.5, height: 0.55}, {x: 1.4, z: 6.4, width: 2.1, depth: 0.5, height: 0.55}]},
  {id: 4, name: "Clockwork Hills", par: 4, tee: {x: 0, z: -2.5}, cup: {x: 2, z: 10}, bounds: {minX: -3.5, maxX: 3.5, minZ: -3.5, maxZ: 12}, obstacles: [{x: -1.2, z: 2.2, width: 1.4, depth: 0.6, height: 0.35}, {x: 1.3, z: 4.7, width: 1.7, depth: 0.6, height: 0.6}, {x: -0.4, z: 7.3, width: 1.1, depth: 0.55, height: 0.45}]},
  {id: 5, name: "Twin Walls", par: 4, tee: {x: 2.2, z: -2}, cup: {x: -2.2, z: 10}, bounds: {minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 12}, obstacles: [{x: -1.3, z: 3, width: 0.55, depth: 3.5, height: 0.6}, {x: 1.3, z: 6.8, width: 0.55, depth: 3.5, height: 0.6}]},
  {id: 6, name: "Orbital Green", par: 5, tee: {x: 0, z: -3}, cup: {x: 0, z: 12}, bounds: {minX: -4, maxX: 4, minZ: -4, maxZ: 14}, obstacles: [{x: -1.8, z: 2.3, width: 1.8, depth: 0.55, height: 0.5}, {x: 1.8, z: 5.2, width: 1.8, depth: 0.55, height: 0.5}, {x: -1.4, z: 8.1, width: 1.5, depth: 0.55, height: 0.5}, {x: 1.4, z: 10.5, width: 1.5, depth: 0.55, height: 0.5}]},
];

export interface GolfSettings {
  sound: boolean;
  volume: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export interface Checkpoint {
  mode: "holes" | "practice";
  holeIndex: number;
  strokes: number[];
  completed: Array<number | null>;
  ball: Vec2;
  lastSafe: Vec2;
  paused: boolean;
  finished: boolean;
  settings: GolfSettings;
}

export class CheckpointError extends Error {}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bounded = (value: unknown, min: number, max: number): value is number => finite(value) && value >= min && value <= max;
const point = (value: unknown): value is Vec2 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return bounded(item.x, -100, 100) && bounded(item.z, -100, 100);
};
const clonePoint = (v: Vec2): Vec2 => ({x: v.x, z: v.z});

export function clampPower(value: number): number {
  return finite(value) ? Math.max(0.05, Math.min(1, value)) : 0.05;
}

export function normalizedAim(x: number, z: number): Vec2 {
  if (!finite(x) || !finite(z)) throw new CheckpointError("Aim must be finite");
  const length = Math.hypot(x, z);
  if (length < 0.0001) throw new CheckpointError("Aim must have a direction");
  return {x: x / length, z: z / length};
}

export class PocketGolfSession {
  mode: "holes" | "practice" = "holes";
  holeIndex = 0;
  strokes = Array<number>(HOLES.length).fill(0);
  completed = Array<number | null>(HOLES.length).fill(null);
  ball: Vec2;
  lastSafe: Vec2;
  paused = true;
  rolling = false;
  complete = false;
  finished = false;
  settings: GolfSettings = {sound: false, volume: 0.35, reducedMotion: false, highContrast: false};
  private expectedVelocity: Vec2 | null = null;

  constructor(seed = "practice") {
    const safe = typeof seed === "string" && seed.length > 0 ? seed : "practice";
    this.hole = HOLES[(hash32(safe) % HOLES.length)];
    this.ball = {x: this.hole.tee.x, z: this.hole.tee.z};
    this.lastSafe = clonePoint(this.ball);
  }

  get hole(): GolfHole {
    return this.mode === "practice" ? PRACTICE_HOLE : HOLES[this.holeIndex];
  }

  set hole(value: GolfHole) {
    if (value.id === 0) {
      this.mode = "practice";
      this.holeIndex = 0;
    } else {
      this.mode = "holes";
      this.holeIndex = Math.max(0, Math.min(HOLES.length - 1, value.id - 1));
    }
  }

  get score(): number {
    return this.completed.reduce<number>((total, value) => total + (value ?? 0), 0);
  }

  selectHole(index: number | "practice"): void {
    if (this.rolling) throw new CheckpointError("Wait for the ball to settle");
    if (index === "practice") this.mode = "practice";
    else {
      if (!Number.isInteger(index) || index < 0 || index >= HOLES.length) throw new CheckpointError("Invalid hole");
      this.mode = "holes";
      this.holeIndex = index;
    }
    this.complete = false;
    this.finished = false;
    this.ball = clonePoint(this.hole.tee);
    this.lastSafe = clonePoint(this.ball);
    this.paused = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.complete) this.paused = false;
  }

  commitPutt(direction: Vec2, power: number): Vec2 {
    if (this.paused || this.rolling || this.complete || this.finished) throw new CheckpointError("Ball is not ready");
    const aim = normalizedAim(direction.x, direction.z);
    const strength = 2.2 + clampPower(power) * 8.8;
    this.strokes[this.mode === "holes" ? this.holeIndex : 0] += this.mode === "holes" ? 1 : 0;
    this.rolling = true;
    this.paused = false;
    this.expectedVelocity = {x: aim.x * strength, z: aim.z * strength};
    return clonePoint(this.expectedVelocity);
  }

  observe(position: Vec2, speed: number, y = 0.25): "rolling" | "settled" | "captured" | "out" {
    if (!this.rolling || this.complete) return this.rolling ? "rolling" : "settled";
    if (!point(position) || !bounded(speed, 0, 40)) throw new CheckpointError("Invalid physics observation");
    this.ball = clonePoint(position);
    if (y < -2 || position.x < this.hole.bounds.minX - 1 || position.x > this.hole.bounds.maxX + 1 || position.z < this.hole.bounds.minZ - 1 || position.z > this.hole.bounds.maxZ + 1) {
      this.failBounds();
      return "out";
    }
    if (Math.hypot(position.x - this.hole.cup.x, position.z - this.hole.cup.z) <= 0.3 && speed <= 1.2) {
      this.captureHole();
      return "captured";
    }
    if (speed <= 0.06) {
      this.lastSafe = clonePoint(position);
      this.ball = clonePoint(position);
      this.rolling = false;
      this.paused = true;
      this.expectedVelocity = null;
      return "settled";
    }
    return "rolling";
  }

  resetLie(): void {
    if (this.mode === "holes") this.strokes[this.holeIndex]++;
    this.rolling = false;
    this.paused = true;
    this.expectedVelocity = null;
    this.ball = clonePoint(this.lastSafe);
  }

  nextHole(): boolean {
    if (!this.complete || this.mode === "practice") return false;
    if (this.holeIndex >= HOLES.length - 1) {
      this.finished = true;
      this.paused = true;
      return false;
    }
    this.selectHole(this.holeIndex + 1);
    return true;
  }

  checkpointForSave(): {checkpoint: Checkpoint; usedLastStable: boolean} {
    const usedLastStable = this.rolling;
    const strokes = [...this.strokes];
    if (usedLastStable && this.mode === "holes") {
      strokes[this.holeIndex] = Math.max(0, strokes[this.holeIndex] - 1);
    }
    return {
      usedLastStable,
      checkpoint: {
        mode: this.mode,
        holeIndex: this.holeIndex,
        strokes,
        completed: [...this.completed],
        ball: clonePoint(usedLastStable ? this.lastSafe : this.ball),
        lastSafe: clonePoint(this.lastSafe),
        paused: true,
        finished: this.finished,
        settings: {...this.settings},
      },
    };
  }

  applyCheckpoint(value: Checkpoint): void {
    validateCheckpoint(value);
    this.mode = value.mode;
    this.holeIndex = value.holeIndex;
    this.strokes = [...value.strokes];
    this.completed = [...value.completed];
    this.ball = clonePoint(value.ball);
    this.lastSafe = clonePoint(value.lastSafe);
    this.paused = true;
    this.rolling = false;
    this.complete = this.mode === "holes" && this.completed[this.holeIndex] !== null;
    this.finished = value.finished;
    this.settings = {...value.settings};
    this.expectedVelocity = null;
  }

  private captureHole(): void {
    this.rolling = false;
    this.paused = true;
    this.complete = true;
    if (this.mode === "holes") {
      this.completed[this.holeIndex] = this.strokes[this.holeIndex];
      this.finished = this.completed.every(value => value !== null);
    }
    this.ball = clonePoint(this.hole.cup);
    this.lastSafe = clonePoint(this.hole.cup);
    this.expectedVelocity = null;
  }

  private failBounds(): void {
    this.rolling = false;
    this.paused = true;
    if (this.mode === "holes") this.strokes[this.holeIndex]++;
    this.ball = clonePoint(this.lastSafe);
    this.expectedVelocity = null;
  }
}

export function encodeCheckpoint(session: PocketGolfSession): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    schemaVersion: 1,
    appId: SAVE_APP_ID,
    kind: SAVE_KIND,
    gameBuild: "unbound",
    contentVersion: CONTENT_VERSION,
    payload: session.checkpointForSave().checkpoint,
  });
}

export function decodeCheckpoint(text: string, maxBytes = 2 * 1024 * 1024): Checkpoint {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new CheckpointError("Save file is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CheckpointError("Save file is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CheckpointError("Wrong save envelope");
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.schemaVersion !== 1 || envelope.appId !== SAVE_APP_ID || envelope.kind !== SAVE_KIND || envelope.contentVersion !== CONTENT_VERSION) {
    throw new CheckpointError("Wrong save envelope");
  }
  validateCheckpoint(envelope.payload);
  return envelope.payload;
}

function validateCheckpoint(value: unknown): asserts value is Checkpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CheckpointError("Invalid checkpoint");
  const item = value as Record<string, unknown>;
  if (item.mode !== "holes" && item.mode !== "practice") throw new CheckpointError("Invalid mode");
  if (!Number.isInteger(item.holeIndex) || (item.holeIndex as number) < 0 || (item.holeIndex as number) >= HOLES.length) throw new CheckpointError("Invalid hole");
  if (!Array.isArray(item.strokes) || item.strokes.length !== HOLES.length || !item.strokes.every(n => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99)) throw new CheckpointError("Invalid stroke counts");
  if (!Array.isArray(item.completed) || item.completed.length !== HOLES.length || !item.completed.every(n => n === null || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99))) throw new CheckpointError("Invalid scorecard");
  if (!point(item.ball) || !point(item.lastSafe)) throw new CheckpointError("Invalid ball position");
  if (typeof item.paused !== "boolean" || typeof item.finished !== "boolean") throw new CheckpointError("Invalid flags");
  const settings = item.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new CheckpointError("Invalid settings");
  const s = settings as Record<string, unknown>;
  if (typeof s.sound !== "boolean" || !bounded(s.volume, 0, 1) || typeof s.reducedMotion !== "boolean" || typeof s.highContrast !== "boolean") throw new CheckpointError("Invalid settings");
}

function hash32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
