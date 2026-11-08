// The cutaway that follows the camera. In the tower the camera goes all the way round a floor, so from behind, a room's back and left walls
// would stand between it and the people. Each wall that faces the camera is cut down to its sill, a dither at a time as the camera turns, and
// the room's front and right walls, which only ever show from behind, come up as the others go. It all happens in the shaders, from the
// camera's own position (every floor stands on the tower's axis), so it costs nothing per frame, and a floor in the tower draws with the very
// programs its floor page uses. A floor page turns all the way round too; from the front, where it starts, nothing is cut.
import { ROOM_W, ROOM_D } from './layouts.js';

/** Shared by every material the cut is patched into. On wherever a room is shown. */
export const CUT = { uCutOn: { value: 0 } };
export const SILL = 1.02;               // a cut wall keeps everything up to its window sill
const BAND = 0.75;                      // how far in from a wall's inside face counts as that wall (its trim, its clock, its pictures)
const HB = -ROOM_D / 2 + BAND, HL = -ROOM_W / 2 + BAND, FB = ROOM_D / 2 - 0.6, FR = ROOM_W / 2 - 0.6;
/** The same edges in GLSL, for the tower's own stand-in shader. */
export const EDGE = { HB: HB.toFixed(2), HL: HL.toFixed(2), FB: FB.toFixed(2), FR: FR.toFixed(2), SILL: '1.02' };

/** How far each wall is cut, from the camera's direction round the tower's axis: x is the back wall (camera behind), y the left one. */
export const CUT_AMOUNT = (on) => `vec2 _cd = cameraPosition.xz / max(length(cameraPosition.xz), 1e-3);
  vec2 _cut = ${on} * vec2(smoothstep(-0.16, -0.42, _cd.y), smoothstep(-0.16, -0.42, _cd.x));`;
export const CUT_BAYER = 'float cutBayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4; '
  + 'int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }';
/** The same numbers as the shader, for code that wants to know (which far walls to draw at all). */
export function cutAmount(camX, camZ) {
  const l = Math.max(1e-3, Math.hypot(camX, camZ)), s = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  return [CUT.uCutOn.value * s(-0.16, -0.42, camZ / l), CUT.uCutOn.value * s(-0.16, -0.42, camX / l)];
}

/**
 * Patches a material with the cut. `room`: geometry merged in the room's own space, so its height above the floor is its own y and a cut
 * wall keeps its sill. `mount`: something hung on a wall, gone with it whatever its height. `far`: the front and right walls, shown only
 * while the wall opposite is cut.
 */
export function cutaway(mat, mode = 'room') {
  if (mat.userData.cut) return mat;
  mat.userData.cut = mode;
  const before = mat.onBeforeCompile, key = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    before?.call(mat, sh, r);
    Object.assign(sh.uniforms, CUT);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCutOn; varying vec3 vCutP; varying vec2 vCut;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 _cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            _cw = instanceMatrix * _cw;
          #endif
          _cw = modelMatrix * _cw;
          ${CUT_AMOUNT('uCutOn')}
          vCutP = vec3(_cw.x, transformed.y, _cw.z); vCut = _cut;
          ${mode === 'far' ? 'bool _f = _cw.z > ' + FB.toFixed(2) + '; float _a = _f ? _cut.x : _cut.y; if (_a <= 0.001) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);' : ''} }`);
    const test = mode === 'far'
      ? `float _a = vCutP.z > ${FB.toFixed(2)} ? vCut.x : vCutP.x > ${FR.toFixed(2)} ? vCut.y : 1.0; if (_a <= cutBayer(gl_FragCoord.xy)) discard;`
      : `if (${mode === 'room' ? `vCutP.y > ${SILL.toFixed(2)} && ` : ''}((vCutP.z < ${HB.toFixed(2)} && vCut.x > cutBayer(gl_FragCoord.xy)) || (vCutP.x < ${HL.toFixed(2)} && vCut.y > cutBayer(gl_FragCoord.xy)))) discard;`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCutP; varying vec2 vCut;\n${CUT_BAYER}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${test}`);
  };
  mat.customProgramCacheKey = () => `${key ? key.call(mat) : ''}|cut-${mode}`;
  mat.needsUpdate = true;
  return mat;
}

/** Is a box (in the room's own space) part of the back or left wall: hung on it, or standing in it? */
export const onWall = (b) => b.max.z < HB + 0.2 || b.max.x < HL + 0.2;
