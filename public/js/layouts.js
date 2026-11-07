// The floor plans. Pure data and a walking grid, with no three.js, so the tests can prove in plain Node that every desk, meeting
// spot and errand in every plan can be reached on foot. x runs left to right, z runs from the back wall (-6.8) to the camera (+6.8).
// A desk is [x, z, ry]: the sitter is 0.84 in front of it and faces it. ry is a quarter turn, so footprints stay axis-aligned:
// 0 faces the back wall, PI faces the camera, PI/2 faces the left wall, -PI/2 faces the right.
export const ROOM_W = 22, ROOM_D = 13.6, CELL = 0.5, WALL_H = 4.6;
const Q = Math.PI / 2, HALF = Math.PI;

// A plan's `walls` are lines [x0, z0, x1, z1, doors]: glass, with a gap for each door [a, b] along the line. `screens` are the same but
// waist high. `rooms` name the spaces those walls make. Every plan has a boss's office, a manager's office, staff pods or offices, a
// meeting room, a kitchen and a lounge, and people walk between them through the doors.
export const PLANS = {
  // Rows of desks in two pods, with the offices and the glass meeting room along the back wall.
  open: {
    label: 'Open plan', blurb: 'Rows of desks, glass offices and a glass meeting room.',
    windows: [[-7.6, -3.7], [3.2, 7.3]],
    desks: [[-4.1, 0.2, 0], [-0.8, 0.2, 0], [-7.4, 0.2, 0], [2.5, 0.2, 0], [-4.1, 4.2, 0], [-0.8, 4.2, 0], [-7.4, 4.2, 0], [2.5, 4.2, 0]],
    manager: [-6.9, -4.6, 0], boss: [5.1, -4.6, 0],
    board: -0.4,
    walls: [[-11, -2.6, 7.6, -2.6, [[-5.4, -3.8], [-1.6, 0.8], [3.2, 4.8]]], [-3.4, -6.8, -3.4, -2.6], [2.6, -6.8, 2.6, -2.6], [7.6, -6.8, 7.6, 0.2, [[-2.2, -0.6]]], [5.2, 0.2, 11, 0.2, [[8.2, 9.8]]], [5.2, 0.2, 5.2, 6.8, [[1.2, 2.8]]]],
    screens: [[-2.45, -0.75, -2.45, 1.0], [-2.45, 3.3, -2.45, 5.0]],
    rooms: [
      { id: 'manager', kind: 'office', label: 'Manager\'s office', rect: [-11, -6.8, -3.4, -2.6] },
      { id: 'meeting', kind: 'meeting', label: 'Meeting room', rect: [-3.4, -6.8, 2.6, -2.6] },
      { id: 'boss', kind: 'office', label: 'Boss\'s office', rect: [2.6, -6.8, 7.6, -2.6] },
      { id: 'kitchen', kind: 'kitchen', label: 'Kitchen', rect: [7.6, -6.8, 11, 0.2], spots: [[8.7, -3.3, Q], [8.6, -1.4, Q], [8.5, -5.0, Q], [8.7, -0.5, Q]] },
      { id: 'lounge', kind: 'lounge', label: 'Lounge', rect: [5.2, 0.2, 11, 6.8], spots: [[6.3, 3.3, 1.0], [9.5, 3.2, -1.0], [7.9, 2.6, 0], [6.4, 1.2, 0.8], [9.7, 1.4, -0.8]] },
      { id: 'pod-a', kind: 'pod', label: 'West pod', rect: [-11, -2.6, -2.45, 6.8] },
      { id: 'pod-b', kind: 'pod', label: 'East pod', rect: [-2.45, -2.6, 5.2, 6.8] },
    ],
    meet: { table: [-0.4, -4.75], size: [1.5, 1.5], block: [3.4, 1.3],
      chairs: [[-2.45, -4.75, Q], [1.65, -4.75, -Q], [-1.4, -3.95, HALF], [0.4, -3.95, HALF]], stand: [-0.7, -5.95],
      spots: [[-2.6, -3.2], [-1.2, -3.2], [0.1, -3.2], [1.7, -3.2], [-2.75, -4.75], [1.75, -4.75], [-2.75, -5.95], [1.75, -5.95]] },
    console: -0.4, shelf: [-10.3, 2.4], coffee: [10.2, -2.4], fridge: [10.2, -6.1], arcade: [-9.8, 6.0], printer: [-9.9, 4.5], coat: [-10.2, -3.6],
    sofa: [7.9, 5.0], hang: [7.9, 2.6, 0], pet: [2, -1.6],
    plants: [[-10.1, -6.0, 0.8, 0.8], [10.4, 0.9, -0.9, 0.7], [-2.45, -1.6, -0.9, 0], [4.6, 0.2, 0, 1.0], [4.6, 6.2, -0.9, 0], [-4.4, 6.3, 0, -1.2], [-0.8, 6.3, 0, -1.2], [-10.2, -2.0, 0.9, 0]],
    rugs: [[5.1, -3.9, 4.2, 3.2, 'boss']],
    art: [[-5.2, 2.6, 1.5, 1.15], [4.9, 2.5, 1.4, 1.75]],
  },
  // A big shared table inside a glass box in the middle of the room, with desks around the walls looking out and in, and easels.
  studio: {
    label: 'Studio', blurb: 'A big shared table in a glass box, with desks around the walls.',
    windows: [[-8.8, -3.2], [2.4, 7.6]],
    desks: [[-4.6, -5.6, 0], [3.6, -5.6, 0], [-1.5, 5.4, HALF], [1.7, 5.4, HALF], [-7.6, -5.6, 0], [6.8, -5.6, 0], [-4.7, 5.4, HALF], [-7.9, 5.4, HALF]],
    manager: [-6.8, -0.7, -Q], boss: [5.6, -0.7, Q],
    board: -0.4,
    walls: [[-11, -3.6, 8, -3.6, [[-1.4, 0.4]]], [-11, 2.25, 11, 2.25, [[-8.6, -7.0], [-1.4, 0.4], [5.0, 6.6], [8.6, 10.2]]], [-4.8, -3.6, -4.8, 2.25], [4.2, -3.6, 4.2, 2.25], [8, -3.6, 8, 2.25], [3.4, 2.25, 3.4, 6.8, [[2.6, 4.2]]]],
    rooms: [
      { id: 'manager', kind: 'office', label: 'Manager\'s office', rect: [-11, -3.6, -4.8, 2.25] },
      { id: 'meeting', kind: 'meeting', label: 'The big table', rect: [-4.8, -3.6, 4.2, 2.25] },
      { id: 'boss', kind: 'office', label: 'Boss\'s office', rect: [4.2, -3.6, 8, 2.25] },
      { id: 'kitchen', kind: 'kitchen', label: 'Kitchen', rect: [8, -6.8, 11, 2.25], spots: [[9.0, -1.4, Q], [9.0, 0.2, Q], [9.0, -3.2, Q], [8.9, 1.4, Q]] },
      { id: 'lounge', kind: 'lounge', label: 'Lounge', rect: [3.4, 2.25, 11, 6.8], spots: [[4.6, 3.4, 1.0], [6.4, 2.9, 0], [9.4, 3.3, -0.8], [10.3, 5.6, -1.4], [4.0, 5.4, 1.4]] },
      { id: 'pod-a', kind: 'pod', label: 'Window desks', rect: [-11, -6.8, 8, -3.6] },
      { id: 'pod-b', kind: 'pod', label: 'Front desks', rect: [-11, 2.25, 3.4, 6.8] },
    ],
    meet: { table: [-0.3, -0.7], size: [2.2, 1.5, 2.0], block: [6.4, 3.2],
      chairs: [[-3.15, -0.7, Q], [2.55, -0.7, -Q], [-1.6, -1.85, 0], [-0.3, -1.85, 0], [1.0, -1.85, 0], [-1.6, 0.45, HALF], [-0.3, 0.45, HALF], [1.0, 0.45, HALF]], stand: [-0.3, -2.95],
      spots: [[-3.0, -2.85], [-1.6, -2.85], [1.0, -2.85], [2.4, -2.85], [-4.2, -0.7], [3.6, -0.7], [-2.2, 1.6], [1.6, 1.6]] },
    console: -0.7, shelf: [-10.3, -5.3], coffee: [10.2, -1.0], fridge: [10.2, -5.6], arcade: [-10.4, 4.6], printer: [-10.1, 2.95], coat: [-10.2, 1.3],
    sofa: [6.9, 5.0], hang: [6.4, 2.9, 0], pet: [-3, 3.5],
    plants: [[-10.4, -3.0, 0.9, 0.2], [10.4, 6.3, -0.8, -0.9], [-9.9, 0.4, 0.9, 0], [4.8, -3.0, 0.9, 0.3], [-6.3, 2.9, 0, 0.9], [8.4, -6.3, 0.1, 0.9], [2.1, -6.3, -0.7, 1.2], [-2.75, -6.3, 0, 1.3]],
    rugs: [[-0.3, -0.7, 8.0, 4.8, 'plain']],
    art: [[-1.6, 2.6, 1.3, 1.6], [5.6, 2.9, 1.2, 1.2]],
    easels: [[-9.4, 1.3, -0.3], [-3.1, 2.95, 0.2]],
    props: [{ m: 'lampRoundFloor', x: 3.9, z: 6.3, tint: 'lamp', b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: -5.3, z: 1.6, tint: 'lamp', b: [0.6, 0.6] }],
  },
  // Benches against the walls, a roller door, boxes, an old sofa and a meeting round some crates in a site office made of old windows.
  garage: {
    label: 'Garage', blurb: 'Workbenches, boxes, a roller door and a site office.',
    windows: [[-8.9, -6.6]],
    desks: [[3.2, 1.0, HALF], [6.3, 1.0, HALF], [3.2, 2.7, 0], [6.3, 2.7, 0], [-9.5, -1.0, Q], [-9.5, 1.8, Q], [-4.7, -5.3, 0], [3.7, -5.3, 0]],
    manager: [-8.6, -5.1, 0], boss: [9.1, 2.6, Q],
    board: -0.4,
    frame: '#6a4b30',
    walls: [[-11, -2.6, -6.2, -2.6, [[-8.0, -6.6]]], [-6.2, -6.8, -6.2, -2.6], [-3.0, -2.4, 2.2, -2.4, [[-1.2, 0.4]]], [-3.0, -6.8, -3.0, -2.4], [2.2, -6.8, 2.2, -2.4], [8.4, -6.8, 8.4, 0.25, [[-2.2, -0.6]]], [7.8, 0.25, 11, 0.25], [7.8, 0.25, 7.8, 4.8], [7.8, 4.8, 11, 4.8, [[9.4, 10.9]]], [-5.6, 2.8, 1.2, 2.8, [[-2.8, -1.2]]], [-5.6, 2.8, -5.6, 6.8, [[3.2, 4.4]]]],
    rooms: [
      { id: 'manager', kind: 'office', label: 'Site office', rect: [-11, -6.8, -6.2, -2.6] },
      { id: 'meeting', kind: 'meeting', label: 'Crate room', rect: [-3.0, -6.8, 2.2, -2.4] },
      { id: 'boss', kind: 'office', label: 'Boss\'s cabin', rect: [7.8, 0.25, 11, 4.8] },
      { id: 'kitchen', kind: 'kitchen', label: 'Tea corner', rect: [8.4, -6.8, 11, 0.25], spots: [[9.1, -2.8, Q], [9.1, -1.4, Q], [9.1, -4.6, Q], [9.1, -0.4, Q]] },
      { id: 'lounge', kind: 'lounge', label: 'The old sofa', rect: [-5.6, 2.8, 1.2, 6.8], spots: [[-4.8, 3.6, 0.9], [-3.3, 3.4, 0.2], [0.4, 3.6, -0.9], [1.1, 5.0, -1.3], [-4.9, 5.4, 1.4]] },
      { id: 'pod-a', kind: 'pod', label: 'The benches', rect: [1.4, -0.6, 7.8, 4.6] },
      { id: 'pod-b', kind: 'pod', label: 'Side wall', rect: [-11, -2.6, -5.6, 6.8] },
      { id: 'pod-c', kind: 'pod', label: 'Back bench', rect: [-6.2, -6.8, -3.0, -2.6] },
      { id: 'pod-d', kind: 'pod', label: 'By the roller door', rect: [2.2, -6.8, 8.4, -0.6] },
    ],
    meet: { table: [-0.4, -4.5], kind: 'crates', size: [1.5, 1.5], block: [2.6, 1.5], chairs: [], stand: [-0.4, -6.0],
      spots: [[-2.1, -3.1], [-0.9, -3.0], [0.3, -3.0], [1.5, -3.1], [-2.5, -4.5], [1.7, -4.5], [-2.4, -5.8], [1.6, -5.8]] },
    console: null, shelf: [-10.3, 5.1], coffee: [10.2, -2.4], fridge: [10.2, -5.9], arcade: [-9.0, 6.1], printer: [-6.4, 6.1], coat: [-10.1, -3.4],
    sofa: [-2.1, 5.0], hang: [-3.3, 3.4, 0], pet: [0.8, -1.6],
    plants: [[-10.4, 3.5, 0.9, 0], [10.4, 6.3, -0.8, -0.8], [1.8, 6.3, 0.9, -0.1], [3.6, 6.3, 0, -0.9], [-10.4, -3.3, 0.9, 0.2], [-6.9, 1.6, 0.9, 0], [-6.7, 0.0, 0.9, 0], [5.6, 6.3, 0, -0.9]],
    rugs: [[-2.1, 4.8, 6.2, 3.6, 'worn']],
    art: [[-4.2, 2.7, 1.3, 1.7], [4.4, 2.9, 1.1, 1.1]],
    roller: [4.7, 7.9], pegboard: [0.3, 2.6],
    props: [
      { m: 'cardboardBoxOpen', x: 6.7, z: -5.1, ry: 0.3, s: 1.6, b: [1.5, 1.4] }, { m: 'cardboardBoxOpen', x: 7.3, z: -3.6, ry: -0.2, s: 1.2, b: [1.1, 1.0] }, { m: 'cardboardBoxOpen', x: 6.7, z: -5.1, y: 0.9, ry: 1.0, s: 1.2 },
      { m: 'cardboardBoxOpen', x: -7.2, z: 3.3, ry: 0.6, s: 1.3, b: [1.2, 1.1] }, { m: 'speaker', x: 1.6, z: 1.9, s: 1.5, b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 0.8, z: 6.2, tint: 'lamp', b: [0.5, 0.5] },
    ],
    bulbs: true,
  },
  // The middle of the room is sofas and rugs. The desks hug the edges, with a glass meeting room on the back wall and offices at the front.
  lounge: {
    label: 'Lounge', blurb: 'Sofas in the middle, desks round the edge.',
    windows: [[-9.2, -3.2], [2.4, 9.4]],
    desks: [[-8.3, -5.3, 0], [4.0, -5.3, 0], [-5.1, -5.3, 0], [7.2, -5.3, 0], [-9.5, -1.0, Q], [-9.5, 1.6, Q], [-2.1, 5.6, HALF], [1.7, 5.6, HALF]],
    manager: [-6.2, 5.4, HALF], boss: [6.2, 5.4, HALF],
    board: -0.4,
    walls: [[-2.9, -2.95, 2.2, -2.95, [[-1.3, 0.5]]], [-2.9, -6.8, -2.9, -2.95], [2.2, -6.8, 2.2, -2.95], [-8.4, 2.9, -3.7, 2.9, [[-7.0, -5.4]]], [-8.4, 2.9, -8.4, 6.8], [-3.7, 2.9, -3.7, 6.8], [3.7, 2.9, 8.8, 2.9, [[5.4, 7.0]]], [3.7, 2.9, 3.7, 6.8], [8.8, 2.9, 8.8, 6.8], [8.2, -4.6, 8.2, 2.9, [[-1.4, 0.2]]], [8.2, -4.6, 11, -4.6]],
    screens: [[-5.8, -2.6, -5.8, -0.6], [6.6, -2.6, 6.6, -0.6]],
    rooms: [
      { id: 'manager', kind: 'office', label: 'Manager\'s office', rect: [-8.4, 2.9, -3.7, 6.8] },
      { id: 'meeting', kind: 'meeting', label: 'Meeting room', rect: [-2.9, -6.8, 2.2, -2.95] },
      { id: 'boss', kind: 'office', label: 'Boss\'s office', rect: [3.7, 2.9, 8.8, 6.8] },
      { id: 'kitchen', kind: 'kitchen', label: 'Kitchen', rect: [8.2, -4.6, 11, 4.4], spots: [[9.0, -1.0, Q], [9.0, 0.4, Q], [9.0, -2.4, Q], [9.1, -3.6, Q]] },
      { id: 'lounge', kind: 'lounge', label: 'Lounge', rect: [-5.8, -2.95, 7.2, 2.9], spots: [[-4.4, 0.4, 1.4], [5.8, 0.4, -1.4], [-3.4, -2.3, 0.6], [4.3, -2.3, -0.6], [5.8, 1.9, -1.0]] },
      { id: 'pod-a', kind: 'pod', label: 'Window desks', rect: [-11, -6.8, -2.9, -2.95] },
      { id: 'pod-b', kind: 'pod', label: 'Window desks', rect: [2.2, -6.8, 11, -4.6] },
      { id: 'pod-c', kind: 'pod', label: 'Wall desks', rect: [-11, -2.95, -5.8, 6.8] },
      { id: 'pod-d', kind: 'pod', label: 'Front desks', rect: [-3.7, 2.9, 3.7, 6.8] },
    ],
    meet: { table: [-0.4, -4.9], size: [1.2, 1.3], block: [2.8, 1.2], chairs: [], stand: [-0.4, -6.05],
      spots: [[-2.1, -3.55], [-1.0, -3.55], [0.2, -3.55], [1.3, -3.55], [-2.45, -4.9], [1.65, -4.9], [-2.4, -6.05], [1.6, -6.05]] },
    console: null, shelf: [-10.3, -3.3], coffee: [10.2, -0.6], fridge: [10.2, -4.0], arcade: [-10.4, 5.5], printer: [-10.35, 4.0], coat: [-7.2, -2.9],
    sofa: null, hang: [-4.4, 0.4, 0], pet: [-1.8, 3.4],
    plants: [[10.4, 6.3, -0.9, -0.5], [-3.4, -6.2, 0, 1.2], [-5.2, -3.0, 0.5, 0.7], [6.6, -3.2, -0.4, 0.8], [-9.6, 6.3, 0.2, -0.9], [-3.2, 3.4, 0.7, 0.3], [-0.2, 6.5, 0, -1.6], [3.3, 6.4, 0, -1.4]],
    rugs: [[0.7, 0.4, 10.4, 5.0, 'big']],
    art: [[6.0, 2.6, 1.3, 1.6], [-1.6, 2.8, 1.5, 1.15]],
    props: [
      { m: 'loungeDesignSofa', x: 0.7, z: -1.15, ry: 0, s: 1.25, tint: 'primary', b: [4.6, 1.5] },
      { m: 'loungeSofa', x: 0.7, z: 2.05, ry: HALF, s: 1.0, tint: 'primary', b: [4.0, 1.1] },
      { m: 'loungeChair', x: -3.2, z: 0.4, ry: Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] }, { m: 'loungeChair', x: 4.5, z: 0.4, ry: -Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] },
      { m: 'tableCoffee', x: 0.7, z: 0.45, s: 1.3, b: [2.2, 1.1] }, { m: 'lampRoundFloor', x: -2.9, z: 2.3, tint: 'lamp', b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 4.3, z: 2.3, tint: 'lamp', b: [0.6, 0.6] },
      { m: 'pillow', x: -0.5, y: 0.55, z: -1.2, ry: 0.2, s: 1.0, tint: 'accent' }, { m: 'pillowBlue', x: 1.9, y: 0.55, z: -1.2, ry: -0.2, s: 1.0, tint: 'cream' },
      { m: 'stoolBar', x: 8.9, z: 2.6, tint: 'accent' }, { m: 'stoolBar', x: 8.9, z: 3.6, tint: 'accent' },
    ],
    bar: [9.9, 3.1],
  },
  // Team pods on their own carpets, with a corner glass room and two glass offices.
  pods: {
    label: 'Pods', blurb: 'Teams of four, back to back, with glass offices and a corner glass room.',
    windows: [[-9.8, -6.0], [-3.8, 1.9]],
    // Filled pod by pod in turn, so a small team doesn't all sit at one end of the room.
    desks: [[-5.95, 1.95, HALF], [1.05, 1.95, HALF], [-3.25, 3.65, 0], [3.75, 3.65, 0], [-3.25, 1.95, HALF], [3.75, 1.95, HALF], [-5.95, 3.65, 0], [1.05, 3.65, 0]],
    manager: [-7.9, -4.5, 0], boss: [-0.5, -4.5, 0],
    board: 6.2,
    walls: [[-11, -2.6, 9.2, -2.6, [[-6.2, -4.6], [1.4, 3.0], [5.0, 7.4]]], [-4.2, -6.8, -4.2, -2.6], [3.2, -6.8, 3.2, -2.6], [9.2, -6.8, 9.2, -2.6], [7.6, -2.6, 7.6, 1.6, [[-1.6, 0.0]]], [6.0, 1.6, 11, 1.6, [[8.4, 10.0]]], [6.0, 1.6, 6.0, 6.8, [[1.8, 3.4]]]],
    rooms: [
      { id: 'manager', kind: 'office', label: 'Manager\'s office', rect: [-11, -6.8, -4.2, -2.6] },
      { id: 'boss', kind: 'office', label: 'Boss\'s office', rect: [-4.2, -6.8, 3.2, -2.6] },
      { id: 'meeting', kind: 'meeting', label: 'Meeting room', rect: [3.2, -6.8, 9.2, -2.6] },
      { id: 'kitchen', kind: 'kitchen', label: 'Kitchen', rect: [7.6, -6.8, 11, 1.6], spots: [[8.8, -1.2, Q], [8.8, 0.4, Q], [8.7, -2.1, Q], [8.3, 1.0, Q]] },
      { id: 'lounge', kind: 'lounge', label: 'Lounge', rect: [6.0, 1.6, 11, 6.8], spots: [[7.0, 3.4, 1.0], [9.9, 3.3, -1.0], [8.4, 2.8, 0], [7.0, 2.2, 0.8], [9.9, 2.2, -0.8]] },
      { id: 'pod-a', kind: 'pod', label: 'West pod', rect: [-7.9, -2.6, -1.1, 6.8] },
      { id: 'pod-b', kind: 'pod', label: 'East pod', rect: [-1.1, -2.6, 6.0, 6.8] },
    ],
    meet: { table: [6.2, -4.75], size: [1.5, 1.5], block: [3.4, 1.3],
      chairs: [[4.15, -4.75, Q], [8.25, -4.75, -Q], [5.2, -3.95, HALF], [7.0, -3.95, HALF]], stand: [5.9, -5.95],
      spots: [[3.9, -3.2], [5.2, -3.2], [6.5, -3.2], [7.8, -3.2], [3.75, -4.75], [8.75, -4.75], [3.75, -5.95], [8.75, -5.95]] },
    console: 2.6, shelf: [-10.3, -0.4], coffee: [10.2, -0.6], fridge: [10.2, -6.0], arcade: [-9.8, 6.0], printer: [-9.9, 4.5], coat: [-10.2, -3.6],
    sofa: [8.4, 5.0], hang: [8.4, 2.8, 0], pet: [-0.8, -1.2],
    plants: [[-10.3, -6.1, 0.1, 0.9], [2.5, -6.2, -0.3, 1.0], [-1.1, 0.2, 0, -0.9], [-7.9, 0.4, 0.9, -0.2], [-4.9, -6.3, 0.1, 0.9], [-7.7, 6.2, 0.9, -0.3], [-1.1, 6.3, 0, -0.9], [5.4, 6.3, -0.9, -0.4]],
    rugs: [],
    pods: [[-4.6, 2.8], [2.4, 2.8]],
    art: [[5.6, 2.5, 1.4, 1.75], [-5.2, 2.6, 1.5, 1.15]],
  },
};
export const planFor = (id) => PLANS[id] || PLANS.open;

// ---- what stands where ----
/** The turned footprint of a rectangle centred (lx, lz) from a point with a quarter turn ry. Returns [x, z, w, d]. */
export function turned(x, z, ry, lx, lz, w, d) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const sideways = Math.abs(s) > 0.5;
  return [x + lx * c + lz * s, z - lx * s + lz * c, sideways ? d : w, sideways ? w : d];
}
/** Where someone sits at a desk, and which way they look. */
export function seatOf([x, z, ry = 0]) { return { at: [x + 0.84 * Math.sin(ry), z + 0.84 * Math.cos(ry)], face: ry + Math.PI }; }
export const bigDeskRect = ([x, z, ry = 0]) => turned(x, z, ry, 0, -0.2, 3.2, 1.6);
export const deskRect = ([x, z, ry = 0]) => turned(x, z, ry, 0, -0.2, 2.5, 1.3);
export const hasSofa = (plan) => !!plan.sofa;

/** The straight runs of wall a plan's lines make once their doors are cut out. `low` marks a waist-high screen. */
export function wallLines(plan) {
  const out = [];
  const cut = (line, low) => {
    const [x0, z0, x1, z1, doors = []] = line;
    const along = x0 !== x1;
    const [from, to] = along ? [x0, x1] : [z0, z1];
    let at = from;
    const run = (a, b) => { if (b > a) out.push(along ? { x0: a, z0, x1: b, z1, low } : { x0, z0: a, x1, z1: b, low }); };
    for (const [a, b] of [...doors].sort((p, q) => p[0] - q[0])) { run(at, a); at = b; }
    run(at, to);
  };
  for (const l of plan.walls || []) cut(l, false);
  for (const l of plan.screens || []) cut(l, true);
  return out;
}
/** Every door as { x, z, along, width }, where `along` says whether its wall runs along x. */
export function doorways(plan) {
  const out = [];
  for (const [x0, z0, x1, z1, doors = []] of plan.walls || []) for (const [a, b] of doors) out.push(x0 !== x1 ? { x: (a + b) / 2, z: z0, along: true, width: b - a } : { x: x0, z: (a + b) / 2, along: false, width: b - a });
  return out;
}
const inRect = ([x0, z0, x1, z1], x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const area = ([x0, z0, x1, z1]) => (x1 - x0) * (z1 - z0);
/** The room a point is in: the smallest one holding it, since a pod's rectangle may reach round an office. */
export function roomAt(plan, x, z) {
  let best = null;
  for (const r of plan.rooms || []) if (inRect(r.rect, x, z) && (!best || area(r.rect) < area(best.rect))) best = r;
  return best;
}
export const roomOfKind = (plan, kind) => (plan.rooms || []).find((r) => r.kind === kind) || null;
/** Where a room's own furniture and people are: the middle of its rectangle, for pins and labels. */
export const roomCentre = (r) => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];

/** Every rectangle a person can't walk through, apart from the staff desks, which arrive one at a time. Each is [x, z, w, d, bake]. */
export function planBlocks(plan, { coffee = true, arcade = false, plants = 0, staffCount = 0 } = {}) {
  const out = [];
  const m = plan.meet; const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;
  const [tx, tz] = m.table;
  for (const w of wallLines(plan)) out.push([(w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2, Math.max(0.1, Math.abs(w.x1 - w.x0)), Math.max(0.1, Math.abs(w.z1 - w.z0)), false]);
  out.push([tx, tz, m.block[0], m.block[1], true]);
  out.push([plan.board, wallZ + 0.12, 4.6, 0.2, false]);
  if (plan.console !== null) out.push([wallX + 0.3, plan.console, 0.7, 2.6, true]);
  out.push([plan.shelf[0], plan.shelf[1], 0.9, 2.8, true]);
  if (coffee) { out.push([plan.coffee[0], plan.coffee[1], 1.2, 3.8, true]); out.push([plan.fridge[0], plan.fridge[1] + 0.5, 1.1, 2.0, true]); }
  if (plan.bar) out.push([plan.bar[0], plan.bar[1], 1.0, 2.6, true]);
  if (arcade) out.push([plan.arcade[0], plan.arcade[1], 1.1, 1.2, true]);
  if (hasSofa(plan, staffCount)) { const [sx, sz] = plan.sofa; out.push([sx, sz + 0.6, 4.4, 2.0, true], [sx, sz - 0.6, 1.8, 1.0, true], [sx + 2.4, sz - 0.6, 0.6, 0.6, true]); }
  out.push([plan.printer[0], plan.printer[1], 1.2, 1.2, true]);
  for (let i = 0; i < plants; i++) { const [x, z] = plan.plants[i]; out.push([x, z, 0.8, 0.8, true]); }
  out.push([...bigDeskRect(plan.manager), true], [...bigDeskRect(plan.boss), true]);
  for (const e of plan.easels || []) out.push([e[0], e[1], 0.9, 0.7, true]);
  for (const p of plan.props || []) if (p.b) out.push([p.x, p.z, p.b[0], p.b[1], true]);
  return out;
}

// ---- walking ----
export function makeNav() {
  const cols = Math.round(ROOM_W / CELL), rows = Math.round(ROOM_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  const toCell = (x, z) => [Math.max(0, Math.min(cols - 1, Math.floor((x + ROOM_W / 2) / CELL))), Math.max(0, Math.min(rows - 1, Math.floor((z + ROOM_D / 2) / CELL)))];
  const toWorld = (cx, cz) => [(cx + 0.5) * CELL - ROOM_W / 2, (cz + 0.5) * CELL - ROOM_D / 2];
  const footprints = [];
  const block = (x, z, w, d, { bake = true } = {}) => {
    const [a, b] = toCell(x - w / 2, z - d / 2), [c, e] = toCell(x + w / 2, z + d / 2);
    for (let i = a; i <= c; i++) for (let j = b; j <= e; j++) blocked[j * cols + i] = 1;
    if (bake) footprints.push([x, z, w, d]);
  };
  const isBlocked = (x, z) => { const [cx, cz] = toCell(x, z); return !!blocked[cz * cols + cx]; };
  // True when the straight line between two points crosses no furniture.
  const clear = (a, b) => { const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)); for (let i = 1; i < steps; i++) { const t = i / steps; const [cx, cz] = toCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (blocked[cz * cols + cx]) return false; } return true; };
  const search = (fx, fz, tx, tz) => {
    const [sx, sz] = toCell(fx, fz), [gx, gz] = toCell(tx, tz);
    const start = sz * cols + sx, goal = gz * cols + gx;
    const prev = new Int32Array(cols * rows).fill(-1); prev[start] = start;
    const q = [start];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      if (cur === goal) break;
      const cx = cur % cols, cz = (cur / cols) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const n = nz * cols + nx;
        if (prev[n] !== -1) continue;
        // Goals may sit inside furniture (a chair), but paths never cut corners through it.
        if (blocked[n] && n !== goal) continue;
        if (dx && dz && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
        prev[n] = cur; q.push(n);
      }
    }
    return { prev, start, goal };
  };
  /** True when there is a real route, rather than the straight-line fallback path() gives up to. */
  const reachable = (fx, fz, tx, tz) => { const { prev, goal } = search(fx, fz, tx, tz); return prev[goal] !== -1; };
  const path = (fx, fz, tx, tz) => {
    const { prev, start, goal } = search(fx, fz, tx, tz);
    if (prev[goal] === -1) return [[tx, tz]];
    const out = [];
    for (let c = goal; c !== start; c = prev[c]) out.push(toWorld(c % cols, (c / cols) | 0));
    out.reverse();
    // String-pulling: keep only the corners that matter.
    const smooth = []; let anchor = [fx, fz];
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1];
      if (!next || !clear(anchor, next)) { smooth.push(out[i]); anchor = out[i]; }
    }
    // The last leg goes to the exact spot, not the middle of its cell, as long as that doesn't clip a corner on the way.
    if (smooth.length && clear(smooth.length > 1 ? smooth[smooth.length - 2] : [fx, fz], [tx, tz])) smooth[smooth.length - 1] = [tx, tz]; else smooth.push([tx, tz]);
    return smooth;
  };
  /** The nearest open spot, spiralling out, so an errand aimed at furniture ends beside it instead of inside it. */
  const freeNear = (x, z) => {
    if (!isBlocked(x, z)) return [x, z];
    for (let r = 1; r < 14; r++) for (let i = 0; i < 8 * r; i++) {
      const a = (i / (8 * r)) * Math.PI * 2; const px = x + Math.cos(a) * r * CELL, pz = z + Math.sin(a) * r * CELL;
      if (Math.abs(px) < ROOM_W / 2 - 0.3 && Math.abs(pz) < ROOM_D / 2 - 0.3 && !isBlocked(px, pz)) return [px, pz];
    }
    return [x, z];
  };
  return { block, path, clear, footprints, isBlocked, freeNear, reachable, cols, rows, blocked };
}

/** The spots a plan promises: chairs, the meeting, the errands. The tests walk to all of these, and so do the people. */
export function planSpots(plan, { coffee = true, arcade = false, plants = 0, staffCount = 8 } = {}) {
  const spots = [];
  const add = (label, x, z) => spots.push({ label, at: [x, z] });
  add('stand', ...plan.meet.stand);
  plan.meet.spots.forEach(([x, z], i) => add(`meeting ${i}`, x, z));
  add('shelf', plan.shelf[0] + 1.0, plan.shelf[1]);
  if (coffee) add('coffee', plan.coffee[0] - 1.0, plan.coffee[1]);
  if (arcade) add('arcade', plan.arcade[0] + 1.0, plan.arcade[1]);
  for (let i = 0; i < plants; i++) { const [x, z, dx, dz] = plan.plants[i]; add(`plant ${i}`, x + dx, z + dz); }
  add('hang', plan.hang[0], plan.hang[1]);
  for (const r of plan.rooms || []) for (const [i, [x, z]] of (r.spots || []).entries()) if (r.kind !== 'kitchen' || coffee) add(`${r.kind} ${i}`, x, z);
  return spots;
}
