// Staff without a computer check by reading (the second pass of docs/EFFICIENCY.md). A Tester there read one 29,000-character page four times to find a
// line, never saw past character 40,000 of a longer one, and spent most of its forty steps writing scripts nothing could run. So: search_files finds a
// phrase across the drive and gives file and line; read_file reads on from a line, and says when there is more; the prompts say plainly that nothing runs.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim } from './helpers.js';
import { get, run } from '../server/db.js';
import { writeFile, writeBinaryFile } from '../server/workspace.js';
import { readPart, toolsForRole, toolDefs, COMPUTER_TOOL_DEFS, NOT_SEEN_AS_LINK } from '../server/tools.js';
import { staffPrompt, managerPrompt } from '../server/prompts.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
async function mk() {
  const t = await boot({ peopleTalk: false });
  open.push(t);
  const c = await claim(t, `Readers ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const e = t.app.engine;
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) e.hireStaff(f, 'tester');
  const agent = (role) => get(t.db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', f.id, role);
  const put = (path, text) => writeFile(t.db, f.id, path, text, null, t.cfg.quotaBytes);
  const tool = (role, name, args, task = null, extra = {}) => e.tools.exec({ ...e.toolCtx(f, agent(role), task, toolsForRole(role)), ...extra }, name, JSON.stringify(args));
  return { t, f, e, agent, put, tool };
}
const inner = (out) => out.replace(/^<untrusted_data source="[^"]*">\n/, '').replace(/\n<\/untrusted_data>\n[^\n]*$/, '');

describe('search_files', () => {
  test('finds a phrase across the drive in any letter case and gives file and line, without the files being read', async () => {
    const h = await mk();
    h.put('projects/site/index.html', `<!doctype html>\n<h1>Mobile tire and battery help that comes to you.</h1>\n${'<p>filler</p>\n'.repeat(3000)}<a class="stuck" href="/stuck/">Stuck?</a>\n`);
    h.put('projects/site/guides/flat.html', '<h1>Flat tire</h1>\n<a href="/STUCK/">Stuck right now</a>\n');
    h.put('projects/other/notes.md', 'nothing here');
    writeBinaryFile(h.t.db, h.f.id, 'projects/site/photo.png', Buffer.from('href="/stuck/" inside a picture'), null, h.t.cfg.quotaBytes);
    const out = await h.tool('tester', 'search_files', { query: 'HREF="/stuck/"' });
    assert.match(out, NOT_SEEN_AS_LINK, 'file text is untrusted data, and a link in it is not a page anyone opened');
    assert.match(out, /^<untrusted_data source="workspace:search">\n"HREF="\/stuck\/"" is in 2 files in the workspace, 2 places\. Each line below is file:line: text\.\n/);
    assert.deepEqual(inner(out).split('\n').slice(1), ['projects/site/guides/flat.html:2: <a href="/STUCK/">Stuck right now</a>', 'projects/site/index.html:3003: <a class="stuck" href="/stuck/">Stuck?</a>']);
    assert.ok(out.length < 600, 'a few hundred characters, where reading the page was 40,000');
    assert.equal(inner(await h.tool('tester', 'search_files', { query: 'stuck', prefix: 'projects/site/guides/' })).split('\n').length, 2, 'a folder narrows it');
    assert.equal(await h.tool('tester', 'search_files', { query: 'lorem ipsum', prefix: 'projects/site/' }), 'No text file in projects/site/ has "lorem ipsum".');
    assert.equal(await h.tool('tester', 'search_files', { query: 'x' }), 'Error: give at least two characters to look for');
    assert.equal(await h.tool('tester', 'search_files', {}), 'Error: query is required');
  });

  test('a file that is one long line shows each place, and a common word is cut short with a count', async () => {
    const h = await mk();
    h.put('projects/site/data.js', `window.DATA=[${Array.from({ length: 400 }, (_, i) => `{"id":${i},"name":"Tech ${i}","phone":"${i === 7 || i === 300 ? '555-0100' : '213-000-0000'}"}`).join(',')}];`);
    const hits = inner(await h.tool('researcher', 'search_files', { query: '555-' })).split('\n');
    assert.match(hits[0], /is in 1 file in the workspace, 2 places\./);
    assert.match(hits[1], /^projects\/site\/data\.js:1: ….*"name":"Tech 7","phone":"555-0100".*…$/);
    assert.match(hits[2], /"name":"Tech 300","phone":"555-0100"/);
    assert.ok(hits[1].length < 260);
    for (let i = 0; i < 30; i++) h.put(`projects/site/pages/p${String(i).padStart(2, '0')}.html`, '<p>tire</p>\n'.repeat(40));
    const many = await h.tool('researcher', 'search_files', { query: 'tire', prefix: 'projects/site/pages/' });
    assert.match(many, /is in 30 files in projects\/site\/pages\/, 1200 places\. These are the first; a longer phrase or a prefix narrows it\./);
    assert.ok(many.length < 9500, `bounded: ${many.length}`);
    assert.match(many, /projects\/site\/pages\/p00\.html: and 28 more/);
  });

  test('private work stays private, and the roles that read have it while a computer keeps its own tools', async () => {
    const h = await mk();
    h.put('projects/secret/plan.md', 'the launch code word is marzipan');
    h.put('projects/site/index.html', 'marzipan cake');
    run(h.t.db, 'INSERT INTO projects (floor_id,slug,title,private,created_at) VALUES (?,?,?,1,1)', h.f.id, 'secret', 'Secret');
    const out = await h.tool('tester', 'search_files', { query: 'marzipan' }, { id: 0, project: 'site' });
    assert.match(out, /is in 1 file in the workspace, 1 place\./);
    assert.doesNotMatch(out, /secret/);
    assert.equal(await h.tool('tester', 'search_files', { query: 'marzipan', prefix: 'projects/secret/' }, { id: 0, project: 'site' }), 'No text file in projects/secret/ has "marzipan".');
    for (const role of ['manager', 'builder', 'tester', 'researcher', 'writer', 'designer', 'marketer', 'lawyer']) assert.ok(toolDefs(toolsForRole(role), h.t.cfg, role).some((d) => d.function.name === 'search_files'), role);
    const computer = COMPUTER_TOOL_DEFS({ ...h.t.cfg, webSearchKey: 'k' }, 'tester');
    assert.ok(!computer.some((d) => /search_files/.test(d.name)), 'a computer has grep');
    for (const name of ['read_shared_file', 'pull_shared_file']) assert.deepEqual(computer.find((d) => d.name === name).input_schema, { type: 'object', properties: { path: { type: 'string', description: 'Relative path' } }, required: ['path'], additionalProperties: false }, `${name} is as it was`);
  });
});

describe('read_file on a long file', () => {
  test('a short file is exactly as before; a long one ends on a whole line and says where to read on, to the end', async () => {
    const h = await mk();
    h.put('projects/site/short.md', 'one\ntwo\n');
    assert.equal(inner(await h.tool('tester', 'read_file', { path: 'projects/site/short.md' })), 'one\ntwo\n');
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1} ${'x'.repeat(20)}`);
    h.put('projects/site/long.html', lines.join('\n'));
    const first = inner(await h.tool('tester', 'read_file', { path: 'projects/site/long.html' }));
    const m = first.match(/\n\n\[Lines 1 to (\d+) of 3000\. Read on with from_line: (\d+)\.\]$/);
    assert.ok(m, first.slice(-120));
    assert.equal(Number(m[2]), Number(m[1]) + 1);
    assert.ok(first.length <= 40100);
    assert.ok(first.includes(`\n${lines[Number(m[1]) - 1]}\n\n[Lines`), 'the last line shown is whole');
    let seen = first.slice(0, m.index).split('\n'), next = Number(m[2]), reads = 1;
    while (next) {
      const part = inner(await h.tool('tester', 'read_file', { path: 'projects/site/long.html', from_line: next }));
      const more = part.match(/\n\n\[Lines (\d+) to (\d+) of 3000\. Read on with from_line: (\d+)\.\]$/), end = part.match(/\n\n\[From line (\d+) to the end of the file\.\]$/);
      assert.ok(more || end, part.slice(-120));
      assert.equal(Number((more || end)[1]), next);
      seen = seen.concat(part.slice(0, (more || end).index).split('\n'));
      next = more ? Number(more[3]) : 0; reads++;
    }
    assert.deepEqual(seen, lines, 'every line once, none twice: the bottom of the page can be read');
    assert.ok(reads >= 2 && reads <= 4);
    assert.equal(inner(await h.tool('tester', 'read_file', { path: 'projects/site/long.html', from_line: '2999' })), `${lines[2998]}\n${lines[2999]}\n\n[From line 2999 to the end of the file.]`, 'a line number sent as text still works');
    assert.match(await h.tool('tester', 'read_file', { path: 'projects/site/short.md', from_line: 9 }), /\[This file has 3 lines, so there is no line 9\.\]/);
  });

  test('one line too long to show says so, and on a computer the cut-off note still points at pull_shared_file', async () => {
    const h = await mk();
    const one = readPart('y'.repeat(90000), 1);
    assert.equal(one.body.length, 40000);
    assert.match(one.note, /^Line 1 is longer than one read can show: this is its first 40000 characters\. search_files finds text further along it\.$/);
    assert.deepEqual(readPart('a\nb', 1), { body: 'a\nb', note: '' });
    assert.deepEqual(readPart('a\nb', 2), { body: 'b', note: 'From line 2 to the end of the file.' });
    assert.deepEqual(readPart('a\nb', 'junk'), { body: 'a\nb', note: '' });
    h.put('projects/site/big.json', `${'z'.repeat(50000)}\nend`);
    const onComputer = await h.tool('builder', 'read_file', { path: 'projects/site/big.json' }, null, { mountFile: () => {} });
    assert.ok(inner(onComputer).startsWith('z'.repeat(40000)));
    assert.match(onComputer, /\[This file is 50004 bytes and was cut off here\. For the whole thing byte-for-byte, use pull_shared_file on projects\/site\/big\.json rather than retyping it\.\]/);
  });
});

describe('the prompts for a floor with no computers', () => {
  const floor = { number: 6, name: 'Tiny Co', boss: JSON.stringify({ name: 'Sam' }), tagline: '', colors: '{}' };
  test('staff are told nothing runs there and to check by searching and reading', () => {
    const p = staffPrompt(floor, { name: 'Margot', title: 'Tester', role: 'tester' }, { brief: 'You test things.' }, { title: 't', brief: 'b' }, {});
    assert.match(p, /You can't run anything yourself here: there is no shell, no Node and no browser, so a script written to check something will never run, and this floor's own live pages can't be opened from here\./);
    assert.match(p, /search_files finds a word, a link or a phrase across them and gives the line; read_file with from_line reads on from there\./);
    assert.match(p, /You have no browser here, so read it through line by line/, 'what it already said stays');
  });
  test('the manager is told how to brief a Tester who has no browser, and a floor with computers is told nothing new', () => {
    const without = managerPrompt(floor, { name: 'Sam' }, { manager: 'Margot', person: '' }, { computerEnabled: false });
    assert.match(without, /A Tester here checks by reading the files: name the files and the exact words, links or numbers to look for in each, and never ask for the live site to be opened or tried at phone and desktop size/);
    const withComputers = managerPrompt(floor, { name: 'Sam' }, { manager: 'Margot', person: '' }, { computerEnabled: true });
    assert.doesNotMatch(withComputers, /A Tester here checks by reading the files/);
    assert.match(withComputers, /A Tester you hire with hire_staff has one too\./);
  });
});
