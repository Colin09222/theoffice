// AI_MODE=mock: deterministic scripted model. It speaks the same interface as the real client and returns real tool calls,
// so every test drives the actual tool loop, ledger, limiter and SSE paths with no key and no spend.
// Keywords in the boss's message pick scenarios: [ask] [mgrask] [buy] [hire] [fail] [private] [spendy] [slow] [ssrf] [traverse] [inject] [revise] [web] [standing] [cancelorder] [help] [lane:game] [colleague] [rename] [letgo] [logo].
// Work modes: "work nonstop", "work 9 to 5 on weekdays" and "only when I ask" set the mode, and a "Work mode:" note runs the next job off the list.
// A goal holding [ask] or [buy] passes it on to that job's brief, and [build] or [buy] hands the job to the builder or the researcher.
// With no goal, a "Goal needed:" note (or turning the mode on by chat) gets three goals to pick from; the boss picks one by number or says their
// own ("our goal is ..."). A goal holding [reach] is reached by the first job, and the mock proposes the next one.
// A floor with no name yet is set up by chat: "called Something" or "you pick" makes the company.
import { ProviderError } from './llm.js';
import { voiced } from './mock-voice.js';

const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); res(); }, ms);
  const onAbort = () => { clearTimeout(t); rej(signal.reason); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
});
const call = (name, args, i = 0) => ({ id: `mock_${name}_${i}`, name, args: JSON.stringify(args) });
const ACT = /\b(go|build|make|do it|start|create|launch|ship|act)\b/i;

const SITE = (name, brief) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><link rel="stylesheet" href="style.css"></head>
<body><main><p class="kicker">Made on this floor</p><h1>${name}</h1><p>${brief}</p>
<button id="b">Clap for the staff</button> <output id="o">0 claps</output></main><script src="app.js"></script></body></html>`;
const CSS = `:root{--ink:#1d2433;--paper:#f7f1e3;--hot:#d9774a}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:18px/1.5 Georgia,serif;padding:24px}main{max-width:34em}h1{font-size:3rem;line-height:1.05;margin:.2em 0}.kicker{letter-spacing:.14em;text-transform:uppercase;font:12px ui-monospace,monospace;color:var(--hot)}button{font:inherit;padding:.5em 1em;border:0;border-radius:99px;background:var(--hot);color:#fff;cursor:pointer}`;
const JS = `let n=0;const o=document.getElementById('o');document.getElementById('b').addEventListener('click',()=>{n++;o.textContent=n+(n===1?' clap':' claps')});`;
const EVIL = `<!doctype html><title>probe</title><h1 id="r">probe</h1><script>let c='none';try{c=document.cookie}catch(e){c='blocked:'+e.name}document.getElementById('r').textContent=c</script>`;

const LANE_OPENERS = {
  game: 'A game! Three small ideas, boss:\n\n1. **Pigeon Post:** dodge the wind.\n2. **Night Bakery:** catch falling buns.\n3. **Tiny Tide:** outrun the sea.\n\nPick one, or tell me to choose.',
  website: 'A website! Two quick questions, boss: what is it for, and what should a visitor do when they get there?',
  business: 'A small business! What is the idea, and who is it for? If you have none yet I can suggest three. Nobody here can post, run ads or spend money, and email to anyone new waits for your OK, so you will get research, a plan and a page, plus a list of what only you can do.',
};

// The cheap model: what people say to each other, written from the facts it was handed, and always in the JSON the real one is asked for.
const ACCENTS = ['short bursts', 'long loops', 'exact odds', 'gentle asides', 'sharp questions', 'old proverbs', 'lists of three', 'whispers'];
function talkStep(meta) {
  const [a, b] = meta.speakers || [];
  switch (meta.purpose) {
    case 'persona': return JSON.stringify({ people: meta.people.map((p, i) => ({ name: p.name, persona: `${p.name} talks in ${ACCENTS[i % ACCENTS.length]}.`, bio: `${p.name} came here from ${['a ferry', 'a bakery', 'a quarry', 'a theatre', 'a lighthouse'][i % 5]}.`, quirk: `${p.name} counts ${['stairs', 'pens', 'clouds', 'spoons', 'doors'][i % 5]}.`, mood: 'curious' })) });
    case 'memory': return JSON.stringify({ note: `I ${meta.status === 'failed' ? 'could not finish' : 'finished'} "${meta.title}", and I'd start sooner next time.`, mood: meta.status === 'failed' ? 'frustrated' : 'proud' });
    case 'answer': return `${meta.answerer} here. About that: ${meta.notes?.at(-1) || 'I have not done anything on that yet'}`;
    case 'meeting': return JSON.stringify({ lines: meta.trigger === 'plan'
      ? [{ who: a, text: `"${meta.titles[0]}" goes first. Who is nervous?` }, { who: b, text: `Not me. Ask me again once "${meta.titles.at(-1)}" is on my desk.` }]
      : [{ who: b, text: `"${meta.titles.at(-1)}" is with you now.` }, { who: a, text: `Then I'll read the report before I say anything.` }] });
    case 'banter': return JSON.stringify({ lines: [{ who: a, text: `I can't stop thinking about "${meta.title}" (${meta.said?.length ?? 0}).` }, { who: b, text: `You said that about the last one (${meta.said?.length ?? 0}).` }] });
    default: return '';
  }
}

const DAYS_SAID = [[/weekends?/i, ['sat', 'sun']], [/every ?day|daily/i, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']], [/./, ['mon', 'tue', 'wed', 'thu', 'fri']]];
const MODE_SAID = /\b(work(?:ing)? nonstop|work(?:ing)? 24\/7|only when i ask|work(?:ing)? \d{1,2}(?::\d\d)? ?(?:to|-|–) ?\d{1,2})/i;
// What a mock manager thinks of next, in order, when the team works on its own.
const NEXT_IDEAS = ['Write a one-page plan for the company', 'Draft the launch post', 'Make a pricing page', 'Write three customer stories', 'Plan a launch week', 'Tidy the shared drive'];
const topUp = (list, done = '') => [...list, ...NEXT_IDEAS.filter((x) => x !== done && !list.includes(x))].slice(0, 3);
// The goals a mock manager offers when a work mode has none, and the one it proposes when a goal is reached.
const GOAL_IDEAS = ['Get our first 100 visitors', 'Publish three pages people come back to', 'Launch the shop with 10 products'];
const NEXT_GOAL = 'Get our first 1,000 visitors';
const proposeGoals = () => `Before the team works on its own, we need one clear goal. I'd suggest:\n${GOAL_IDEAS.map((g, i) => `${i + 1}. ${g}`).join('\n')}\nPick one, or tell me your own.`;
function goalPicked(boss) {
  const own = boss.match(/\bgoal\b\s*(?:is|:|-)?\s*(.+)$/i)?.[1]?.trim();
  if (own) return own.slice(0, 200);
  const n = Number(boss.match(/\b([1-3])\b/)?.[1]) || { first: 1, second: 2, third: 3 }[boss.match(/\b(first|second|third)\b/i)?.[1]?.toLowerCase()];
  return n ? GOAL_IDEAS[n - 1] : boss.trim().slice(0, 200);
}
// A goal said with the mode ("work nonstop, our goal is ...") goes with it.
function modeArgs(boss) {
  const goal = /only when i ask/i.test(boss) ? '' : boss.match(/\bgoal\b\s*(?:is|:|-)?\s*(.+)$/i)?.[1]?.trim();
  return { ...modeSaid(boss), ...(goal ? { goal } : {}) };
}
function modeSaid(boss) {
  if (/only when i ask/i.test(boss)) return { mode: 'ask' };
  if (/nonstop|24\/7/i.test(boss)) return { mode: 'nonstop' };
  const m = boss.match(/work(?:ing)? (\d{1,2})(?::(\d\d))? ?(?:to|-|–) ?(\d{1,2})(?::(\d\d))?/i);
  const start = Number(m[1]); let end = Number(m[3]);
  if (end <= start && end <= 12) end += 12;
  const pad = (h, mm) => `${String(h % 24).padStart(2, '0')}:${mm || '00'}`;
  return { mode: 'hours', start: pad(start, m[2]), end: pad(end, m[4]), days: DAYS_SAID.find(([re]) => re.test(boss))[1] };
}

// Business mode (server/business.js), scripted. The ideas cite only pages the mock search really returned on this floor.
const BUSINESS_ASK = /\bbusiness idea\b/i;
const IDEA_LINKS = { findings: 'https://example.com/findings', dogs: 'https://example.org/dog-grooming-at-home', meals: 'https://example.org/meal-prep-for-shift-workers' };
function ideaCards(unsourced) {
  const ev = (k, shows) => ({ url: IDEA_LINKS[k], title: k, shows });
  return {
    ideas: [
      { name: 'Doorstep Dog Groom', who_pays: 'Busy dog owners', problem: 'Grooming salons are booked up for weeks', what_you_sell: unsourced ? 'Home grooming visits in a $2 billion market' : 'Home grooming visits booked online', why_now: 'More people work from home and want services that come to them',
        evidence: [ev('findings', 'Small services that come to you tend to do well'), ev('dogs', 'Owners complain that salons have long waits')],
        revenue: { low: 2000, high: 6000, per: 'month', assumptions: [{ text: 'Between 20 and 60 visits a month at a planned price', source_url: IDEA_LINKS.dogs }] } },
      { name: 'Shift Supper', who_pays: 'Nurses and other night-shift workers', problem: 'Nothing healthy is open when their shift ends', what_you_sell: 'A weekly box of ready meals for the night shift', why_now: 'Meal prep is popular and shift work is not going away',
        evidence: [ev('meals', 'Shift workers ask for meals that suit odd hours'), ev('findings', 'Small things that work tend to do well')] },
      { name: 'Night Desk Notes', who_pays: 'Shift supervisors', problem: 'Handover notes get lost between shifts', what_you_sell: 'A simple handover notebook app', why_now: 'Teams already share notes on their phones',
        evidence: [ev('meals', 'Night-shift teams describe messy handovers'), ev('findings', 'Simple tools that do one job well')] },
    ],
    markets_checked: ['Pet services at home', 'Meals for shift workers'],
    compared: [{ idea: 'Doorstep Dog Groom', verdict: 'Clear demand and simple to start' }, { idea: 'Shift Supper', verdict: 'Real need, harder to deliver' }, { idea: 'Dog cafe', verdict: 'Dropped: it needs premises' }],
  };
}
const OFFER = '# The offer\n\nHome grooming visits, booked online. Planned price: $45 a visit (planned, not final).\n\n- Comes to you\n- No salon wait\n- Calm, one dog at a time\n\nNot open yet: join the notify-me list.\n';
const PRICES = '# Rival prices\n\n- Salon A: $60 a groom (https://example.org/dog-grooming-at-home)\n- Mobile van B: could not confirm a price\n';
function businessManager(meta, boss) {
  const b = meta.business;
  // A boss line that arrived while another turn was running is still theirs to answer.
  const fresh = meta.isFreshBoss || !!meta.bossTurn;
  if (fresh && !b && BUSINESS_ASK.test(boss)) {
    if (meta.step === 0) return { toolCalls: [call('start_business', { wish: boss.replace(/^.*?build it[:.]?\s*/i, '') })] };
    return { content: 'Business mode is on, boss. The researcher is out looking for ideas now, and the cards will appear on the floor.' };
  }
  if (!b) return null;
  if (fresh) {
    if (/other ideas/i.test(boss)) return meta.step === 0 ? { toolCalls: [call('business_action', { action: 'more_ideas', notes: boss })] } : { content: 'Fresh ideas are on their way, boss.' };
    if (/skip ads/i.test(boss)) {
      if (meta.step === 0) return { toolCalls: [call('business_action', { action: 'skip_ads' })] };
      if (meta.step === 1) return { toolCalls: [call('launch_report', { project: b.project, headline: 'It is live.', next_steps: 'Send the link to ten people who have this problem.' })] };
      return { content: 'Launched without ads, boss. We can make some any time.' };
    }
    if (/change the ads/i.test(boss)) return meta.step === 0 ? { toolCalls: [call('business_action', { action: 'redo_ads', notes: boss })] } : { content: 'The team is remaking the ads now.' };
    if (/^let's go with/i.test(boss)) return { content: 'Great pick, boss. The four tracks are lighting up on the floor now.' };
    if (BUSINESS_ASK.test(boss)) return { content: 'On it, boss. The researcher is out looking, and the cards will appear on the floor.' };
    return { content: `Good question, boss. ${b.step === 'idea' ? 'Each card shows who pays, their problem and the pages it came from.' : 'The tracks on the floor show where everything stands, live.'}` };
  }
  // At launch it goes by where things stand, not by which note came last: a turn already running can swallow the note.
  if (b.step === 'launch' && !b.reported && !fresh) {
    const calls = [];
    if (b.adMoney > 0 && !b.adSpend) calls.push(call('request_ad_spend', { amount: b.adMoney, audience: 'Dog owners nearby who work from home', ads: ['ad-1.png', 'video-1.mp4'] }));
    calls.push(call('launch_report', { project: b.project, headline: 'It is live.', next_steps: 'Share the ads and the link with ten people who have this problem.' }));
    if (meta.step < calls.length) return { toolCalls: [calls[meta.step]] };
    return { content: b.adMoney > 0 && !b.adSpend ? 'The ad request is on the floor for your one click, boss. After that it is queued for the building manager.' : 'We are live, boss. The ads are on the floor to share.' };
  }
  if (b.note && !fresh) {
    return { content: 'Business mode, boss: the team is on the next step. Ask me anything.' };
  }
  return null;
}
// The shop lane's staff: the Writer lists the products, the Designer draws a picture for each, the Builder fills the starter's shop.json, the Tester
// reports, and the Builder's last task puts it live. What they write is a real, whole catalogue, so the checklist and the boss's approvals see a real shop.
const SHOP_PRODUCTS = [
  { key: 'first-visit', name: 'First visit', description: 'One full visit at your door, booked for a time that suits you.', price: 45, priceFrom: 'proposed', image: 'images/first-visit.svg', imageKind: 'illustration', ships: false },
  { key: 'care-kit', name: 'Care kit', description: 'Brush, comb and a tin of balm, posted to you.', price: 18.5, priceFrom: 'proposed', image: 'images/care-kit.svg', imageKind: 'illustration', ships: true },
];
const SHOP_PICTURE = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${fill}"/><circle cx="200" cy="200" r="120" fill="#fff8"/></svg>`;
function shopStaff(meta) {
  const { role, task } = meta;
  if (task.lane !== 'shop') return null;
  const b = task.brief || '', dir = `projects/${task.project}`;
  if (role === 'researcher') return null;
  if (role === 'writer') return [
    call('write_file', { path: `${dir}/notes/brief.md`, content: '# Brief\n\nA small shop. A visitor should buy the first visit.\n' }),
    call('write_file', { path: `${dir}/notes/copy.md`, content: '# Copy\n\nTitle: Doorstep Dog Groom\n\nGrooming that comes to you.\n' }),
    call('write_file', { path: `${dir}/notes/products.md`, content: `# Products\n\n${SHOP_PRODUCTS.map((p) => `- ${p.key}: ${p.name}. ${p.description} Proposed price ${p.price}. ${p.ships ? 'Posted.' : 'Not posted.'} Needs a picture.`).join('\n')}\n` }),
    ...(/notes\/offer\.md/.test(b) ? [call('write_file', { path: `${dir}/notes/offer.md`, content: OFFER })] : []),
  ];
  if (role === 'designer') return [
    call('write_file', { path: `${dir}/notes/design.md`, content: '# The look\n\nWarm paper and one bold colour. Pictures: images/first-visit.svg, images/care-kit.svg.\n' }),
    call('write_file', { path: `${dir}/images/first-visit.svg`, content: SHOP_PICTURE('#d2552b') }),
    call('write_file', { path: `${dir}/images/care-kit.svg`, content: SHOP_PICTURE('#1b2a22') }),
  ];
  if (role === 'tester') return [call('write_file', { path: `${dir}/TEST-REPORT.md`, content: '# Test report\n\nPASS. Added two things to the basket, changed a quantity, sent an order request. Nobody has opened it in a browser.\n' })];
  if (role === 'builder') {
    const publish = call('publish_project', { project: task.project, title: 'Doorstep Dog Groom', description: 'Dog grooming that comes to your door, and a care kit by post.', kind: 'site' });
    if (/read TEST-REPORT\.md/.test(b)) return [call('read_file', { path: `${dir}/TEST-REPORT.md` }), publish];
    const fill = [call('read_file', { path: `${dir}/STARTER.md` }), call('write_file', { path: `${dir}/shop.json`, content: JSON.stringify({ currency: 'usd', delivery: '', products: SHOP_PRODUCTS }, null, 2) })];
    return /don't publish|do not publish/i.test(b) ? fill : [...fill, publish];
  }
  return null;
}

function businessStaff(meta) {
  const { role, task } = meta;
  const b = task.brief || '';
  if (!/^Business mode/.test(b)) return null;
  const p = task.project || 'project';
  if (/propose_ideas/.test(b)) {
    const bad = /\[unsourced\]/.test(b);
    return [call('web_search', { query: 'dog grooming at home' }), call('web_search', { query: 'meal prep for shift workers' }), ...(bad ? [call('propose_ideas', ideaCards(true))] : []), call('propose_ideas', ideaCards(false))];
  }
  if (/picture ads/.test(b)) return [call('generate_image', { prompt: 'A friendly illustrated advert', name: 'ad-1', project: p, directory: 'ads', aspect: '1:1' }), call('generate_image', { prompt: 'A tall illustrated advert', name: 'ad-2', project: p, directory: 'ads', aspect: '9:16' })];
  if (/save_ad_plan/.test(b)) {
    const fail = /\[videofail\]/.test(meta.allBoss || '') ? ' [videofail]' : '';
    return [call('save_ad_plan', { headline: 'Grooming that comes to you', primary_text: 'Doorstep Dog Groom brings the salon to your door. Join the notify-me list.', goal: 'Sign-ups for the notify-me list', who: 'Dog owners nearby who work from home', test_a: 'Headline: Grooming that comes to you', test_b: 'Headline: No more salon waits', test_measure: 'More sign-ups per click', search_headlines: [/\[longheadline\]/.test(meta.allBoss || '') ? 'Dog grooming that comes right to your own front door' : 'Dog Grooming at Your Door', 'No More Salon Waits', 'Calm, One Dog at a Time', 'Join the Notify-Me List'], search_descriptions: ['Home grooming visits, booked online. Comes to you, calm and one dog at a time.', 'Not open yet: join the notify-me list and hear first when bookings open.'], keywords: ['mobile dog grooming', 'dog grooming at home', 'dog groomer near me', 'in home dog grooming'], path1: 'grooming' }),
      call('make_video_ad', { project: p, name: 'video-1', prompt: `A happy dog being groomed at home${fail}`, caption: 'Grooming that comes to you', seconds: 6 }),
      call('make_video_ad', { project: p, name: 'video-2', prompt: `A calm grooming visit on a doorstep${fail}`, caption: 'Join the notify-me list', seconds: 8 })];
  }
  if (/Record the site/.test(b)) return [];
  if (/notes\/look\.md/.test(b) && role !== 'builder') return [call('write_file', { path: `projects/${p}/style.css`, content: CSS }), call('write_file', { path: `projects/${p}/notes/look.md`, content: '# The look\n\nWarm paper and one bold colour.\n' })];
  if (/notes\/offer\.md/.test(b) && role !== 'builder') return [call('write_file', { path: `projects/${p}/notes/offer.md`, content: OFFER })];
  if (/notes\/prices\.md/.test(b) && role !== 'builder') return [call('write_file', { path: `projects/${p}/notes/prices.md`, content: PRICES })];
  return null;
}

function managerStep(meta, messages = []) {
  const boss = meta.lastBoss || '';
  const slug = meta.slugFor(boss);
  // Business mode comes first: "build it" would otherwise set off an ordinary plan.
  const biz = businessManager(meta, boss);
  if (biz) return biz;
  // A company made by talking. It comes before everything else: nothing else makes sense until there is a company.
  if (meta.setup && meta.isFreshBoss && !meta.toReview.length) {
    const called = boss.match(/called ([A-Z][\w' -]{1,40}?)(?:[.,!]|$)/)?.[1];
    if (meta.step > 0) return { content: 'There you go. What should we all start on?' };
    if (called || /you pick/i.test(boss)) return { toolCalls: [call('set_company', { name: called || 'Tiny Soup Company', tagline: 'Strong views, served warm.', what_it_does: boss.slice(0, 200), tone: 'silly', vibe: 'silly', layout: 'pods', primary_color: '#123456' })] };
    return { content: 'Good start. What should we call it, and who is it for? Say "you pick" and I will choose.' };
  }
  if (/\[(rename|letgo|logo)\]/.test(boss) && meta.isFreshBoss && !meta.toReview.length) {
    if (meta.step > 0) return { content: `Done, boss.${/^Error/.test([...messages].reverse().find((m) => m.role === 'tool')?.content || '') ? ' Or rather, it did not work.' : ''}` };
    if (/\[rename\]/.test(boss)) return { toolCalls: [call('update_staff', { who: 'writer', name: 'Crumb', title: 'Head of Buns', persona: 'Talks only about bread.', look: { hat: 'crown' } })] };
    if (/\[letgo\]/.test(boss)) return { toolCalls: [call('let_go_staff', { who: 'designer' })] };
    return { toolCalls: [call('make_logo', { prompt: 'A small round bowl of soup, in two colours.' })] };
  }
  // The help line. An answer or an expiry is a turn of its own, whatever came before it.
  if (meta.guidance) return { content: 'Thanks to buddehbot, we can carry on, boss.' };
  if (meta.helpDeadEnd) return { content: 'I did not get an answer from buddehbot, boss, so I am using my best judgment and carrying on.' };
  if (/\[help\]/.test(boss) && meta.isFreshBoss && !meta.toReview.length) {
    if (meta.step === 0) return { toolCalls: [call('ask_buddehbot', { question: boss.replace(/\[help\]/g, '').trim() || 'How do I get round a tool that keeps failing?', what_was_tried: 'I tried the obvious thing twice.' })] };
    return { content: `I have asked buddehbot and I am carrying on meanwhile, boss.${/^Error/.test([...messages].reverse().find((m) => m.role === 'tool')?.content || '') ? ' It did not go through.' : ''}` };
  }
  // Work modes, said in chat.
  // The boss's say on the mode comes first, even with reports waiting: those get accepted when the turn ends.
  if (MODE_SAID.test(boss) && meta.isFreshBoss) {
    if (meta.step === 0) return { toolCalls: [call('set_work_mode', modeArgs(boss))] };
    const last = [...messages].reverse().find((m) => m.role === 'tool')?.content || '';
    return { content: /^Error/.test(last) ? 'That did not work, boss.' : `Done, boss. ${last.replace(/^Work mode set: /, 'From now on: ').split('. The boss')[0]}.${/no goal yet/.test(last) ? `\n\n${proposeGoals()}` : ''}` };
  }
  // A work mode with no goal: three to pick from, and nothing assigned. The boss's next words pick one, or are their own.
  if (meta.goalNeeded && !meta.isFreshBoss) return { content: proposeGoals() };
  if (meta.needsGoal && meta.isFreshBoss && !meta.toReview.length) {
    const goal = goalPicked(boss);
    if (meta.step === 0) return { toolCalls: [call('update_backlog', { goal })] };
    const last = [...messages].reverse().find((m) => m.role === 'tool')?.content || '';
    return { content: /^Saved/.test(last) ? `Great: our goal is now **${goal}**. The team starts on it now.` : 'That did not work, boss.' };
  }
  // The daily run: [nothing] in the goal means nothing is worth doing. Otherwise one improvement, built and tested; [flunk] or [major] in the goal makes the Tester say no.
  if (meta.daily?.planning && !meta.isFreshBoss && !meta.toReview.length) {
    const goal = meta.modeGoal || '';
    if (/\[nothing\]/.test(goal)) {
      if (meta.step === 0) return { toolCalls: [call('update_backlog', { summary: 'Everything looks fine, and nothing is worth doing today.', next_up: ['Look again tomorrow'] })] };
      return { content: 'Nothing worth doing today, boss.' };
    }
    const slug = meta.published[0]?.slug || 'daily-work';
    if (meta.step === 0) return { toolCalls: [call('assign_task', { to: 'builder', title: 'Make the home page clearer', brief: `[Daily] build ${slug}. ${goal}`, plan: 'One improvement', project: slug }, 0), call('assign_task', { to: 'tester', title: 'Check the clearer home page', brief: `[Daily] test ${slug}. ${goal}`, plan: 'One improvement', project: slug, after_previous: true }, 1)] };
    return { content: 'Today the team makes the home page clearer.' };
  }
  if (meta.daily && meta.toReview.length && !meta.isFreshBoss) {
    if (meta.step === 0) return { toolCalls: meta.toReview.map((t, i) => call('review_task', { task_id: t.id, verdict: 'approve', notes: 'Looks good.' }, i)) };
    const slug = meta.toReview[0].project;
    if (meta.step === 1 && slug && !meta.openCount) return { toolCalls: [call('publish_project', { project: slug, title: 'Clearer home page', description: 'The home page, made clearer.', kind: 'site' })] };
    if (meta.step <= 2) return { toolCalls: [call('update_backlog', { summary: 'Made the home page clearer.', next_up: ['Add a sign-up form'] })] };
    return { content: 'That is today\'s run done, boss.' };
  }
  // A quiet floor in a work mode: the next job off the list.
  if (meta.autopilot && !meta.isFreshBoss && !meta.toReview.length) {
    const a = meta.autopilot;
    const item = a.nextUp[0] || 'Write a one-page plan for the company';
    if (meta.step === 0) {
      const calls = [];
      if (!a.nextUp.length) calls.push(call('update_backlog', { next_up: topUp(a.nextUp) }, 0));
      const pass = ['[ask]', '[buy]'].filter((f) => (a.goal || '').includes(f)).join(' ');
      calls.push(call('assign_task', { to: /\[build\]/.test(a.goal || '') ? 'builder' : /\[buy\]/.test(a.goal || '') ? 'researcher' : 'writer', title: item, brief: `Do the next thing on our list: ${item}.${pass ? ` ${pass}` : ''}`, project: 'next-up' }, 1));
      return { toolCalls: calls };
    }
    return { content: `Picked the next job: **${item}**.` };
  }
  const lane = boss.match(/^Let's do a (game|website|small business)\b/i)?.[1]?.toLowerCase().replace('small ', '');
  if (lane && meta.isFreshBoss && !meta.toReview.length) return { content: LANE_OPENERS[lane] };
  // Standing orders (floors-plus). These come before everything else: the boss's words may also hold an action word.
  if (/\[standing\]/.test(boss) && meta.isFreshBoss && !meta.toReview.length) {
    if (meta.step === 0) return { toolCalls: [call('set_standing_order', { instruction: boss.replace(/\[standing\]/g, '').trim() || 'Tidy the drive', every: 'day', at: '09:00' })] };
    return { content: 'Done, boss. That is now a standing order, every day at 09:00 UTC, and it shows under **Orders** where you can change or delete it.' };
  }
  if (/\[cancelorder\]/.test(boss) && meta.isFreshBoss && !meta.toReview.length) {
    if (meta.step === 0) return { toolCalls: [call('list_standing_orders', {})] };
    // A model reads its tool results; the mock reads the last one for the first order's id.
    const last = [...messages].reverse().find((m) => m.role === 'tool')?.content || '';
    const id = meta.step === 1 ? last.match(/#(\d+)/)?.[1] : null;
    if (id) return { toolCalls: [call('cancel_standing_order', { id: Number(id) })] };
    return { content: meta.step === 1 ? 'There are no standing orders to cancel, boss.' : 'Cancelled, boss. It will not run again.' };
  }
  if (meta.toReview.length) {
    const sendBack = (t) => /\[revise\]/.test(t.brief) && t.revisions === 0;
    if (meta.step === 0) return { toolCalls: meta.toReview.map((t, i) => call('review_task', { task_id: t.id, verdict: sendBack(t) ? 'revise' : 'approve', notes: 'Looks good.' }, i)) };
    // A job the team picked for itself: tick it off the list and say what it did.
    if (meta.autonomous && meta.step === 1 && !meta.openCount && !meta.toReview.some(sendBack)) {
      const list = meta.modeList || [];
      const doneTitle = meta.toReview[0].title;
      const reached = /\[reach\]/.test(meta.modeGoal || '') ? { goal_reached: true, goal: NEXT_GOAL } : {};
      return { toolCalls: [call('update_backlog', { next_up: topUp(list.filter((x) => x !== doneTitle), doneTitle), summary: `Finished "${doneTitle}" and put it on the drive.`, ...reached })] };
    }
    if (meta.openCount || meta.toReview.some(sendBack)) return { content: 'Sent one thing back for another pass. I will report when it returns.' };
    const links = meta.published.map((p) => `[${p.title}](${p.url})`).join(', ');
    return { content: `All done, boss. ${links ? `Published: ${links}.` : 'Nothing needed publishing.'} Want another round?` };
  }
  if (meta.answered) return { content: 'Thanks boss, that settles it.' };
  if (!meta.isFreshBoss) return { content: 'The team has wrapped up what they could, boss. What next?' };
  if (/\[domain\]/.test(boss)) {
    if (meta.step === 0) return { toolCalls: [call('check_domain', { names: ['tinyteacups.com'] })] };
    if (meta.step === 1) return { toolCalls: [call('request_domain', { domain: 'tinyteacups.com', project: meta.published[0]?.slug || 'launch', why: 'So the launch has its own address.' })] };
    return { content: 'I asked for the name, boss. The Buy button is under Requests.' };
  }
  if (/\[report\]/.test(boss)) {
    if (meta.step === 0) return { toolCalls: [call('launch_report', { project: meta.published[0]?.slug, headline: 'It is live.', next_steps: 'Share it.' })] };
    return { content: 'That is the report, boss.' };
  }
  if (/\[mgrask\]/.test(boss) && meta.step === 0) return { toolCalls: [call('ask_boss', { question: 'Is the deadline for this real or imaginary?' })] };
  if (ACT.test(boss)) {
    if (meta.step === 0 && meta.openCount === 0) {
      const p = { plan: `Launch ${slug}`, project: slug, ...(/\[private\]/.test(boss) ? { private: true } : {}), ...(boss.match(/\[lane:(\w+)\]/) ? { lane: boss.match(/\[lane:(\w+)\]/)[1] } : {}) };
      const flag = (re, s) => (re.test(boss) ? ` ${s}` : '');
      const calls = [];
      if (/\[hire\]/.test(boss)) calls.push(call('hire_staff', { role: 'analyst', name: 'Quill' }, 90));
      calls.push(call('assign_task', { ...p, to: 'researcher', title: 'Find out who this is for', brief: `Research the idea: ${boss}${flag(/\[buy\]/, '[buy]')}${flag(/\[ssrf\]/, '[ssrf]')}${flag(/\[web\]/, '[web]')}` }, 0));
      calls.push(call('assign_task', { ...p, to: 'writer', title: 'Write the launch brief', brief: `Write the brief.${flag(/\[ask\]/, '[ask]')}${flag(/\[revise\]/, '[revise]')}` }, 1));
      calls.push(call('assign_task', { ...p, to: 'designer', title: 'Pick the look', brief: 'Write style.css.' }, 2));
      // The boss's files go to whoever puts the page together, as a real model is told to.
      const files = (meta.bossFiles || []).slice(-10);
      calls.push(call('assign_task', { ...p, to: 'builder', title: 'Build the mini-site', after_previous: true, brief: `Build and publish the site.${files.length ? ' Use the boss\'s photo.' : ''}${flag(/\[traverse\]/, '[traverse]')}${flag(/\[inject\]/, '[inject]')}`, ...(files.length ? { files } : {}) }, 3));
      if (/\[hire\]/.test(boss)) calls.push(call('assign_task', { ...p, to: 'analyst', title: 'Size it up', brief: 'Write a note on the numbers.' }, 4));
      return { toolCalls: calls };
    }
    return { content: `Right away. The team has a plan for **${slug}**: research, a brief, a look, then a working site. Pull up a chair and watch.` };
  }
  return { content: `Love it. Three angles, boss:\n\n1. **The small version:** one page, one promise, live today.\n2. **The silly version:** the same idea, but with a mascot.\n3. **The serious version:** research first, then a proper brief.\n\nTell me to **go** when you want the staff on it.` };
}

// The maker loop (server/makers.js). Flags in the boss's pitch pick what the Tester finds: [full] passes every rule at once, [broken]
// always fails, [regress] breaks a rule in pass 1 that pass 0 had, [cheat] keeps a major bug in every version, [major-once] has a major bug
// until the first fix pass re-tests it. With none, the first version passes the browser rules and pass 1 the rest.
function makerStep(meta) {
  const m = /^\[Maker\] (doc|build|test) (\d+)?/.exec(meta.task.brief || '');
  if (!m) return null;
  const dir = `projects/${meta.task.project}`, pass = Number(m[2] || 0), boss = meta.allBoss || '';
  const list = [];
  if (m[1] === 'doc') list.push(call('write_file', { path: `${dir}/notes/design.md`, content: '# Design doc\n\n1. Core loop and controls: move and dodge.\n3. Mechanics: chasers, dashers, splitters.\n' }));
  else if (m[1] === 'build') list.push(call('write_file', { path: `${dir}/notes/pass-${pass}.md`, content: `Pass ${pass}: built.\n` }));
  else {
    const ids = (meta.task.brief.match(/"rules": \{([^}]*)\}/)?.[1] || '').match(/"([a-z][a-z0-9_-]*)"/g)?.map((x) => x.slice(1, -1)) || [];
    const judged = new Set((meta.task.brief.match(/^- ([a-z0-9_-]+): .*\(judged/gm) || []).map((x) => x.slice(2).split(':')[0]));
    const broken = /\[broken\]/.test(boss), full = /\[full\]/.test(boss), regress = /\[regress\]/.test(boss) && pass === 1;
    const recheck = /The Builder just tried to fix these/.test(meta.task.brief);
    const cheat = /\[cheat\]/.test(boss), majorOnce = /\[major-once\]/.test(boss) && !recheck && pass === 0;
    const rules = Object.fromEntries(ids.map((id) => [id, broken ? id !== 'loads' && false : regress && id === 'inputs' ? false : id === 'nocheats' ? !cheat : full || pass >= 1 || !judged.has(id)]));
    const verdict = broken || regress ? 'fail' : 'pass';
    const bugs = broken ? [{ severity: 'blocker', text: 'It never leaves the menu.' }] : regress ? [{ severity: 'blocker', text: 'Touch stopped moving the player.' }] : cheat ? [{ severity: 'major', text: 'A ?wave=9 link starts a run at wave 9.' }] : majorOnce ? [{ severity: 'major', text: 'The save button does nothing.' }] : [];
    list.push(call('write_file', { path: `${dir}/TEST-REPORT.md`, content: `# Test report, pass ${pass}\n\nPlayed it.\n\n\`\`\`office-verdict\n${JSON.stringify({ verdict, rules, bugs, regressions: [], summary: verdict === 'pass' ? 'Plays well.' : 'Broken.' })}\n\`\`\`\n` }));
  }
  if (meta.step < list.length) return { toolCalls: [list[meta.step]] };
  return { content: `Finished "${meta.task.title}".` };
}

// The daily run's staff: the Builder writes a real page, and the Tester's verdict comes from the goal's flags.
function dailyStep(meta) {
  const m = /^\[Daily\] (build|test) ([a-z0-9-]+)\.(.*)/s.exec(meta.task.brief || '');
  if (!m) return null;
  const dir = `projects/${meta.task.project}`, goal = m[3];
  const list = [];
  if (m[1] === 'build') list.push(call('write_file', { path: `${dir}/index.html`, content: SITE(m[2], 'A page the team made clearer today.') }), call('write_file', { path: `${dir}/style.css`, content: 'body{font-family:sans-serif}' }, 1), call('write_file', { path: `${dir}/app.js`, content: 'console.log("hello");' }, 2));
  else {
    const flunk = /\[flunk\]/.test(goal), major = /\[major\]/.test(goal);
    list.push(call('write_file', { path: `${dir}/TEST-REPORT.md`, content: `# Test report\n\nChecked it.\n\n\`\`\`office-verdict\n${JSON.stringify({ verdict: flunk ? 'fail' : 'pass', rules: {}, bugs: flunk ? [{ severity: 'blocker', text: 'The page is blank on a phone.' }] : major ? [{ severity: 'major', text: 'The sign-up button does nothing.' }] : [], regressions: [], summary: flunk ? 'Broken.' : 'Works.' })}\n\`\`\`\n` }));
  }
  if (meta.step < list.length) return { toolCalls: [list[meta.step]] };
  return { content: `Finished "${meta.task.title}".` };
}

function staffStep(meta) {
  const { role, task, step, floorSlug } = meta;
  const daily = dailyStep(meta);
  if (daily) return daily;
  const maker = makerStep(meta);
  if (maker) return maker;
  const shop = shopStaff(meta);
  if (shop) return step < shop.length ? { toolCalls: [shop[step]] } : { content: `Finished "${task.title}".` };
  const biz = businessStaff(meta);
  if (biz) return step < biz.length ? { toolCalls: [biz[step]] } : { content: `Finished "${task.title}".` };
  const p = task.project || 'project';
  const dir = `projects/${p}`;
  const b = task.brief;
  const list = [];
  if (role === 'researcher') {
    list.push(call('list_files', {}));
    if (/\[colleague\]/.test(b)) list.push(call('ask_colleague', { who: 'writer', question: 'What should I know from your last job?' }));
    if (/\[ssrf\]/.test(b)) list.push(call('fetch_url', { url: 'http://169.254.169.254/latest/meta-data/' }));
    if (/\[web\]/.test(b)) list.push(call('web_search', { query: 'tiny companies' }));
    if (/\[buy\]/.test(b)) list.push(call('file_purchase_request', { item: 'A domain name', price: 12, why: 'So the launch has its own address.', link: 'https://example.com/domain' }));
    list.push(call('write_file', { path: `${dir}-research/index.md`.replace(/^projects\//, 'projects/'), content: `# Research notes\n\nPeople like small things that work.\n\n## Findings\n\n- Keep it to one page.\n- Say what it does in a line.\n` }));
    list.push(call('publish_project', { project: `${p}-research`, title: `${p}: research`, description: 'Who it is for and what they want.', kind: 'research', sources: [{ title: 'Example', url: 'https://example.com/' }] }));
  } else if (role === 'writer') {
    if (/\[ask\]/.test(b)) list.push(call('ask_boss', { question: 'Should the tone be silly or serious?' }));
    list.push(call('write_file', { path: `${dir}-brief/index.md`, content: `# The launch brief\n\nFor **${floorSlug}**.${meta.answers.length ? `\n\nThe boss says: ${meta.answers[0]}` : ''}\n\n1. Make the thing.\n2. Show the thing.\n3. Enjoy the thing.\n` }));
    list.push(call('publish_project', { project: `${p}-brief`, title: `${p}: launch brief`, description: 'The plan, in one page.', kind: 'doc' }));
  } else if (role === 'designer') {
    list.push(call('write_file', { path: `${dir}/style.css`, content: CSS }));
  } else if (role === 'builder') {
    if (/\[traverse\]/.test(b)) list.push(call('write_file', { path: '../../../etc/passwd', content: 'nope' }));
    list.push(call('read_file', { path: `${dir}/style.css` }));
    if (/\[img\]/.test(meta.allBoss || b)) list.push(call('generate_image', { prompt: 'A small hero picture', name: 'hero', project: p }));
    // A photo from the boss: look at it, then put a copy in the project, where the page can use it.
    const photo = (meta.files || []).find((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
    const photoAt = photo ? `images/${photo.split('/').pop().replace(/^u[A-Za-z0-9_-]{12}-/, '')}` : '';
    if (photo) list.push(call('view_file', { path: photo }), call('copy_file', { from: photo, to: `${dir}/${photoAt}` }));
    list.push(call('write_file', { path: `${dir}/index.html`, content: /\[inject\]/.test(b) ? EVIL : SITE(p, 'A real page, written by a tiny staff while you watched.').replace('</main>', photo ? `<img src="${photoAt}" alt="The boss's photo" width="320"></main>` : '</main>') }));
    list.push(call('write_file', { path: `${dir}/app.js`, content: JS }));
    list.push(call('publish_project', { project: p, title: p, description: 'A working little site.', kind: 'site' }));
  } else {
    list.push(call('write_file', { path: `${dir}-notes/${role}.md`, content: `# ${role} notes\n\nDone.\n` }));
  }
  if (step < list.length) return { toolCalls: [list[step]] };
  return { content: `Finished "${task.title}".${meta.saw ? ` I could see ${meta.saw}.` : ''}` };
}

export function createMockClient(cfg) {
  const failed = new Set();
  return {
    failed,
    async chat({ messages, onToken, onToolCall, signal, pricing, meta }) {
      // A published app asking through office.ai. No staff, no tools: a stand-in reply that shows what it was asked.
      if (meta?.kind === 'app_ai') {
        await sleep(Math.min(cfg.mockDelayMs, 20), signal);
        const content = `Mock AI reply to: ${String(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '').slice(0, 300)}`;
        const prompt = Math.ceil(JSON.stringify(messages).length / 4), completion = Math.ceil(content.length / 4);
        return { content, toolCalls: [], finish: 'stop', usage: { prompt, completion, cost: (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6, real: false } };
      }
      // The last look before a first publish. [noship] in the boss's words holds the first look back; the second lets it through, or [nevership] holds that too.
      if (meta?.kind === 'shipcheck') {
        await sleep(Math.min(cfg.mockDelayMs, 20), signal);
        const no = /\[nevership\]/.test(meta.allBoss || '') || (/\[noship\]/.test(meta.allBoss || '') && meta.look === 1);
        const content = /\[shipgarbage\]/.test(meta.allBoss || '') ? 'I would rather not say.' : JSON.stringify({ ship: !no, scores: { works: 8, as_asked: no ? 5 : 8, look: 8, phone: 8, showable: no ? 5 : 8 }, fix: no ? ['The hero says nothing about what this is: put the one-line pitch there.'] : [], note: no ? 'Not yet.' : 'Good to go.' });
        const prompt = Math.ceil(JSON.stringify(messages).length / 4), completion = Math.ceil(content.length / 4);
        return { content, toolCalls: [], finish: 'stop', usage: { prompt, completion, cost: (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6, real: false } };
      }
      if (meta?.kind === 'app_ai_locked') {
        await sleep(Math.min(cfg.mockDelayMs, 20), signal);
        const last = String(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
        const content = last.includes('[broken]') ? 'not json at all' : JSON.stringify({ reply: last.includes('[dose]') ? 'Take 200 mg a week.' : last.includes('[safe]') ? 'Tren is perfectly safe.' : last.includes('[link]') ? 'See https://example.com' : last.includes('[html]') ? 'Hello <img src=x onerror=alert(1)>' : last.includes('[price]') ? 'That is $40 at a lab.' : `Mock reply to: ${last.slice(0, 200)}`, compounds: last.includes('[made-up]') ? ['not_a_compound', 'testosterone_therapy'] : [], concerns: [], markers: [], answers: { started: 'unknown', diabetes: 'unknown', growth_hormone: 'unknown' }, alert: last.includes('[alert]') });
        const prompt = Math.ceil(JSON.stringify(messages).length / 4), completion = Math.ceil(content.length / 4);
        return { content, toolCalls: [], finish: 'stop', usage: { prompt, completion, cost: (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6, real: false } };
      }
      if (meta?.kind === 'talk') {
        await sleep(cfg.mockDelayMs, signal);
        const content = talkStep(meta);
        const prompt = Math.ceil(JSON.stringify(messages).length / 4), completion = Math.ceil(content.length / 4);
        return { content, toolCalls: [], finish: 'stop', usage: { prompt, completion, cost: (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6, real: false } };
      }
      const boss = meta.lastBoss || meta.task?.brief || '';
      const delay = /\[slow\]/.test(boss) || /\[slow\]/.test(meta.allBoss || '') ? Math.max(cfg.mockDelayMs, 120) * 4 : cfg.mockDelayMs;
      await sleep(delay / 2, signal);
      if (/\[fail\]/.test(meta.allBoss || '') && !failed.has(meta.floorId)) { failed.add(meta.floorId); throw new ProviderError('Model provider said 503: mock outage', { status: 503, retryable: true }); }
      // What a real model would have been shown: the boss's pictures and PDFs, as blocks.
      const blocks = messages.flatMap((m) => m.office_blocks || []);
      const shown = ['image', 'document'].map((t) => [t, blocks.filter((x) => x.type === t).length]).filter(([, n]) => n).map(([t, n]) => `${n} ${t === 'image' ? 'picture' : 'PDF'}${n > 1 ? 's' : ''}`).join(' and ');
      const r = voiced(meta.kind === 'manager' ? managerStep(meta, messages) : staffStep({ ...meta, saw: shown }), messages, meta.kind);
      const content = r.content || '';
      if (r.toolCalls?.length) onToolCall?.(r.toolCalls[0].name);
      await sleep(delay / 2, signal);
      if (content && onToken) {
        const words = content.split(/(?<=\s)/);
        for (const w of words) { if (cfg.mockDelayMs > 0) await sleep(Math.min(18, cfg.mockDelayMs / 8), signal); onToken(w); }
      }
      const prompt = Math.ceil(JSON.stringify(messages).length / 4);
      const completion = Math.ceil((content.length + JSON.stringify(r.toolCalls || []).length) / 4);
      const spendy = /\[spendy\]/.test(meta.allBoss || '');
      const cost = spendy ? 0.5 : (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6;
      return { content, toolCalls: r.toolCalls || [], finish: 'stop', usage: { prompt, completion, cost, real: false } };
    },
  };
}
