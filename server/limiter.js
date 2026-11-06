// FIFO limiter on concurrent LLM calls: per floor and global. Queued work waits; nothing is dropped.
export class Limiter {
  constructor(perFloor, global) { this.perFloor = perFloor; this.global = global; this.active = 0; this.floorActive = new Map(); this.queue = []; this.peak = 0; this.peakFloor = 0; }
  acquire(floorId, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
      const entry = { floorId, resolve, reject, signal };
      if (signal) { entry.onAbort = () => { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(signal.reason ?? new Error('aborted')); } }; signal.addEventListener('abort', entry.onAbort, { once: true }); }
      this.queue.push(entry); this._pump();
    });
  }
  _pump() {
    for (let i = 0; i < this.queue.length && this.active < this.global;) {
      const e = this.queue[i];
      const n = this.floorActive.get(e.floorId) || 0;
      if (n >= this.perFloor) { i++; continue; }
      this.queue.splice(i, 1);
      if (e.signal && e.onAbort) e.signal.removeEventListener('abort', e.onAbort);
      this.active++; this.floorActive.set(e.floorId, n + 1);
      this.peak = Math.max(this.peak, this.active); this.peakFloor = Math.max(this.peakFloor, n + 1);
      let released = false;
      e.resolve(() => {
        if (released) return; released = true; this.active--;
        const m = this.floorActive.get(e.floorId) - 1;
        if (m <= 0) this.floorActive.delete(e.floorId); else this.floorActive.set(e.floorId, m);
        this._pump();
      });
    }
  }
}
