// 模拟时间引擎：真实时间 × 倍速 → 模拟 UTC 时间
export class TimeEngine {
  private simMs = Date.now(); // 锚定的模拟时间
  private realMs = performance.now(); // 锚定的真实时间
  speed = 1;
  playing = true;

  now(): Date {
    const el = this.playing ? (performance.now() - this.realMs) * this.speed : 0;
    return new Date(this.simMs + el);
  }

  private reanchor() {
    this.simMs = this.now().getTime();
    this.realMs = performance.now();
  }

  setSpeed(s: number) {
    this.reanchor();
    this.speed = s;
    this.playing = true;
  }

  toggle() {
    this.reanchor();
    this.playing = !this.playing;
  }

  resetToNow() {
    this.simMs = Date.now();
    this.realMs = performance.now();
    this.playing = true;
  }
}
