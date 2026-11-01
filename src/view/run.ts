import HavokPhysics from "@babylonjs/havok";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate.js";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import "@babylonjs/core/Physics/physicsEngineComponent.js";
import { Scene } from "@babylonjs/core/scene.js";
import { GolfAudio } from "../audio/synth.js";
import {
  HOLES,
  PocketGolfSession,
  clampPower,
  decodeCheckpoint,
  type Checkpoint,
  type GolfHole,
  type GolfSettings,
} from "../model/golf.js";

interface StoredFile {
  data: Uint8Array;
  version: string;
  status?: string;
}

interface FileContext {
  owner: string;
  valid(): boolean;
  path(value: string): string;
  name(value: string): string;
  files: {
    read(path: string): Promise<StoredFile>;
    write(path: string, data: Uint8Array, expected?: string | null): Promise<{version: string; status?: string}>;
    stat?(path: string): Promise<{version: string; status?: string; bytes?: number}>;
    subscribe?(callback: () => void): () => void;
  };
}

interface WindowState {
  dirty: boolean;
  launchContext?: {version: 1; storage: "mirror"; path: string; owner: string};
}

export interface Host {
  signal?: AbortSignal;
  w?: {
    title?: string;
    ownerSub?: string;
    launchContext?: {version: 1; storage: "mirror"; path: string; owner: string};
    pocketGolf?: WindowState;
  };
  ui: {
    make(tag: string, className?: string, text?: string): HTMLElement;
    textButton(label: string, action: () => void): HTMLButtonElement;
    appInput(label: string, value?: string): HTMLInputElement;
    confirm?(message: string, options?: {title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; signal?: AbortSignal}): Promise<boolean>;
  };
  storage: {
    signedInSubject(): string;
    mirrorFileContext(): Promise<FileContext>;
    pickFile(options: {extensions: string[]; signal?: AbortSignal}): Promise<string | null>;
    pickFolder(options: {signal?: AbortSignal}): Promise<string | null>;
  };
}

export interface ViewHandle {
  element: HTMLElement;
  dispose(): void;
}

const HAVOK_WASM = ["node_modules", "@babylonjs", "havok", "lib", "esm", "HavokPhysics.wasm"].join("/");
const FIXED_STEP = 1 / 90;

export async function startView(host: Host, signal: AbortSignal): Promise<ViewHandle> {
  const {make, textButton, appInput} = host.ui;
  const owner = host.w?.launchContext?.owner || host.storage.signedInSubject();
  const windowState = host.w?.pocketGolf ?? {dirty: false};
  if (host.w) {
    host.w.pocketGolf = windowState;
    host.w.ownerSub = owner;
  }
  const audio = new GolfAudio();
  let session = new PocketGolfSession("pocket-golf");
  let disposed = false;
  let busy = false;
  let revision = 0;
  let savedPath: string | null = null;
  let savedVersion: string | null = null;
  let unwatch = () => {};
  let watchSerial = 0;
  let aimAngle = 0;
  let aimPower = 0.45;
  let aiming = false;
  let aimPointer: number | null = null;
  let pointerStart = {x: 0, y: 0};
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let camera: ArcRotateCamera | null = null;
  let ball: Mesh | null = null;
  let ballBody: PhysicsAggregate | null = null;
  let aimGuide: LinesMesh | null = null;
  let holeMeshes: AbstractMesh[] = [];
  let holeAggregates: PhysicsAggregate[] = [];
  let holeMaterials: StandardMaterial[] = [];
  let xrExperience: {dispose(): void; baseExperience?: {sessionManager?: {onXRSessionEnded?: {add?(callback: () => void): void}}}} | null = null;

  const element = make("section", "pocket-golf-view");
  const header = make("header");
  const heading = make("div");
  heading.append(
    make("h2", "", "Pocket Golf"),
    make("p", "", "Six compact holes. Aim, putt, and read the actual lie."),
  );
  const toolbar = make("div", "pocket-golf-toolbar");
  const playButton = textButton("Start / resume", () => togglePlay());
  const pauseButton = textButton("Pause", () => pause("Game paused."));
  const resetButton = textButton("Reset lie (+1)", () => resetLie());
  const nextButton = textButton("Next hole", () => nextHole());
  const restartButton = textButton("Restart round", () => void restartRound());
  toolbar.append(playButton, pauseButton, resetButton, nextButton, restartButton);
  header.append(heading, toolbar);

  const layout = make("div", "pocket-golf-layout");
  const stage = make("div", "pocket-golf-stage");
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Pocket Golf play area. Drag from the ball to aim, or use the aim controls.");
  stage.append(canvas);

  const side = make("div", "pocket-golf-side");
  const courseCard = make("section", "pocket-golf-card");
  const holeSelect = document.createElement("select");
  holeSelect.setAttribute("aria-label", "Golf hole");
  const practiceOption = document.createElement("option");
  practiceOption.value = "practice";
  practiceOption.textContent = "Practice green";
  holeSelect.append(practiceOption);
  for (const hole of HOLES) {
    const option = document.createElement("option");
    option.value = String(hole.id - 1);
    option.textContent = `Hole ${hole.id} · ${hole.name} · par ${hole.par}`;
    holeSelect.append(option);
  }
  const info = make("p", "", "Hole 1 · Mossy Start · par 2");
  const score = make("div", "pocket-golf-score");
  courseCard.append(holeSelect, info, score);

  const aimCard = make("section", "pocket-golf-card");
  const aimLabel = make("p", "", "Aim straight");
  const aimRow = make("div", "pocket-golf-toolbar");
  const aimLeft = textButton("Aim left", () => adjustAim(-0.12));
  const aimRight = textButton("Aim right", () => adjustAim(0.12));
  const puttButton = textButton("Putt", () => putt());
  const cancelButton = textButton("Cancel aim", () => cancelAim(true));
  aimRow.append(aimLeft, aimRight, puttButton, cancelButton);
  const powerRow = make("label", "pocket-golf-meter", "Power ");
  const power = document.createElement("input");
  power.type = "range";
  power.min = "5";
  power.max = "100";
  power.step = "5";
  power.value = "45";
  power.setAttribute("aria-label", "Putt power");
  const powerValue = make("output", "", "45%");
  powerRow.append(power, powerValue);
  aimCard.append(aimLabel, aimRow, powerRow);

  const fileCard = make("section", "pocket-golf-card");
  const fileRow = make("div", "pocket-golf-toolbar");
  const openButton = textButton("Open from My files", () => void open());
  const saveButton = textButton("Save to My files", () => void save());
  fileRow.append(openButton, saveButton);
  const path = appInput("Pocket Golf checkpoint path", host.w?.launchContext?.path || "/Pocket Golf.game.json");
  const folderButton = textButton("Choose folder", () => void chooseFolder());
  fileCard.append(fileRow, path, folderButton);

  const settings = document.createElement("details");
  settings.append(make("summary", "", "Settings"));
  const soundLabel = make("label", "", "Sound effects ");
  const sound = document.createElement("input");
  sound.type = "checkbox";
  sound.setAttribute("aria-label", "Sound effects");
  soundLabel.prepend(sound);
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "35";
  volume.disabled = true;
  volume.setAttribute("aria-label", "Sound volume");
  const motionLabel = make("label", "", "Reduce motion ");
  const reducedMotion = document.createElement("input");
  reducedMotion.type = "checkbox";
  reducedMotion.setAttribute("aria-label", "Reduce motion");
  motionLabel.prepend(reducedMotion);
  const contrastLabel = make("label", "", "High contrast ");
  const highContrast = document.createElement("input");
  highContrast.type = "checkbox";
  highContrast.setAttribute("aria-label", "High contrast");
  contrastLabel.prepend(highContrast);
  settings.append(soundLabel, volume, motionLabel, contrastLabel);

  const help = document.createElement("details");
  help.append(
    make("summary", "", "How to play"),
    make("p", "", "Press Start / resume, then drag on the course or use Aim and Putt. The ball must settle before another stroke. Reset lie restores the last safe position with a one-stroke penalty. Save is a checkpoint: while the ball is moving it records the last settled lie and says so."),
  );
  const xrButton = textButton("Enter XR", () => void enterXR());
  const xrMessage = make("p", "xr-message", "XR availability is checked from your browser.");
  const riveNote = make("p", "pocket-golf-rive-pending", "Caddie and score stand: procedural placeholder; final Rive artwork is pending.");
  const warning = make("p", "pocket-golf-warning", "");
  warning.hidden = true;
  const status = make("div", "pocket-golf-status", "Loading the Havok physics course…");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  side.append(courseCard, aimCard, fileCard, settings, help, xrButton, xrMessage, riveNote, warning, status);
  layout.append(stage, side);
  element.append(header, layout);

  const valid = () => !disposed && !signal.aborted && owner === host.storage.signedInSubject();
  const setDirty = (value: boolean) => {
    windowState.dirty = value;
    if (value) revision++;
  };
  const announce = (message: string) => {
    if (valid()) status.textContent = message;
  };
  const refresh = () => {
    const hole = session.hole;
    info.textContent = session.mode === "practice"
      ? "Practice green · no scorecard"
      : `${hole.name} · par ${hole.par} · ${session.strokes[session.holeIndex]} strokes${session.complete ? " · complete" : ""}`;
    score.replaceChildren(make("span", "", "Hole"));
    for (let i = 1; i <= 6; i++) score.append(make("span", "", String(session.completed[i - 1] ?? "—")));
    aimLabel.textContent = `Aim ${Math.round(aimAngle * 180 / Math.PI)}° · ${Math.round(aimPower * 100)}%`;
    powerValue.textContent = `${Math.round(aimPower * 100)}%`;
    playButton.textContent = session.paused ? (session.complete ? "Restart view" : "Start / resume") : "Running";
    playButton.disabled = busy || (!session.paused && !session.complete) || (session.complete && session.mode === "practice" && !!session.finished);
    pauseButton.disabled = busy || session.paused;
    resetButton.disabled = busy || session.rolling;
    nextButton.disabled = busy || !session.complete;
    openButton.disabled = busy;
    saveButton.disabled = busy;
    holeSelect.value = session.mode === "practice" ? "practice" : String(session.holeIndex);
    sound.checked = session.settings.sound;
    volume.value = String(Math.round(session.settings.volume * 100));
    reducedMotion.checked = session.settings.reducedMotion;
    highContrast.checked = session.settings.highContrast;
    drawAimGuide();
  };

  function updatePhysicsStep(): void {
    const physics = scene?.getPhysicsEngine();
    physics?.setTimeStep(session.paused ? 0 : FIXED_STEP);
  }

  function togglePlay(): void {
    if (busy) return;
    if (session.complete) {
      if (session.mode === "practice" || session.holeIndex >= HOLES.length - 1) {
        void restartRound();
        return;
      }
      session.nextHole();
      rebuildHole();
      announce(`Hole ${session.hole.id} ready.`);
    } else {
      session.resume();
      audio.unlock();
      announce("Putting. Drag to aim, then release; Pause is always available.");
    }
    updatePhysicsStep();
    refresh();
  }

  function pause(message = "Game paused."): void {
    session.pause();
    aiming = false;
    aimPointer = null;
    updatePhysicsStep();
    refresh();
    announce(message);
  }

  function suspend(): void {
    if (session.paused) return;
    pause("Game paused when its window lost attention. Choose Start / resume when ready.");
  }

  function adjustAim(delta: number): void {
    if (session.rolling || session.complete) return;
    aimAngle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, aimAngle + delta));
    audio.play("select");
    refresh();
  }

  function setPower(value: number): void {
    aimPower = clampPower(value);
    refresh();
  }

  function cancelAim(showMessage = false): void {
    aiming = false;
    aimPointer = null;
    if (aimGuide) aimGuide.setEnabled(false);
    if (showMessage) announce("Aim cancelled; no stroke was launched.");
  }

  function putt(): void {
    if (busy || session.rolling || session.complete) return;
    if (session.paused) {
      announce("Choose Start / resume before putting.");
      return;
    }
    try {
      const velocity = session.commitPutt({x: Math.sin(aimAngle), z: Math.cos(aimAngle)}, aimPower);
      ballBody?.body.setLinearVelocity(new Vector3(velocity.x, 0, velocity.z));
      audio.play("putt");
      cancelAim();
      setDirty(true);
      updatePhysicsStep();
      refresh();
      announce("Ball rolling. Save will use the last settled checkpoint.");
    } catch (error) {
      announce(error instanceof Error ? error.message : "Could not putt.");
    }
  }

  function resetLie(): void {
    if (session.rolling) return;
    session.resetLie();
    placeBall();
    setDirty(true);
    updatePhysicsStep();
    refresh();
    announce(`Lie reset to the last safe position with a one-stroke penalty.`);
  }

  function nextHole(): void {
    if (!session.complete) return;
    const advanced = session.nextHole();
    rebuildHole();
    updatePhysicsStep();
    setDirty(true);
    refresh();
    announce(advanced ? `Hole ${session.hole.id} ready.` : `Round complete with ${session.score} strokes.`);
  }

  async function restartRound(): Promise<void> {
    if (busy || !valid()) return;
    session.pause();
    updatePhysicsStep();
    if (windowState.dirty && !await host.ui.confirm?.("Restart the round and discard unsaved progress?", {
      title: "Restart Pocket Golf",
      confirmLabel: "Restart round",
      cancelLabel: "Keep round",
      danger: true,
      signal,
    })) {
      announce("Restart cancelled; current round kept.");
      return;
    }
    if (!valid()) return;
    clearWatch();
    session = new PocketGolfSession(crypto.randomUUID());
    session.selectHole(0);
    savedPath = null;
    savedVersion = null;
    path.value = "/Pocket Golf.game.json";
    if (host.w) delete host.w.launchContext;
    revision++;
    windowState.dirty = true;
    rebuildHole();
    updatePhysicsStep();
    refresh();
    announce("New round ready. Choose Start / resume.");
  }

  function chooseSettings(update: () => void): void {
    update();
    session.settings.sound = sound.checked;
    session.settings.volume = Number(volume.value) / 100;
    session.settings.reducedMotion = reducedMotion.checked;
    session.settings.highContrast = highContrast.checked;
    audio.setEnabled(session.settings.sound);
    audio.setVolume(session.settings.volume);
    volume.disabled = !session.settings.sound;
    setDirty(true);
    applyContrast();
    refresh();
  }

  sound.addEventListener("change", () => chooseSettings(() => {}));
  volume.addEventListener("input", () => chooseSettings(() => {}));
  reducedMotion.addEventListener("change", () => chooseSettings(() => {}));
  highContrast.addEventListener("change", () => chooseSettings(() => {}));
  holeSelect.addEventListener("change", () => {
    if (busy || session.rolling) {
      holeSelect.value = session.mode === "practice" ? "practice" : String(session.holeIndex);
      return;
    }
    session.selectHole(holeSelect.value === "practice" ? "practice" : Number(holeSelect.value));
    rebuildHole();
    updatePhysicsStep();
    setDirty(true);
    refresh();
    announce(session.mode === "practice" ? "Practice green ready." : `Hole ${session.hole.id} ready.`);
  });

  function aimDirection(): Vector3 {
    return new Vector3(Math.sin(aimAngle), 0, Math.cos(aimAngle));
  }

  function drawAimGuide(): void {
    const activeBall = ball;
    if (!scene || !activeBall) return;
    aimGuide?.dispose(false, true);
    aimGuide = MeshBuilder.CreateLines("pocket-golf-aim", {
      points: [activeBall.position.clone(), activeBall.position.add(aimDirection().scale(0.7 + aimPower * 3.5))],
      updatable: false,
    }, scene);
    aimGuide.color = new Color3(0.97, 0.78, 0.27);
    aimGuide.isPickable = false;
    aimGuide.setEnabled(!session.rolling && !session.complete && (aiming || !session.paused));
  }

  function aimFromPointer(event: PointerEvent): void {
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    aimAngle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, dx / Math.max(80, canvas.clientWidth) * Math.PI * 2 / 3));
    aimPower = clampPower(Math.hypot(dx, dy) / Math.max(100, canvas.clientHeight * 0.55));
    power.value = String(Math.round(aimPower * 100));
    refresh();
  }

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || session.rolling || session.complete) return;
    if (session.paused) {
      announce("Choose Start / resume before aiming.");
      return;
    }
    event.preventDefault();
    aiming = true;
    aimPointer = event.pointerId;
    pointerStart = {x: event.clientX, y: event.clientY};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!aiming || event.pointerId !== aimPointer) return;
    event.preventDefault();
    aimFromPointer(event);
  });
  canvas.addEventListener("pointerup", event => {
    if (!aiming || event.pointerId !== aimPointer) return;
    event.preventDefault();
    aimFromPointer(event);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    aiming = false;
    aimPointer = null;
    putt();
  });
  canvas.addEventListener("pointercancel", event => {
    if (event.pointerId !== aimPointer) return;
    cancelAim(true);
  });
  power.addEventListener("input", () => setPower(Number(power.value) / 100));
  canvas.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      adjustAim(event.key === "ArrowLeft" ? -0.08 : 0.08);
    } else if (event.key === "Enter") {
      event.preventDefault();
      putt();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (aiming) cancelAim(true);
      else if (session.paused) togglePlay();
      else pause();
    }
  });

  function clearWatch(): void {
    watchSerial++;
    unwatch();
    unwatch = () => {};
    warning.hidden = true;
    warning.textContent = "";
  }

  function watch(context: FileContext, target: string, version: string): void {
    clearWatch();
    const serial = watchSerial;
    const check = async () => {
      if (!valid() || !context.valid() || savedPath !== target || savedVersion !== version) return;
      try {
        const current = context.files.stat ? await context.files.stat(target) : await context.files.read(target);
        if (serial !== watchSerial) return;
        if (current.status === "conflict") {
          warning.textContent = "This checkpoint has conflicting copies. Your live round is unchanged; resolve them in Files.";
          warning.hidden = false;
        } else if (current.version !== version) {
          warning.textContent = "The saved checkpoint changed. Your live round is unchanged; save a copy or reopen it.";
          warning.hidden = false;
        }
      } catch {
        if (serial === watchSerial) {
          warning.textContent = "The saved checkpoint is unavailable. Your live round is unchanged.";
          warning.hidden = false;
        }
      }
    };
    unwatch = context.files.subscribe?.(check) || (() => {});
    queueMicrotask(check);
  }

  async function chooseFolder(): Promise<void> {
    try {
      const folder = await host.storage.pickFolder({signal});
      if (folder === null || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      if (!valid() || !context.valid()) return;
      path.value = context.path((folder === "/" ? "" : folder) + "/" + context.name(path.value.split("/").pop() || "Pocket Golf.game.json"));
    } catch (error) {
      announce("Could not choose folder: " + (error instanceof Error ? error.message : "unknown error"));
    }
  }

  async function save(): Promise<void> {
    if (busy || !valid()) return;
    busy = true;
    session.pause();
    updatePhysicsStep();
    const atRevision = revision;
    const requested = path.value;
    const {checkpoint, usedLastStable} = session.checkpointForSave();
    const text = JSON.stringify({
      format: "ksu.game.save",
      schemaVersion: 1,
      appId: "pocket-golf",
      kind: "pocket-golf-checkpoint/1",
      gameBuild: "babylon-havok-9.33.1",
      contentVersion: "1",
      payload: checkpoint,
    });
    windowState.dirty = true;
    let committed = false;
    try {
      const context = await host.storage.mirrorFileContext();
      const target = context.path(requested);
      if (!target.toLowerCase().endsWith(".game.json")) throw new Error("Use a .game.json file name.");
      let expected: string | null = null;
      try {
        const existing = context.files.stat ? await context.files.stat(target) : await context.files.read(target);
        if (existing.status === "conflict") throw new Error("Resolve the conflict in Files first.");
        if (target === savedPath && savedVersion) {
          if (existing.version !== savedVersion) throw new Error("The saved checkpoint changed. Save a copy or reopen it.");
        } else if (!await host.ui.confirm?.("Replace " + target + "?", {
          title: "Replace checkpoint",
          confirmLabel: "Replace",
          cancelLabel: "Cancel",
          danger: true,
          signal,
        })) {
          announce("Save cancelled. Game remains paused.");
          return;
        }
        expected = existing.version;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "File not found.") throw error;
        if (target === savedPath && savedVersion) throw new Error("The saved checkpoint was removed. Save a copy or reopen it.");
      }
      if (!valid() || !context.valid()) return;
      const result = await context.files.write(target, new TextEncoder().encode(text), expected);
      if (!valid() || !context.valid()) return;
      savedPath = target;
      savedVersion = result.version;
      if (path.value === requested) path.value = target;
      if (host.w) {
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
        host.w.title = target.split("/").pop() + " — Pocket Golf";
      }
      committed = true;
      windowState.dirty = revision !== atRevision;
      watch(context, target, result.version);
      announce(result.status === "conflict"
        ? "Checkpoint saved locally with conflicting copies. Resolve them in Files."
        : usedLastStable
          ? "Saved the last settled checkpoint; the current roll was not included."
          : revision !== atRevision
            ? "Saved an earlier checkpoint; newer changes are unsaved."
            : "Checkpoint saved to My files; syncing with the server.");
    } catch (error) {
      announce("Could not save checkpoint: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      if (!committed) windowState.dirty = true;
      busy = false;
      refresh();
    }
  }

  async function open(selected?: string): Promise<void> {
    if (busy || !valid()) return;
    busy = true;
    session.pause();
    updatePhysicsStep();
    let replacement: Checkpoint | null = null;
    const atRevision = revision;
    try {
      if (windowState.dirty && !await host.ui.confirm?.("Open a checkpoint and discard the current round?", {
        title: "Unsaved round",
        confirmLabel: "Discard round",
        cancelLabel: "Keep round",
        danger: true,
        signal,
      })) {
        announce("Open cancelled; current round kept.");
        return;
      }
      if (!valid() || revision !== atRevision) throw new Error("The round changed while confirming; try again.");
      const choice = selected || await host.storage.pickFile({extensions: [".json"], signal});
      if (!choice || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      const target = context.path(choice);
      const file = await context.files.read(target);
      if (!valid() || !context.valid()) return;
      if (file.status === "conflict") throw new Error("Resolve the conflict in Files first.");
      replacement = decodeCheckpoint(new TextDecoder("utf-8", {fatal: true}).decode(file.data));
      if (!valid() || revision !== atRevision) throw new Error("The round changed while opening; try again.");
      session.applyCheckpoint(replacement);
      savedPath = target;
      savedVersion = file.version;
      path.value = target;
      revision++;
      windowState.dirty = false;
      rebuildHole();
      updatePhysicsStep();
      if (host.w) {
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
        host.w.title = target.split("/").pop() + " — Pocket Golf";
      }
      watch(context, target, file.version);
      refresh();
      announce("Checkpoint loaded and paused. Choose Start / resume when ready.");
    } catch (error) {
      announce("Could not open checkpoint: " + (error instanceof Error ? error.message : "unknown error") + ". Current round kept.");
    } finally {
      busy = false;
      refresh();
    }
  }

  async function enterXR(): Promise<void> {
    if (xrExperience) return;
    if (!navigator.xr) {
      xrMessage.textContent = "XR is unavailable in this browser or device.";
      return;
    }
    try {
      const vr = await navigator.xr.isSessionSupported("immersive-vr");
      const ar = await navigator.xr.isSessionSupported("immersive-ar");
      if (!vr && !ar) {
        xrMessage.textContent = "No immersive AR or VR session is available.";
        return;
      }
      session.pause();
      updatePhysicsStep();
      const {WebXRDefaultExperience} = await import("@babylonjs/core/XR/webXRDefaultExperience.js");
      xrExperience = await WebXRDefaultExperience.CreateAsync(scene!, {
        disableDefaultUI: true,
        uiOptions: {sessionMode: vr ? "immersive-vr" : "immersive-ar"},
      });
      xrExperience.baseExperience?.sessionManager?.onXRSessionEnded?.add?.(() => {
        xrExperience?.dispose();
        xrExperience = null;
        session.pause();
        updatePhysicsStep();
        refresh();
        announce("XR ended. Current round paused.");
      });
      xrMessage.textContent = "XR session active. Use the headset system control to exit.";
    } catch (error) {
      xrMessage.textContent = "Could not enter XR: " + (error instanceof Error ? error.message : "unknown error");
    }
  }

  function applyContrast(): void {
    const high = session.settings.highContrast;
    scene?.clearColor.set(high ? 0.03 : 0.56, high ? 0.04 : 0.72, high ? 0.06 : 0.78, 1);
    if (camera) camera.beta = session.settings.reducedMotion ? 0.9 : 0.82;
  }

  function placeBall(): void {
    if (!ballBody) return;
    ballBody.body.disablePreStep = false;
    ballBody.transformNode.position.set(session.ball.x, 0.27, session.ball.z);
    ballBody.body.setLinearVelocity(Vector3.Zero());
    ballBody.body.setAngularVelocity(Vector3.Zero());
    ballBody.body.disablePreStep = true;
  }

  function disposeHole(): void {
    for (const aggregate of holeAggregates) aggregate.dispose();
    holeAggregates = [];
    for (const mesh of holeMeshes) mesh.dispose(false, true);
    holeMeshes = [];
    for (const material of holeMaterials) material.dispose();
    holeMaterials = [];
    ball = null;
    ballBody = null;
    aimGuide = null;
  }

  function rebuildHole(): void {
    if (!scene) return;
    disposeHole();
    const hole: GolfHole = session.hole;
    const width = hole.bounds.maxX - hole.bounds.minX;
    const depth = hole.bounds.maxZ - hole.bounds.minZ;
    const centerX = (hole.bounds.maxX + hole.bounds.minX) / 2;
    const centerZ = (hole.bounds.maxZ + hole.bounds.minZ) / 2;
    const groundMaterial = new StandardMaterial("pocket-golf-fairway", scene);
    groundMaterial.diffuseColor = Color3.FromHexString(session.settings.highContrast ? "#d9ddc7" : "#7ea96a");
    groundMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
    holeMaterials.push(groundMaterial);
    const ground = MeshBuilder.CreateBox("pocket-golf-ground", {width, height: 0.2, depth}, scene);
    ground.position.set(centerX, -0.1, centerZ);
    ground.material = groundMaterial;
    ground.receiveShadows = true;
    holeMeshes.push(ground);
    holeAggregates.push(new PhysicsAggregate(ground, PhysicsShapeType.BOX, {mass: 0, friction: 0.75, restitution: 0.02}, scene));

    const wallMaterial = new StandardMaterial("pocket-golf-wall", scene);
    wallMaterial.diffuseColor = Color3.FromHexString("#e6d6a4");
    holeMaterials.push(wallMaterial);
    const wallHeight = 0.42;
    const wallThickness = 0.18;
    const addWall = (name: string, x: number, z: number, w: number, d: number) => {
      const mesh = MeshBuilder.CreateBox(name, {width: w, height: wallHeight, depth: d}, scene);
      mesh.position.set(x, wallHeight / 2, z);
      mesh.material = wallMaterial;
      holeMeshes.push(mesh);
      holeAggregates.push(new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {mass: 0, friction: 0.55, restitution: 0.15}, scene!));
    };
    addWall("pocket-golf-wall-left", hole.bounds.minX, centerZ, wallThickness, depth);
    addWall("pocket-golf-wall-right", hole.bounds.maxX, centerZ, wallThickness, depth);
    addWall("pocket-golf-wall-back", centerX, hole.bounds.maxZ, width, wallThickness);

    const obstacleMaterial = new StandardMaterial("pocket-golf-obstacle", scene);
    obstacleMaterial.diffuseColor = Color3.FromHexString("#b96f4f");
    holeMaterials.push(obstacleMaterial);
    for (const [index, obstacle] of hole.obstacles.entries()) {
      const mesh = MeshBuilder.CreateBox("pocket-golf-obstacle-" + index, {width: obstacle.width, height: obstacle.height, depth: obstacle.depth}, scene);
      mesh.position.set(obstacle.x, obstacle.height / 2, obstacle.z);
      mesh.material = obstacleMaterial;
      holeMeshes.push(mesh);
      holeAggregates.push(new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {mass: 0, friction: 0.65, restitution: 0.12}, scene));
    }

    const cupMaterial = new StandardMaterial("pocket-golf-cup", scene);
    cupMaterial.diffuseColor = Color3.FromHexString("#1e2a20");
    cupMaterial.emissiveColor = Color3.FromHexString("#182419").scale(0.2);
    holeMaterials.push(cupMaterial);
    const cup = MeshBuilder.CreateCylinder("pocket-golf-cup", {height: 0.025, diameter: 0.58, tessellation: 32}, scene);
    cup.position.set(hole.cup.x, 0.022, hole.cup.z);
    cup.material = cupMaterial;
    cup.isPickable = false;
    holeMeshes.push(cup);
    const flagMaterial = new StandardMaterial("pocket-golf-flag", scene);
    flagMaterial.diffuseColor = Color3.FromHexString("#f0ca53");
    holeMaterials.push(flagMaterial);
    const flag = MeshBuilder.CreateBox("pocket-golf-flag", {width: 0.05, height: 1.15, depth: 0.05}, scene);
    flag.position.set(hole.cup.x + 0.18, 0.57, hole.cup.z);
    flag.material = flagMaterial;
    flag.isPickable = false;
    holeMeshes.push(flag);

    const ballMaterial = new StandardMaterial("pocket-golf-ball", scene);
    ballMaterial.diffuseColor = new Color3(0.96, 0.97, 0.94);
    ballMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
    holeMaterials.push(ballMaterial);
    ball = MeshBuilder.CreateSphere("pocket-golf-ball", {diameter: 0.5, segments: 24}, scene);
    ball.position.set(session.ball.x, 0.27, session.ball.z);
    ball.material = ballMaterial;
    holeMeshes.push(ball);
    ballBody = new PhysicsAggregate(ball, PhysicsShapeType.SPHERE, {mass: 1, friction: 0.48, restitution: 0.26}, scene);
    ballBody.body.setLinearDamping(0.16);
    ballBody.body.setAngularDamping(0.32);
    holeAggregates.push(ballBody);
    ballBody.body.disablePreStep = true;

    camera!.target.set(centerX, 0.25, centerZ);
    camera!.radius = Math.max(11, depth * 1.25);
    applyContrast();
    drawAimGuide();
  }

  const desktopWindow = element.closest<HTMLElement>(".window");
  const windowObserver = desktopWindow ? new MutationObserver(() => {
    if (desktopWindow.hasAttribute("hidden") || !desktopWindow.classList.contains("focused") || desktopWindow.classList.contains("rolled")) suspend();
  }) : null;
  windowObserver?.observe(desktopWindow!, {attributes: true, attributeFilter: ["class", "hidden"]});
  const blur = () => suspend();
  const visibility = () => {
    if (document.hidden) suspend();
  };
  window.addEventListener("blur", blur);
  document.addEventListener("visibilitychange", visibility);

  refresh();
  try {
    announce("Loading the Havok web runtime…");
    const havok = await HavokPhysics({locateFile: () => new URL("../" + HAVOK_WASM, import.meta.url).href});
    if (!valid()) throw new Error("View closed during startup");
    announce("Creating the Babylon course…");
    engine = new Engine(canvas, true, {preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true}, true);
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.56, 0.72, 0.78, 1);
    camera = new ArcRotateCamera("pocket-golf-camera", -Math.PI / 2, 0.82, 14, Vector3.Zero(), scene);
    camera.lowerRadiusLimit = 7;
    camera.upperRadiusLimit = 24;
    camera.wheelDeltaPercentage = 0.02;
    camera.attachControl(canvas, true);
    const light = new HemisphericLight("pocket-golf-light", new Vector3(0.2, 1, -0.2), scene);
    light.intensity = 0.95;
    light.groundColor = new Color3(0.28, 0.34, 0.24);
    announce("Starting Havok physics…");
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    announce("Building the first hole…");
    rebuildHole();
    updatePhysicsStep();
    engine.runRenderLoop(() => {
      if (disposed || !scene) return;
      scene.render();
      const activeBall = ball;
      if (!session.rolling || !ballBody || !activeBall) return;
      const velocity = ballBody.body.getLinearVelocity();
      const speed = velocity.length();
      const result = session.observe({x: activeBall.position.x, z: activeBall.position.z}, speed, activeBall.position.y);
      if (result === "rolling") return;
      if (result === "settled") {
        announce("Ball settled. Aim the next putt or save this checkpoint.");
      } else if (result === "captured") {
        placeBall();
        audio.play("sink");
        announce(session.mode === "practice" ? "Practice putt made." : `Hole ${session.hole.id} complete in ${session.strokes[session.holeIndex]} strokes.`);
      } else {
        placeBall();
        audio.play("penalty");
        announce("Ball went out of bounds. Restored the last safe lie with a penalty.");
      }
      updatePhysicsStep();
      refresh();
    });
    if (host.w?.launchContext?.storage === "mirror" && host.w.launchContext.owner === owner) {
      queueMicrotask(() => void open(host.w!.launchContext!.path));
    } else {
      announce("Press Start / resume, then drag on the course or use Aim and Putt.");
    }
  } catch (error) {
    announce("Could not start Pocket Golf: " + (error instanceof Error ? error.message : "unknown error"));
  }

  return {
    element,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAim();
      clearWatch();
      windowObserver?.disconnect();
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      xrExperience?.dispose();
      xrExperience = null;
      disposeHole();
      scene?.dispose();
      engine?.dispose();
      scene = null;
      engine = null;
      camera = null;
      audio.dispose();
      element.replaceChildren();
    },
  };
}
