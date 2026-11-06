// In-process SSE fan-out. Each subscriber has its own viewer, so redaction is decided per connection, per event.
export class Bus {
  constructor(engineRef) { this.floors = new Map(); this.total = 0; this.byIp = new Map(); this.engineRef = engineRef; }
  subscribe(floorId, sub) {
    let set = this.floors.get(floorId);
    if (!set) { set = new Set(); this.floors.set(floorId, set); }
    set.add(sub); this.total++;
    this.byIp.set(sub.ip, (this.byIp.get(sub.ip) || 0) + 1);
    return () => {
      if (!set.delete(sub)) return;
      this.total--;
      const n = this.byIp.get(sub.ip) - 1;
      if (n <= 0) this.byIp.delete(sub.ip); else this.byIp.set(sub.ip, n);
      if (!set.size && this.floors.get(floorId) === set) this.floors.delete(floorId);
    };
  }
  publish(floorId, ev) {
    const set = this.floors.get(floorId);
    if (!set) return;
    for (const sub of [...set]) sub.send(ev);
  }
  closeFloor(floorId) { for (const sub of [...(this.floors.get(floorId) || [])]) sub.close(); }
  closeAll() { for (const set of [...this.floors.values()]) for (const sub of [...set]) sub.close(); }
  countIp(ip) { return this.byIp.get(ip) || 0; }
}
