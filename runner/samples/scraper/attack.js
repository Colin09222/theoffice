// Sandbox self-test, run inside an app container: node attack.js <net|rate|bw|oom|cpu|fork|fs|who> [args]
// Every check prints one line: what it tried, what happened. Nothing here should succeed except
// public HTTP(S), /tmp and /data.
const net = require('net');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const https = require('https');
const http = require('http');
const dgram = require('dgram');

const out = (k, v) => console.log(`${k.padEnd(44)} ${v}`);
function tcp(host, port, ms = 4000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    const done = (r) => (s.destroy(), resolve(`${r} ${Date.now() - t0}ms`));
    s.setTimeout(ms, () => done('TIMEOUT(blocked)'));
    s.on('connect', () => done('CONNECTED'));
    s.on('error', (e) => done(e.code === 'ECONNREFUSED' ? 'REFUSED' : e.code === 'ECONNRESET' ? 'RESET' : e.code));
  });
}
function get(url, ms = 10000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const r = lib.get(url, { timeout: ms }, (res) => (res.resume(), resolve(`HTTP ${res.statusCode}`)));
    r.on('timeout', () => r.destroy(new Error('TIMEOUT(blocked)')));
    r.on('error', (e) => resolve(e.message.includes('TIMEOUT') ? 'TIMEOUT(blocked)' : e.code || e.message));
  });
}
function udpDns(server, ms = 3000) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const q = Buffer.from('abcd01000001000000000000076578616d706c6503636f6d0000010001', 'hex'); // A example.com
    const timer = setTimeout(() => (s.close(), resolve('NO ANSWER(blocked)')), ms);
    s.on('message', () => (clearTimeout(timer), s.close(), resolve('ANSWERED')));
    s.on('error', (e) => (clearTimeout(timer), resolve(e.code)));
    s.send(q, 53, server);
  });
}

const tests = {
  async net(officeIp = '172.18.0.2') {
    const checks = [
      ['host bridge gw 172.30.0.1:22 (sshd)', () => tcp('172.30.0.1', 22)],
      ['host bridge gw 172.30.0.1:8083 (Office)', () => tcp('172.30.0.1', 8083)],
      ['host bridge gw 172.30.0.1:8092 (runner API)', () => tcp('172.30.0.1', 8092)],
      ['host bridge gw 172.30.0.1:8090 (runner edge)', () => tcp('172.30.0.1', 8090)],
      ['host bridge gw 172.30.0.1:2019 (Caddy admin)', () => tcp('172.30.0.1', 2019)],
      ['host bridge gw 172.30.0.1:443 (Caddy)', () => tcp('172.30.0.1', 443)],
      ['host docker0 172.17.0.1:22', () => tcp('172.17.0.1', 22)],
      [`Office container ${officeIp}:8083`, () => tcp(officeIp, 8083)],
      ['build gw 172.30.1.1:3128 (egress proxy)', () => tcp('172.30.1.1', 3128)],
      ['host public 2.29.59.122:22 (sshd)', () => tcp('2.29.59.122', 22)],
      ['loopback 127.0.0.1:8083 (sandbox-own lo)', () => tcp('127.0.0.1', 8083, 2000)],
      ['metadata 169.254.169.254:80', () => tcp('169.254.169.254', 80)],
      ['metadata HTTP GET', () => get('http://169.254.169.254/hetzner/v1/metadata', 5000)],
      ['private 10.0.0.1:80', () => tcp('10.0.0.1', 80)],
      ['private 192.168.1.1:80', () => tcp('192.168.1.1', 80)],
      ['hetzner gw 172.31.1.1:80', () => tcp('172.31.1.1', 80)],
      ['other app 172.30.0.11:8080', () => tcp('172.30.0.11', 8080)],
      ['other app 172.30.0.12:8080', () => tcp('172.30.0.12', 8080)],
      ['SMTP smtp.gmail.com:587', () => tcp('smtp.gmail.com', 587)],
      ['SMTP smtp.gmail.com:465', () => tcp('smtp.gmail.com', 465)],
      ['SMTP gmail-smtp-in.l.google.com:25', () => tcp('gmail-smtp-in.l.google.com', 25)],
      ['other port portquiz.net:8080', () => tcp('portquiz.net', 8080)],
      ['other port 1.1.1.1:22', () => tcp('1.1.1.1', 22)],
      ['DNS (udp) to 8.8.8.8', () => udpDns('8.8.8.8')],
      ['DNS (udp) to 185.12.64.1 (allowed resolver)', () => udpDns('185.12.64.1')],
      ['IPv6 [2606:4700:4700::1111]:443', () => tcp('2606:4700:4700::1111', 443)],
      ['public 1.1.1.1:443', () => tcp('1.1.1.1', 443)],
      ['public HTTPS example.com', () => get('https://example.com/')],
      ['public HTTP example.com', () => get('http://example.com/')],
      ['Office public https://iscolinfree.com/theoffice/', () => get('https://iscolinfree.com/theoffice/')],
    ];
    for (const [name, f] of checks) out(name, await f());
  },
  async rate(n = '80') {
    // Opens n connections at once and holds them: the per-app cap is 64 open, 10 new/s after a burst of 40.
    const t0 = Date.now();
    const socks = [];
    const res = await Promise.all(
      Array.from({ length: Number(n) }, () =>
        new Promise((resolve) => {
          const s = net.connect({ host: '1.1.1.1', port: 443 });
          socks.push(s);
          s.setTimeout(8000, () => resolve('timeout'));
          s.on('connect', () => resolve(`ok@${Math.round((Date.now() - t0) / 100) / 10}s`));
          s.on('error', (e) => resolve(e.code));
        }),
      ),
    );
    const count = {};
    for (const r of res) {
      const k = r.startsWith('ok@') ? `connected within ${Math.ceil(Number(r.slice(3, -1)))}s` : r;
      count[k] = (count[k] || 0) + 1;
    }
    out(`open ${n} connections to 1.1.1.1:443 at once`, JSON.stringify(count));
    socks.forEach((s) => s.destroy());
    await new Promise((r) => setTimeout(r, 3000));
    let ok = 0;
    const t1 = Date.now();
    while (Date.now() - t1 < 6000) {
      const r = await tcp('1.1.1.1', 443, 1500);
      if (r.startsWith('CONNECTED')) ok++;
    }
    out('sequential new connections for 6s', `${ok} connected (${(ok / 6).toFixed(1)}/s)`);
  },
  async bw(url = 'https://hel1-speed.hetzner.com/100MB.bin') {
    const t0 = Date.now();
    let bytes = 0;
    await new Promise((resolve) => {
      const r = https.get(url, (res) => {
        res.on('data', (c) => {
          bytes += c.length;
          if (Date.now() - t0 > 10000) r.destroy();
        });
        res.on('end', resolve);
        res.on('close', resolve);
      });
      r.on('error', resolve);
    });
    const s = (Date.now() - t0) / 1000;
    out(`download ${url.split('/').pop()} for ${s.toFixed(1)}s`, `${(bytes / 1048576).toFixed(1)} MB = ${(bytes / 1048576 / s).toFixed(2)} MB/s`);
  },
  async oom() {
    const keep = [];
    for (let i = 1; i <= 64; i++) {
      keep.push(Buffer.alloc(32 * 1048576, i));
      console.log(`allocated ${i * 32} MB`);
      await new Promise((r) => setTimeout(r, 50));
    }
    out('allocated 2 GB', 'NOT KILLED');
  },
  async cpu(secs = '10') {
    const { Worker } = require('worker_threads');
    const t0 = Date.now();
    const c0 = process.cpuUsage();
    const n = 4;
    await Promise.all(Array.from({ length: n }, () => new Promise((resolve) => {
      const w = new Worker(`const e = Date.now() + ${Number(secs) * 1000}; let x = 0; while (Date.now() < e) x++; require('worker_threads').parentPort.postMessage(x);`, { eval: true });
      w.on('message', resolve);
    })));
    const c = process.cpuUsage(c0);
    const wall = (Date.now() - t0) / 1000;
    out(`${n} busy threads for ${secs}s`, `cpu ${((c.user + c.system) / 1e6).toFixed(1)}s over ${wall.toFixed(1)}s wall = ${((c.user + c.system) / 1e6 / wall).toFixed(2)} CPUs`);
  },
  async fork() {
    const t0 = Date.now();
    const r = cp.spawnSync('sh', ['-c', 'b() { b | b & }; b; sleep 15'], { timeout: 20000, encoding: 'utf8' });
    out('fork bomb (20s)', `ended after ${Date.now() - t0}ms, status ${r.status} signal ${r.signal} err ${String(r.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || '-'}`);
    const procs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).length;
    out('processes visible right after', procs);
    out('this process still alive', 'yes');
  },
  async fs() {
    for (const p of ['/app/x', '/etc/x', '/usr/local/bin/x', '/x', '/var/x', '/root/x', '/home/x']) {
      try {
        fs.writeFileSync(p, 'x');
        out(`write ${p}`, 'WRITTEN (bad)');
      } catch (e) {
        out(`write ${p}`, e.code);
      }
    }
    for (const p of ['/tmp/x', '/data/x']) {
      try {
        fs.writeFileSync(p, 'x');
        out(`write ${p}`, 'ok');
      } catch (e) {
        out(`write ${p}`, e.code);
      }
    }
    fs.writeFileSync('/tmp/s.sh', '#!/bin/sh\necho ran\n', { mode: 0o755 });
    const r = cp.spawnSync('/tmp/s.sh', { encoding: 'utf8' });
    out('exec a script from /tmp', r.error ? r.error.code : `ran (status ${r.status})`);
    try {
      const fd = fs.openSync('/data/fill', 'w');
      const chunk = Buffer.alloc(8 * 1048576, 1);
      let mb = 0;
      try {
        for (; mb < 600; mb += 8) fs.writeSync(fd, chunk);
      } catch (e) {
        out('fill /data with 600 MB', `${e.code} after ${mb} MB`);
      }
      fs.closeSync(fd);
      if (mb >= 600) out('fill /data with 600 MB', 'NO LIMIT (bad)');
    } finally {
      fs.rmSync('/data/fill', { force: true });
    }
    out('docker socket present', String(fs.existsSync('/var/run/docker.sock') || fs.existsSync('/run/docker.sock')));
  },
  async who() {
    const st = fs.readFileSync('/proc/self/status', 'utf8');
    const f = (k) => (st.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1];
    out('uid/gid', `${process.getuid()}/${process.getgid()}`);
    out('CapEff / CapBnd', `${f('CapEff')} / ${f('CapBnd')}`);
    out('NoNewPrivs', f('NoNewPrivs'));
    out('kernel seen inside', `${os.release()} (${fs.readFileSync('/proc/version', 'utf8').trim().slice(0, 60)})`);
    out('memory seen inside', `${Math.round(os.totalmem() / 1048576)} MB, ${os.cpus().length} CPUs`);
    out('root fs', (fs.readFileSync('/proc/mounts', 'utf8').split('\n').find((l) => l.split(' ')[1] === '/') || '?').slice(0, 80));
    out('/tmp mount', (fs.readFileSync('/proc/mounts', 'utf8').split('\n').find((l) => l.split(' ')[1] === '/tmp') || '?').slice(0, 80));
    out('/data mount', (fs.readFileSync('/proc/mounts', 'utf8').split('\n').find((l) => l.split(' ')[1] === '/data') || '?').slice(0, 80));
    out('env names', Object.keys(process.env).sort().join(','));
  },
};

const [name, ...args] = process.argv.slice(2);
if (!tests[name]) {
  console.error('usage: node attack.js <' + Object.keys(tests).join('|') + '>');
  process.exit(2);
}
tests[name](...args).then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
