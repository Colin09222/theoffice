// AI_MODE=mock only. The scripted model reads the same system prompt a real one would and changes how it writes to suit, so a test can
// tell whether the boss's settings reached an agent by reading what that agent then wrote. If the settings don't arrive, nothing changes.
const TONE = {
  serious: { open: 'Understood.', close: '', swap: [[/\bLove it\.\s*/g, ''], [/\bboss\b/g, 'Director'], [/!/g, '.'], [/\bPull up a chair and watch\./g, 'Progress will be reported.'], [/Three angles/g, 'Three options']], doc: 'Prepared with care and reviewed for accuracy.', site: 'A considered page, prepared by the staff for your review.' },
  silly: { open: 'Honk honk!', close: 'The ducks approve.', swap: [[/\bboss\b/g, 'Supreme Boss'], [/\bLove it\./g, 'Splendid nonsense!'], [/\bPull up a chair and watch\./g, 'Fetch the good biscuits.']], doc: 'Assembled by tiny staff and one suspicious duck.', site: 'A gloriously silly page, assembled by tiny staff and one suspicious duck.' },
  punk: { open: 'right.', close: 'no meetings. no fluff.', swap: [[/\bboss\b/gi, 'chief'], [/\bLove it\./g, 'yeah, good.'], [/\bPull up a chair and watch\./g, 'watch us.']], doc: 'made loud. made fast. nobody asked permission.', site: 'made loud, made fast, nobody asked permission.' },
  corporate: { open: 'Per our alignment,', close: 'I will circle back with next steps.', swap: [[/\bboss\b/g, 'stakeholder'], [/\bLove it\./g, 'Great synergy.'], [/\bPull up a chair and watch\./g, 'Deliverables to follow.']], doc: 'Key deliverables and next steps are set out below.', site: 'A best-in-class deliverable, aligned with stakeholder needs.' },
  dreamy: { open: 'Softly now,', close: 'Like a light left on in a window.', swap: [[/\bboss\b/g, 'dear boss'], [/\bLove it\./g, 'What a lovely thought.'], [/\bPull up a chair and watch\./g, 'Sit a while, and watch it bloom.']], doc: 'Written slowly, in the hour the light goes gold.', site: 'A quiet page, like a light left on in a window.' },
  friendly: { open: '', close: '', swap: [], doc: 'Written with care by your team.', site: 'A friendly little page, made by your team.' },
};
const PERSON = {
  cheerful: 'What a treat to work on!', grumpy: 'Not that anyone asked how I feel about it.', dramatic: 'And so the quest ends, against all the odds.', nerdy: 'See the footnotes for the details.', zen: 'It is done.', pirate: 'Arr, she be finished.', hype: 'This is the best thing ever made!', deadpan: 'It is adequate.', steady: '',
};
const settingsOf = (messages) => {
  const sys = typeof messages?.[0]?.content === 'string' ? messages[0].content : '';
  return sys.match(/<boss_settings>\n([\s\S]*?)\n<\/boss_settings>/)?.[1] || '';
};
const line = (block, label) => block.match(new RegExp(`^${label}: (\\S+?)\\.(?: |$)`, 'm'))?.[1] || '';

/** Who wrote this and how they sound, read only from the system prompt. */
export function voiceOf(messages) {
  const block = settingsOf(messages);
  const sys = typeof messages?.[0]?.content === 'string' ? messages[0].content : '';
  return {
    any: !!block, tone: line(block, 'Tone of voice'), person: line(block, 'Your personality'),
    name: sys.match(/^You are ([^,\n]{1,40}), the /m)?.[1] || '', title: block.match(/^Your job title: (.+?)\. Write/m)?.[1] || '',
    avoid: block.match(/^Always avoid: (.+)$/m)?.[1] || '',
    routes: Object.fromEntries([...(block.match(/^Who does what: ([^\n]+?)\. If nobody/m)?.[1] || '').matchAll(/(words|facts|looks) go to the (\w+)/g)].map((m) => [m[1], m[2]])),
  };
}
const dodge = (text, avoid) => {
  // A word the boss banned doesn't get written. Only single words and short phrases, split on commas: this is a mock, not a censor.
  let out = text;
  for (const w of avoid.split(/[,;]| and /).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 40)) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '(a word the boss bans)');
  return out;
};
const FIRST_ROLE = { words: 'writer', facts: 'researcher', looks: 'designer' };
const say = (text, t) => { let out = text; for (const [a, b] of t.swap) out = out.replace(a, b); return `${t.open ? `${t.open} ` : ''}${out}${t.close ? ` ${t.close}` : ''}`; };

/** Rewrites one scripted step to suit the voice. A step with no settings behind it comes back untouched. */
export function voiced(step, messages, kind) {
  const v = voiceOf(messages);
  if (!v.any) return step;
  const t = TONE[v.tone] || null;
  const personal = PERSON[v.person] || '';
  const out = { ...step };
  if (out.content) {
    let c = t ? say(out.content, t) : out.content;
    if (kind !== 'manager' && personal) c = `${c} ${personal}`;
    if (v.avoid) c = dodge(c, v.avoid);
    out.content = c;
  }
  if (out.toolCalls) out.toolCalls = out.toolCalls.map((call) => {
    let args; try { args = JSON.parse(call.args); } catch { return call; }
    if (kind === 'manager' && call.name === 'assign_task') {
      const from = Object.entries(FIRST_ROLE).find(([, role]) => role === args.to)?.[0];
      if (from && v.routes[from]) args.to = v.routes[from];
    }
    if (call.name === 'write_file' && typeof args.content === 'string') {
      let c = args.content;
      if (t && /\.md$/.test(args.path || '')) c = `${c.trimEnd()}\n\n${t.doc}\n`;
      if (t && /\.html?$/.test(args.path || '')) c = c.replace('A real page, written by a tiny staff while you watched.', t.site);
      if (/\.md$/.test(args.path || '') && (v.title || personal)) c = `${c.trimEnd()}\n\nSigned, ${v.name}${v.title ? `, ${v.title}` : ''}.${personal ? ` ${personal}` : ''}\n`;
      if (v.avoid) c = dodge(c, v.avoid);
      args.content = c;
    }
    return { ...call, args: JSON.stringify(args) };
  });
  return out;
}
