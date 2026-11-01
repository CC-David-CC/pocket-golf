export class GolfAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private volume = 0.35;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) void this.unlock();
    if (!enabled) void this.context?.suspend();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(kind: "putt" | "sink" | "penalty" | "select"): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequency = kind === "putt" ? 180 : kind === "sink" ? 620 : kind === "penalty" ? 95 : 320;
    oscillator.type = kind === "sink" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (kind === "sink") oscillator.frequency.exponentialRampToValueAtTime(920, now + 0.18);
    gain.gain.setValueAtTime(Math.max(0.0001, this.volume * 0.08), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "sink" ? 0.32 : 0.12));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    }, {once: true});
  }

  suspend(): void {
    void this.context?.suspend().catch(() => {});
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
  }
}
