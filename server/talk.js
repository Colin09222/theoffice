// What people on a floor really said to each other when work passed between them. A line is always cut from something real (the manager's
// assignment, a staff report, a question, a review note) and never written here. Cutting takes out what a speech bubble shouldn't carry:
// markdown, code, the secret part of a link, and any dollar figure, which stays with the building manager.
import { amounts } from './budget.js';

const MAX = 170;
// What the first pattern and the ledger's scrubber leave: a figure with no leading digit, the sign after it, and a dollar in words.
const MONEY_LOOSE = /\$\s?\.\d+|\b\d[\d,.]*\s?(?:k|m)?\s?(?:\$|¢|usd\b)|\b(?:half an?|quarter of an?|an?)\s(?:dollar|buck)\b/gi;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MONEY = /(?:(?:us|ca|au)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|thousand|million|billion)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:usd|dollars?|bucks|cents)\b|\busd\s?\d[\d,]*(?:\.\d+)?)/gi;

export function talkLine(raw, max = MAX) {
  let s = String(raw ?? '').replace(/```[\s\S]*?(```|$)/g, ' ');   // code is not conversation
  s = s.replace(/\[[a-z]+(?::[a-z0-9-]+)?\]/g, ' ')                // the mock's scenario tags
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')                   // a markdown link keeps its words
    .replace(/https?:\/\/[^\s)>\]]+/gi, (u) => u.replace(/[?#].*$/, '').replace(/\/~p\d+\.[^/]+/g, ''))  // a signed link's secret is in its query, or for a private preview in its path
    .replace(/^#{1,6}\s+/gm, '').replace(/[*_`~]+/g, '').replace(/^\s*[-+]\s+/gm, '')
    .replace(CONTROL, ' ').replace(MONEY, 'an amount').replace(amounts, 'an amount').replace(MONEY_LOOSE, 'an amount').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  // Whole sentences when they fit, otherwise whole words.
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end >= 50) return cut.slice(0, end + 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > 40 ? cut.slice(0, word) : cut).replace(/[\s,;:(-]+$/, '')}…`;
}

// What a visitor reads in place of words that aren't theirs to read. The people still walk over; only the words change.
export const PRIVATE_TALK = 'Talking about something private.';
export const BOSS_ONLY_TALK = { question: 'I have a question for the boss.', answer: 'The boss has answered.' };
