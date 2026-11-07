// Allowed character and decor options, shared by the customiser UI and the server's validators.
export const SKIN = ['#f6d7bd', '#eec39a', '#d9a06e', '#b97a4b', '#8d5a36', '#5e3b24', '#9fd0c0', '#c9b6e4'];
export const HAIR = ['none', 'short', 'side', 'long', 'bun', 'curly', 'mohawk', 'pigtails'];
export const HAIR_COLOR = ['#1f1a17', '#4a2f1d', '#8a5a2b', '#d9a441', '#b8442f', '#e8e2d6', '#6c7a89', '#d65db1', '#3f8efc', '#37b679'];
export const OUTFIT = ['suit', 'shirt', 'hoodie', 'tee', 'dress', 'labcoat', 'overalls'];
export const OUTFIT_COLOR = ['#27324a', '#3b3f46', '#8c2f39', '#2f6f62', '#c9772b', '#6a4c93', '#e6e0d2', '#2f7ec7', '#d94f70', '#111318'];
export const HAT = ['none', 'cap', 'beanie', 'tophat', 'crown', 'party', 'hardhat', 'headphones'];
export const GLASSES = ['none', 'round', 'shades'];
export const FLOOR_STYLES = ['wood', 'carpet', 'terrazzo', 'concrete'];
export const PETS = ['none', 'dog', 'cat'];

export const LOOK_FIELDS = {
  skin: SKIN, hair: HAIR, hairColor: HAIR_COLOR, outfit: OUTFIT, outfitColor: OUTFIT_COLOR, hat: HAT, glasses: GLASSES,
};

export const DEFAULT_LOOK = { skin: SKIN[0], hair: 'short', hairColor: HAIR_COLOR[1], outfit: 'suit', outfitColor: OUTFIT_COLOR[0], hat: 'none', glasses: 'none' };
export const DEFAULT_DECOR = { floor: 'wood', wall: '#e9e1d3', plants: 3, rug: true, art: true, coffee: true, arcade: false, neon: true, pet: 'none' };
export const DEFAULT_COLORS = { primary: '#d9774a', accent: '#f4c95d' };

// Deterministic staff looks, so a new floor always starts with a varied crew.
export function seededLook(seed) {
  const pick = (arr, salt) => arr[Math.abs(Math.imul(seed + salt, 2654435761)) % arr.length];
  return {
    skin: pick(SKIN.slice(0, 6), 11), hair: pick(HAIR.slice(1), 23), hairColor: pick(HAIR_COLOR, 37),
    outfit: pick(OUTFIT, 41), outfitColor: pick(OUTFIT_COLOR, 53),
    hat: seed % 5 === 0 ? pick(HAT.slice(1), 61) : 'none', glasses: seed % 4 === 1 ? 'round' : 'none',
  };
}

/** What people actually type for their floor when signing in: the name as they remember it, the slug, or the whole link. The same rules as the server's slugify. */
export const slugFrom = (text) => {
  const t = String(text || '').trim();
  const fromLink = t.match(/\/floor\/([a-z0-9-]+)/i);
  return (fromLink ? fromLink[1] : t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
};
