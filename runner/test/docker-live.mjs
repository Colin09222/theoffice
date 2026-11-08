// Manual check of src/docker.mjs against a real Docker daemon (not part of `npm test`).
// Creates and removes only its own throwaway container and image. Usage: node test/docker-live.mjs [runtime]
import { Docker } from '../src/docker.mjs';
import { makeTar } from '../src/tar.mjs';

const d = new Docker();
const runtime = process.argv[2] || 'runc';
const name = `office-dtest-${Date.now().toString(36)}`;
const base = process.env.BASE || 'node:22-slim';
const say = (k, v) => console.log(`${k.padEnd(28)} ${String(v).replace(/\n/g, ' | ').slice(0, 160)}`);
try {
  await d.create(name, { Image: base, User: '10001:10001', WorkingDir: '/', Cmd: ['sh', '-c', 'echo started; echo err >&2; sleep 120'], Labels: { 'office.test': '1' }, HostConfig: { Runtime: runtime, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'none' } });
  say('create', 'ok');
  const tar = makeTar([
    { path: 'app', type: 'dir', uid: 10001, gid: 10001 },
    { path: 'app/hello.txt', type: 'file', data: Buffer.from('hi from tar'), uid: 10001, gid: 10001 },
  ]);
  await d.putArchive(name, '/', tar);
  say('putArchive', 'ok');
  await d.start(name);
  await new Promise((r) => setTimeout(r, 1500));
  const ls = await d.exec(name, ['sh', '-c', 'ls -ln /app; cat /app/hello.txt; id -u; echo x > /app/new.txt && echo wrote'], { user: '10001:10001', timeoutMs: 20000 });
  say('exec', `exit=${ls.exitCode} ${ls.output}`);
  const slow = await d.exec(name, ['sleep', '30'], { user: '10001:10001', timeoutMs: 1500 });
  say('exec timeout', `timedOut=${slow.timedOut}`);
  const fail = await d.exec(name, ['sh', '-c', 'exit 7'], { user: '10001:10001', timeoutMs: 10000 });
  say('exec exit code', fail.exitCode);
  say('logs', (await d.logs(name, 10)).trim());
  const info = await d.inspect(name);
  say('inspect', `running=${info.State.Running} runtime=${info.HostConfig.Runtime}`);
  await d.commit(name, 'office-dtest', 'x', { User: '10001:10001', WorkingDir: '/app', Cmd: ['cat', '/app/new.txt'], Labels: { 'office.test': '1' } });
  say('commit', `exists=${await d.imageExists('office-dtest:x')}`);
  const c2 = `${name}-2`;
  await d.create(c2, { Image: 'office-dtest:x', HostConfig: { Runtime: runtime, NetworkMode: 'none' } });
  await d.start(c2);
  const w = await d.wait(c2, 30000);
  say('committed image runs', `exit=${w.StatusCode} out=${(await d.logs(c2, 5)).trim()}`);
  await d.remove(c2);
  await d.kill(name);
  say('kill', `running=${(await d.inspect(name)).State.Running}`);
  say('list by label', (await d.list('office.test')).length);
} catch (e) {
  say('ERROR', e.message);
} finally {
  await d.remove(name).catch(() => {});
  await d.removeImage('office-dtest:x').catch(() => {});
  say('cleanup', `container=${(await d.inspect(name)) === null} image=${!(await d.imageExists('office-dtest:x'))}`);
}
