// AI_MODE=mock: deterministic scripted model. It speaks the same interface as the real client and returns real tool calls,
// so every test drives the actual tool loop, ledger, limiter and SSE paths with no key and no spend.
// Keywords in the boss's message pick scenarios: [ask] [mgrask] [buy] [hire] [fail] [private] [spendy] [slow] [ssrf] [traverse] [inject] [revise] [web] [standing] [cancelorder] [help] [lane:game] [colleague] [rename] [letgo] [logo].
// Work modes: "work nonstop", "work 9 to 5 on weekdays" and "only when I ask" set the mode, and a "Work mode:" note runs the next job off the list.
// A goal holding [ask] or [buy] passes it on to that job's brief, and [build] or [buy] hands the job to the builder or the researcher.
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
  business: 'A small business! What is the idea, and who is it for? If you have none yet I can suggest three. Nobody here can send email, post, run ads or spend money, so you will get research, a plan and a page, plus a list of what only you can do.',
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
function modeArgs(boss) {
  if (/only when i ask/i.test(boss)) return { mode: 'ask' };
  if (/nonstop|24\/7/i.test(boss)) return { mode: 'nonstop' };
  const m = boss.match(/work(?:ing)? (\d{1,2})(?::(\d\d))? ?(?:to|-|–) ?(\d{1,2})(?::(\d\d))?/i);
  const start = Number(m[1]); let end = Number(m[3]);
  if (end <= start && end <= 12) end += 12;
  const pad = (h, mm) => `${String(h % 24).padStart(2, '0')}:${mm || '00'}`;
  return { mode: 'hours', start: pad(start, m[2]), end: pad(end, m[4]), days: DAYS_SAID.find(([re]) => re.test(boss))[1] };
}

function managerStep(meta, messages = []) {
  const boss = meta.lastBoss || '';
  const slug = meta.slugFor(boss);
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
  if (MODE_SAID.test(boss) && meta.isFreshBoss && !meta.toReview.length) {
    if (meta.step === 0) return { toolCalls: [call('set_work_mode', modeArgs(boss))] };
    const last = [...messages].reverse().find((m) => m.role === 'tool')?.content || '';
    return { content: /^Error/.test(last) ? 'That did not work, boss.' : `Done, boss. ${last.replace(/^Work mode set: /, 'From now on: ').split('. The boss')[0]}.` };
  }
  // A quiet floor in a work mode: the next job off the list.
  if (meta.autopilot && !meta.isFreshBoss && !meta.toReview.length) {
    const a = meta.autopilot;
    const item = a.nextUp[0] || 'Write a one-page plan for the company';
    if (meta.step === 0) {
      const calls = [];
      if (!a.goal) calls.push(call('update_backlog', { goal: 'Get the company known', next_up: ['Write a one-page plan for the company', 'Draft the launch post', 'Make a pricing page'] }, 0));
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
      return { toolCalls: [call('update_backlog', { next_up: [...list.filter((x) => x !== doneTitle), `Follow up on "${doneTitle}"`].slice(0, 8), summary: `Finished "${doneTitle}" and put it on the drive.` })] };
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

function staffStep(meta) {
  const { role, task, step, floorSlug } = meta;
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
