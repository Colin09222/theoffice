// The small 3D tower on the home page (docs/redesign, Q1 and job 14): it loads last, after the content, in a frame about a third of the desktop
// width, and works as a navigator: hover a floor to see who is there, click it to swoop in. No WebGL: null, and the page keeps its floor list.
import { startStage } from './stage-start.js';
import { LobbyView } from './lobby-scene.js';

let view = null;
export async function showTower({ frame, floorCount, floors, toLet, onPick, onHover }) {
  const stage = startStage();
  if (!stage.ok) return null;
  stage.setBoxed(true);
  view ||= new LobbyView({ floorCount });
  view.onPick = onPick; view.onHover = onHover;
  view.setFloors(floors, toLet);
  stage.setView(view);
  window.__lobbyDebug = view;  // read by the browser tests
  frame.classList.add('ready');
  frame.querySelector('.tower-wait')?.remove();
  return {
    setHover: (n) => view.setHover(n),
    setFloors: (f, t) => view.setFloors(f, t),
    setLive: (l) => view.setLive(l),  // round 2, r2-j36
    flyTo: (n) => view.flyTo(n),
    leave: () => stage.setBoxed(false),
  };
}
