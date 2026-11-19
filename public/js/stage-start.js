// The 3D stage, started on first use rather than at boot (docs/redesign, jobs 14 and 16): the home page's content and a phone's floor page are
// drawn before any three.js code is fetched, and only what needs the room or the tower brings it in.
import { stage } from './stage.js';
import { $, toast } from './dom.js';

let started = false;
export function startStage() {
  if (!started) { started = true; stage.init($('#scene')); stage.notice = (m) => toast(m); }
  return stage;
}
export { stage };
