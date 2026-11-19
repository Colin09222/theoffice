// Replay (docs/redesign/OFFICE-ANSWERS-2.md, Q24 idea 1; job r2-j48): "Watch how this was made". An Idle floor plays its last real job back in
// 30 to 60 s, from the job's own event log (server/eventlog.js): the room acts out the real steps, the real timeline card changes as it did, and
// the step photos appear when they were taken. "Replay · Tuesday 14:10" is on screen the whole time, so nobody takes it for live work. On phone
// low there is no room: the cards and the photos only. Nothing here asks a model for anything, and every step is a real record.
import { h } from './dom.js';
import { replayTimeline, replayLabel } from './room-rules.js';

const STATE_WORD = { todo: 'Up next', working: 'Working', review: 'Handed in', waiting: 'Waiting', done: 'Done', failed: 'Not finished', cancelled: 'Called off' };

export class Replay {
  constructor(page, data, { room = true } = {}) {
    this.page = page; this.data = data; this.view = room ? page.view : null;
    const plan = replayTimeline(data.items);
    this.steps = plan.steps; this.length = plan.length; this.label = replayLabel(data.at);
    this.played = []; this.next = 0;
  }
  start() {
    const d = this.data;
    this.cardEl = h('li.tl-item.tl-job.replay-card', { 'data-state': 'todo' },
      h('div.tl-body', {}, h('div.tl-top', {}, h('b.tl-title', {}, d.card.title), h('span.tl-state', { 'data-state': 'todo' }, STATE_WORD.todo)), h('p.tl-line', {}, '')));
    this.shotsEl = h('div.replay-shots');
    this.bar = h('i.replay-bar');
    this.el = h('div.replay', { role: 'region', 'aria-label': this.label, 'data-mode': this.view ? 'room' : 'cards' },
      h('div.replay-head', {}, h('span.replay-label', {}, this.label), h('span.replay-track', {}, this.bar), h('button.btn.chrome.replay-stop', { type: 'button', onclick: () => this.stop() }, 'Stop')),
      h('ol.replay-cards', {}, this.cardEl), this.shotsEl);
    document.body.append(this.el);
    document.body.dataset.replay = 'on';
    this.t0 = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
    this.tick();
    return this;
  }
  get time() { return (performance.now() - this.t0) / 1000; }
  tick() {
    const t = this.time;
    while (this.next < this.steps.length && this.steps[this.next].at <= t) this.play(this.steps[this.next++]);
    this.bar.style.width = `${Math.min(100, (t / this.length) * 100).toFixed(1)}%`;
    if (t >= this.length) this.stop(true);
  }
  /** One real event, as it happened. Each carries its record: the log's own row. */
  play(s) {
    this.played.push({ kind: s.kind, id: s.id, at: Math.round(this.time * 10) / 10 });
    const v = this.view, actor = (id) => v?.actors.get(id) || [...(v?.actors.values() || [])].find((a) => String(a.id) === String(id));
    if (s.kind === 'card') {
      this.cardEl.dataset.state = s.state;
      const st = this.cardEl.querySelector('.tl-state'); st.dataset.state = s.state; st.textContent = STATE_WORD[s.state] || '';
      this.cardEl.querySelector('.tl-line').textContent = s.line || '';
      if (s.title) this.cardEl.querySelector('.tl-title').textContent = s.title;
    } else if (s.kind === 'shot') {
      this.shotsEl.append(h('img', { src: s.url, alt: 'A step of this job, as it was', width: '160', height: '100' }));
    } else if (!v) {
      // Phone low: cards and photos only.
    } else if (s.kind === 'task') {
      const a = actor(s.agent); if (!a) return;
      if (s.status === 'doing') a.applyState('typing', s.title);
      else if (s.status === 'done' || s.status === 'review') { a.applyState('idle', null); a.char.celebrate(); } else a.applyState('idle', null);
    } else if (s.kind === 'handoff') v.life.handoff(s.from, s.to);
    else if (s.kind === 'talk') { if (s.text && actor(s.from)) v.life.line({ from: s.from, to: s.to, text: s.text, kind: s.beat, beat: s.beat, ts: Date.now() }); }
    else if (s.kind === 'check') { const a = actor(s.agent); a?.perform([{ anim: s.passed ? 'five' : 'slump', hold: 1.5, record: { type: 'job_event', id: s.id } }]); }
    else if (s.kind === 'launch') v.cheer();
  }
  /** Over, or stopped: everyone goes back to what they are really doing now. */
  stop(finished = false) {
    if (this.done) return;
    this.done = true; clearInterval(this.timer);
    this.page.lastReplay = { length: this.length, took: this.time, finished, steps: this.steps.length, played: this.played.length };  // read by the tests
    delete document.body.dataset.replay;
    if (this.view) for (const a of this.page.state.agents) { const x = this.view.actors.get(a.id); if (x) x.applyState(a.state, a.activity); }
    if (finished) { this.el.dataset.done = 'true'; this.el.querySelector('.replay-label').textContent = `${this.label} · finished`; setTimeout(() => this.el.remove(), 2500); } else this.el.remove();
    this.page.replay = null; this.page.renderControls?.();
  }
}
