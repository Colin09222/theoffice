// Allowed character and decor options, shared by the customiser UI and the server's validators.
// New options go at the end of each list: seededLook only ever draws from the first entries, so new floors keep their ordinary crew.
export const SKIN = ['#f6d7bd', '#eec39a', '#d9a06e', '#b97a4b', '#8d5a36', '#5e3b24', '#9fd0c0', '#c9b6e4', '#ffe3d0', '#3f2a1c', '#a9c6ea', '#b7dd9f'];
export const HAIR = ['none', 'short', 'side', 'long', 'bun', 'curly', 'mohawk', 'pigtails'];
export const HAIR_COLOR = ['#1f1a17', '#4a2f1d', '#8a5a2b', '#d9a441', '#b8442f', '#e8e2d6', '#6c7a89', '#d65db1', '#3f8efc', '#37b679', '#f27d2e', '#8f6ee0'];
export const OUTFIT = ['suit', 'shirt', 'hoodie', 'tee', 'dress', 'labcoat', 'overalls'];
export const OUTFIT_COLOR = ['#27324a', '#3b3f46', '#8c2f39', '#2f6f62', '#c9772b', '#6a4c93', '#e6e0d2', '#2f7ec7', '#d94f70', '#111318', '#f2b632', '#37b679'];
export const HAT = ['none', 'cap', 'beanie', 'tophat', 'crown', 'party', 'hardhat', 'headphones', 'cowboy', 'wizard', 'chef', 'viking', 'pirate', 'beret', 'propeller', 'halo'];
export const GLASSES = ['none', 'round', 'shades', 'monocle', 'eyepatch'];
export const EXTRA = ['none', 'beard', 'moustache', 'scarf', 'bowtie', 'tie', 'badge', 'cape', 'backpack', 'wings'];
// The twelve people in Kenney's Mini Characters. Each has their own face, clothes and hair shape.
export const BODY = ['auto', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'];
export const FLOOR_STYLES = ['wood', 'carpet', 'terrazzo', 'concrete', 'parquet', 'checker', 'tile', 'rubber'];
export const PETS = ['none', 'dog', 'cat', 'bunny', 'duck', 'tortoise', 'robot'];
export const LAYOUTS = ['open', 'studio', 'garage', 'lounge', 'pods'];
export const WALL_MATS = ['paint', 'brick', 'wood', 'panels', 'concrete'];
export const ART_STYLES = ['shapes', 'skyline', 'posters', 'logo'];

export const LOOK_FIELDS = {
  skin: SKIN, hair: HAIR, hairColor: HAIR_COLOR, outfit: OUTFIT, outfitColor: OUTFIT_COLOR, hat: HAT, glasses: GLASSES, extra: EXTRA, body: BODY,
};

export const DEFAULT_LOOK = { skin: SKIN[0], hair: 'short', hairColor: HAIR_COLOR[1], outfit: 'suit', outfitColor: OUTFIT_COLOR[0], hat: 'none', glasses: 'none', extra: 'none', body: 'auto' };
export const DEFAULT_DECOR = { layout: 'open', floor: 'wood', wall: '#e9e1d3', wallMat: 'paint', artStyle: 'shapes', plants: 3, rug: true, art: true, coffee: true, arcade: false, neon: true, pet: 'none' };
export const DEFAULT_COLORS = { primary: '#d9774a', accent: '#f4c95d' };

// Deterministic staff looks, so a new floor always starts with a varied crew.
export function seededLook(seed) {
  const pick = (arr, salt) => arr[Math.abs(Math.imul(seed + salt, 2654435761)) % arr.length];
  return {
    skin: pick(SKIN.slice(0, 6), 11), hair: pick(HAIR.slice(1), 23), hairColor: pick(HAIR_COLOR.slice(0, 10), 37),
    outfit: pick(OUTFIT, 41), outfitColor: pick(OUTFIT_COLOR.slice(0, 10), 53),
    hat: seed % 5 === 0 ? pick(HAT.slice(1, 8), 61) : 'none', glasses: seed % 4 === 1 ? 'round' : 'none', extra: 'none', body: 'auto',
  };
}

// ---- how the company sounds ----
// These are fixed lists, so nothing typed here can reach a prompt. `say` is what the panel shows as a sample line.
export const TONES = {
  friendly: { label: 'Friendly', line: 'Warm, plain and encouraging, with the odd light joke.', say: 'Morning, boss. Nice idea. Here is how I would start.' },
  serious: { label: 'Serious', line: 'Formal, precise and restrained. No jokes, no exclamation marks, no slang.', say: 'Understood. I will set out the options and the order of work.' },
  silly: { label: 'Silly', line: 'Playful and absurd. Daft comparisons, happy nonsense and running jokes, while the work itself stays correct.', say: 'Splendid nonsense, Supreme Boss! I have assembled the ducks.' },
  punk: { label: 'Punk', line: 'Blunt, loud and anti-corporate. Short sentences, lower case where it fits, no marketing speak and no apologies.', say: 'right. no meetings, no fluff. we build it tonight.' },
  corporate: { label: 'Corporate', line: 'Polished business language: stakeholders, deliverables, next steps and tidy bullet points.', say: 'Per our alignment, I will circle back with deliverables and next steps.' },
  dreamy: { label: 'Dreamy', line: 'Soft, poetic and unhurried. Gentle images and short lyrical lines, while the facts stay exact.', say: 'A small idea, boss, like a light left on in a window. Let us follow it.' },
};
export const PERSONALITIES = {
  steady: { label: 'Steady', line: 'Calm and practical. You just get on with it.' },
  cheerful: { label: 'Cheerful', line: 'Sunny and encouraging. You are delighted to be here.' },
  grumpy: { label: 'Grumpy', line: 'Grumbles about everything and does excellent work anyway.' },
  dramatic: { label: 'Dramatic', line: 'Everything is a grand saga. Small tasks are epic quests.' },
  nerdy: { label: 'Nerdy', line: 'Loves details, footnotes and exact numbers.' },
  zen: { label: 'Zen', line: 'Unhurried and few of words. Says only what matters.' },
  pirate: { label: 'Pirate', line: 'Talks like an old sea pirate, and keeps the work itself clear.' },
  hype: { label: 'Hype', line: 'Pure enthusiasm. Everything is the best thing ever made.' },
  deadpan: { label: 'Deadpan', line: 'Bone dry. Understates everything and never admits to a joke.' },
};
// Who gets each kind of work when there is a choice. Only roles that can really do the job are offered.
export const WORK_KINDS = {
  words: { label: 'Words', roles: ['writer', 'marketer'] },
  facts: { label: 'Facts', roles: ['researcher', 'analyst'] },
  looks: { label: 'Looks', roles: ['designer', 'illustrator'] },
};

// ---- presets ----
// One tap sets the feel of the whole floor. Everything here is a value the validators already accept, and all of it can still be changed by hand.
export const VIBES = {
  serious: { label: 'Serious firm', blurb: 'Wood panels, carpet, quiet voices.', tone: 'serious', colors: { primary: '#27324a', accent: '#c9a24b' }, decor: { layout: 'open', floor: 'parquet', wall: '#d8cfc0', wallMat: 'wood', artStyle: 'shapes', plants: 2, rug: true, art: true, coffee: true, arcade: false, neon: false, pet: 'none' } },
  silly: { label: 'Silly startup', blurb: 'Checker floor, a duck, an arcade machine.', tone: 'silly', colors: { primary: '#e0559b', accent: '#ffd23f' }, decor: { layout: 'lounge', floor: 'checker', wall: '#fff0d6', wallMat: 'paint', artStyle: 'posters', plants: 5, rug: true, art: true, coffee: true, arcade: true, neon: true, pet: 'duck' } },
  punk: { label: 'Punk garage', blurb: 'Brick, concrete, boxes and a robot.', tone: 'punk', colors: { primary: '#d3264f', accent: '#27e6a4' }, decor: { layout: 'garage', floor: 'concrete', wall: '#8f6a58', wallMat: 'brick', artStyle: 'posters', plants: 1, rug: false, art: true, coffee: true, arcade: true, neon: true, pet: 'robot' } },
  corporate: { label: 'Corporate tower', blurb: 'Carpet tiles, pods and tidy glass.', tone: 'corporate', colors: { primary: '#1f5fa8', accent: '#9ec5e8' }, decor: { layout: 'pods', floor: 'carpet', wall: '#e8ebee', wallMat: 'panels', artStyle: 'skyline', plants: 4, rug: false, art: true, coffee: true, arcade: false, neon: false, pet: 'none' } },
  cosy: { label: 'Cosy studio', blurb: 'A big shared table, art and a cat.', tone: 'friendly', colors: { primary: '#c8643c', accent: '#f0c068' }, decor: { layout: 'studio', floor: 'wood', wall: '#f1e6d4', wallMat: 'paint', artStyle: 'logo', plants: 6, rug: true, art: true, coffee: true, arcade: false, neon: true, pet: 'cat' } },
  dreamy: { label: 'Dreamy lounge', blurb: 'Sofas, soft colours and a bunny.', tone: 'dreamy', colors: { primary: '#7a6fd0', accent: '#f6b6c8' }, decor: { layout: 'lounge', floor: 'terrazzo', wall: '#e8e2f4', wallMat: 'concrete', artStyle: 'skyline', plants: 8, rug: true, art: true, coffee: true, arcade: false, neon: true, pet: 'bunny' } },
};
// One tap for a person. Colours are left alone unless the look needs them.
export const CHARACTER_PRESETS = {
  founder: { label: 'Founder', look: { body: 'male-d', hat: 'none', glasses: 'none', extra: 'none', outfit: 'suit', outfitColor: '#27324a' } },
  hacker: { label: 'Hacker', look: { body: 'male-f', hat: 'headphones', glasses: 'shades', extra: 'none', outfit: 'hoodie', outfitColor: '#111318' } },
  scientist: { label: 'Scientist', look: { body: 'female-e', hat: 'none', glasses: 'round', extra: 'badge', outfit: 'labcoat', outfitColor: '#e6e0d2' } },
  chef: { label: 'Chef', look: { body: 'male-b', hat: 'chef', glasses: 'none', extra: 'scarf', outfit: 'labcoat', outfitColor: '#e6e0d2' } },
  wizard: { label: 'Wizard', look: { body: 'male-b', hat: 'wizard', glasses: 'none', extra: 'cape', outfit: 'dress', outfitColor: '#6a4c93' } },
  pirate: { label: 'Pirate', look: { body: 'male-f', hat: 'pirate', glasses: 'eyepatch', extra: 'none', outfit: 'shirt', outfitColor: '#8c2f39' } },
  rocker: { label: 'Rocker', look: { body: 'female-f', hat: 'none', glasses: 'shades', extra: 'none', hair: 'mohawk', hairColor: '#d65db1', outfit: 'tee', outfitColor: '#111318' } },
  royal: { label: 'Royal', look: { body: 'female-d', hat: 'crown', glasses: 'monocle', extra: 'cape', outfit: 'dress', outfitColor: '#8c2f39' } },
  cowboy: { label: 'Cowboy', look: { body: 'male-c', hat: 'cowboy', glasses: 'none', extra: 'bowtie', outfit: 'shirt', outfitColor: '#c9772b' } },
  angel: { label: 'Angel', look: { body: 'female-b', hat: 'halo', glasses: 'none', extra: 'wings', outfit: 'dress', outfitColor: '#e6e0d2' } },
};

/** A random look from the full lists, for "Surprise me". `rand` is injectable so tests can pin it. */
export function randomLook(rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  return { skin: pick(SKIN), hair: pick(HAIR), hairColor: pick(HAIR_COLOR), outfit: pick(OUTFIT), outfitColor: pick(OUTFIT_COLOR), hat: rand() < 0.6 ? pick(HAT.slice(1)) : 'none', glasses: rand() < 0.35 ? pick(GLASSES.slice(1)) : 'none', extra: rand() < 0.4 ? pick(EXTRA.slice(1)) : 'none', body: pick(BODY) };
}
