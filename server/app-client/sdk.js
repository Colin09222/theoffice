// Office Cloud: accounts, a database, saves, leaderboards, multiplayer rooms, uploads, AI and web fetching for a published project, with no server code.
//   <script src="/_office/office.js"></script>   then   const office = Office.connect();
// The project is whichever site the page is on: data never crosses to another project. On a local preview with no Office server
// behind it, everything except accounts and uploads keeps working on this device only, and office.mode says 'local'.
(function () {
  'use strict';
  if (window.Office && window.Office.connect) return;
  var API = '/_office/cloud/';
  var memory = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (k in memory ? memory[k] : null) : v; } catch (e) { return k in memory ? memory[k] : null; } },
    set: function (k, v) { memory[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* the memory copy will do */ } },
    del: function (k) { delete memory[k]; try { localStorage.removeItem(k); } catch (e) { /* gone anyway */ } },
  };
  var parse = function (s, d) { try { return s === null || s === undefined ? d : JSON.parse(s); } catch (e) { return d; } };
  function randomToken() {
    var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  // The same device token the older _office/client.js uses, so a guest stays one guest.
  function player() { var t = store.get('office.player'); if (!t || !/^[A-Za-z0-9_-]{32,64}$/.test(t)) { t = randomToken(); store.set('office.player', t); } return t; }
  function OfficeError(code, message, status) { var e = new Error(message || code); e.name = 'OfficeError'; e.code = code; e.status = status || 0; return e; }
  var enc = encodeURIComponent;

  var client = null;
  function connect() { if (!client) client = makeClient(); return client; }

  function makeClient() {
    var onWeb = (location.protocol === 'https:' || location.protocol === 'http:') && location.origin && location.origin !== 'null';
    var self = { mode: onWeb ? 'unknown' : 'local' };
    var session = store.get('office.session');
    var user = session ? parse(store.get('office.user'), null) : null;
    var authFns = [];
    var noted = false;
    function local() { if (!noted) { noted = true; try { console.info('Office Cloud: no Office server here, so data stays on this device. It goes live once the project is published.'); } catch (e) { /* no console */ } } self.mode = 'local'; }
    function setAuth(tok, u) {
      session = tok || null; user = tok ? u : null;
      if (session) { store.set('office.session', session); store.set('office.user', JSON.stringify(user)); } else { store.del('office.session'); store.del('office.user'); }
      for (var i = 0; i < authFns.length; i++) { try { authFns[i](user); } catch (e) { setTimeout(function () { throw e; }); } }
    }
    function request(method, path, body, opts) {
      opts = opts || {};
      if (self.mode === 'local') return Promise.reject(OfficeError('local', 'There is no Office server here.'));
      var headers = { 'x-office-player': player() };
      if (session) headers['x-office-session'] = session;
      var payload;
      if (opts.raw) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctl && setTimeout(function () { ctl.abort(); }, opts.timeout || 15000);
      var sent = session;
      return fetch(API + path, { method: method, headers: headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal: ctl && ctl.signal })
        .then(function (r) {
          // A plain static server answers with its own page: that means a local preview, not an error in the data.
          if ((r.headers.get('content-type') || '').indexOf('application/json') !== 0) { if (self.mode === 'unknown') local(); throw OfficeError('local', 'There is no Office server here.'); }
          self.mode = 'live';
          return r.json().then(function (j) {
            if (r.ok) return j;
            if (r.status === 401 && j.error === 'signed_out' && sent && sent === session) setAuth(null, null);
            throw OfficeError(j.error || 'failed', j.message || 'That did not work.', r.status);
          });
        }, function () { throw OfficeError('offline', 'Can\'t reach the server. Check the connection and try again.'); })
        .finally(function () { if (timer) clearTimeout(timer); });
    }
    // The server when there is one; this device when there isn't.
    function either(remote, fallback) {
      if (self.mode === 'local') return Promise.resolve().then(fallback);
      return remote().catch(function (e) { if (e && e.code === 'local') return fallback(); throw e; });
    }
    var who = function () { return user ? 'u.' + user.id : 'guest'; };
    var now = function () { return Date.now(); };

    // Whether there is an Office server behind this page at all: false on a plain local preview.
    var pinged = onWeb ? request('GET', 'ping').then(function () { return true; }, function (e) { return e.code !== 'local'; }) : Promise.resolve(false);

    // ---- accounts ----
    var localUsers = function () { return parse(store.get('office.cloud.users'), {}); };
    var auth = {
      get user() { return user; },
      /** {username or email, password (8+ characters), name}. Resolves to the new user, who is now logged in. */
      signUp: function (o) {
        o = o || {};
        return either(function () {
          return request('POST', 'auth/signup', { username: o.username, email: o.email, password: o.password, name: o.name }).then(function (r) { setAuth(r.session, r.user); return r.user; });
        }, function () {
          if (!o.password || String(o.password).length < 8) throw OfficeError('bad_password', 'A password is at least 8 characters.');
          var login = String(o.username || o.email || '').toLowerCase(); if (!login) throw OfficeError('need_login', 'Choose a username or give an email address.');
          var all = localUsers(); if (all[login]) throw OfficeError('username_taken', 'That username is taken.');
          var u = { id: 'local-' + randomToken().slice(0, 8), username: o.username || null, email: o.email || null, name: o.name || o.username || login.split('@')[0], local: true };
          all[login] = u; store.set('office.cloud.users', JSON.stringify(all)); setAuth('local', u); return u;
        });
      },
      /** {login: username or email, password}. */
      logIn: function (o) {
        o = o || {};
        var login = o.login || o.username || o.email;
        return either(function () {
          return request('POST', 'auth/login', { login: login, password: o.password }).then(function (r) { setAuth(r.session, r.user); return r.user; });
        }, function () {
          var u = localUsers()[String(login || '').toLowerCase()];
          if (!u) throw OfficeError('bad_login', 'That username or password is wrong.');
          setAuth('local', u); return u;
        });
      },
      logOut: function () {
        var p = session && session !== 'local' && self.mode !== 'local' ? request('POST', 'auth/logout', {}).catch(function () { return null; }) : Promise.resolve();
        return p.then(function () { setAuth(null, null); return true; });
      },
      /** Ask the server who is logged in. Resolves to the user or null. */
      refresh: function () {
        if (!session || session === 'local') return Promise.resolve(user);
        return request('GET', 'auth/me').then(function (r) { if (!r.user) setAuth(null, null); else setAuth(session, r.user); return user; }, function (e) { if (e.code === 'local' || e.code === 'offline') return user; throw e; });
      },
      onChange: function (fn) { authFns.push(fn); return function () { authFns = authFns.filter(function (x) { return x !== fn; }); }; },
      setName: function (name) { return request('PATCH', 'auth/me', { name: name }).then(function (r) { setAuth(session, r.user); return r.user; }); },
      changePassword: function (current, next) { return request('POST', 'auth/password', { password: current, newPassword: next }).then(function () { return true; }); },
      deleteAccount: function (password) { return request('POST', 'auth/delete', { password: password }).then(function () { setAuth(null, null); return true; }); },
    };

    // ---- the database ----
    var localDocs = function (c) { return parse(store.get('office.cloud.db.' + c), []); };
    var keepDocs = function (c, list) { store.set('office.cloud.db.' + c, JSON.stringify(list)); };
    var path = function (o, f) { return String(f).split('.').reduce(function (v, k) { return v && typeof v === 'object' ? v[k] : undefined; }, o); };
    function collection(name) {
      var base = 'db/' + enc(name);
      var mine = function (data, priv, id) { var t = now(); return { id: id || randomToken().slice(0, 16), data: data, owner: { id: user ? user.id : 'guest', name: user ? user.name : '', guest: !user }, mine: true, private: !!priv, version: 1, createdAt: t, updatedAt: t }; };
      function localFind(q) {
        q = q || {};
        var where = q.where || {}, sort = q.sort || 'createdAt', desc = q.order === 'desc';
        if (typeof sort === 'string' && sort.charAt(0) === '-') { sort = sort.slice(1); desc = true; }
        var list = localDocs(name).filter(function (d) { return Object.keys(where).every(function (k) { return path(d.data, k) === where[k]; }); });
        var key = function (d) { return sort === 'createdAt' || sort === 'updatedAt' || sort === 'id' ? d[sort] : path(d.data, sort); };
        list.sort(function (a, b) { var x = key(a), y = key(b); return (x === y ? 0 : x === undefined ? -1 : y === undefined ? 1 : x < y ? -1 : 1) * (desc ? -1 : 1); });
        var off = q.offset || 0; return list.slice(off, off + (q.limit || 50));
      }
      return {
        /** Add a document. Anyone can read it unless {private: true}; only you can change or delete it. Resolves to {id, data, owner, mine, ...}. */
        add: function (data, opts) {
          opts = opts || {};
          return either(function () { return request('POST', base, { data: data, id: opts.id, private: !!opts.private }); }, function () { var l = localDocs(name); var d = mine(data, opts.private, opts.id); l.push(d); keepDocs(name, l); return d; });
        },
        /** One document, or null if there is none you can see. */
        get: function (id) {
          return either(function () { return request('GET', base + '/' + enc(id)).catch(function (e) { if (e.status === 404) return null; throw e; }); },
            function () { return localDocs(name).filter(function (d) { return d.id === id; })[0] || null; });
        },
        /** Create or replace a document with this id. */
        set: function (id, data, opts) {
          opts = opts || {};
          return either(function () { return request('PUT', base + '/' + enc(id), { data: data, private: opts.private, ifVersion: opts.ifVersion }); }, function () {
            var l = localDocs(name).filter(function (d) { return d.id !== id; }); var d = mine(data, opts.private, id); l.push(d); keepDocs(name, l); return d;
          });
        },
        /** Change some top-level fields; a null value removes that field. */
        update: function (id, patch, opts) {
          opts = opts || {};
          return either(function () { return request('PATCH', base + '/' + enc(id), { data: patch, ifVersion: opts.ifVersion }); }, function () {
            var l = localDocs(name); var d = l.filter(function (x) { return x.id === id; })[0];
            if (!d) throw OfficeError('not_found', 'No such document.', 404);
            Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete d.data[k]; else d.data[k] = patch[k]; });
            d.version++; d.updatedAt = now(); keepDocs(name, l); return d;
          });
        },
        remove: function (id) {
          return either(function () { return request('DELETE', base + '/' + enc(id)).then(function () { return true; }); }, function () { keepDocs(name, localDocs(name).filter(function (d) { return d.id !== id; })); return true; });
        },
        /** {where: {field: value}, sort: 'field' or '-field', limit (max 100), offset, mine: true}. Resolves to an array of documents. */
        find: function (q) {
          q = q || {};
          var sort = q.sort, order = q.order;
          if (typeof sort === 'string' && sort.charAt(0) === '-') { sort = sort.slice(1); order = 'desc'; }
          var qs = ['limit=' + (q.limit || 50)];
          if (q.where) qs.push('where=' + enc(JSON.stringify(q.where)));
          if (sort) qs.push('sort=' + enc(sort));
          if (order) qs.push('order=' + enc(order));
          if (q.offset) qs.push('offset=' + q.offset);
          if (q.mine) qs.push('mine=1');
          return either(function () { return request('GET', base + '?' + qs.join('&')).then(function (r) { return r.docs; }); }, function () { return localFind(q); });
        },
        count: function () { return either(function () { return request('GET', base + '?count=1').then(function (r) { return r.count; }); }, function () { return localDocs(name).length; }); },
      };
    }

    // ---- saves: this player's own, mirrored on the device ----
    var mirror = function (key) { return 'office.cloud.save.' + who() + '.' + key; };
    var saves = {
      /** This player's value, or the fallback. Logged in, it follows them to any device; as a guest, it stays with this browser. */
      get: function (key, fallback) {
        var mine = parse(store.get(mirror(key)), undefined);
        var have = mine === undefined ? fallback : mine;
        return either(function () {
          return request('GET', 'saves/' + enc(key)).then(function (r) {
            // Nothing on the server yet: a copy made on this device while offline goes up now.
            if (r.found === false) { if (mine !== undefined) saves.set(key, mine).catch(function () { return null; }); return have; }
            store.set(mirror(key), JSON.stringify(r.value)); return r.value;
          }, function (e) { if (e.code === 'offline') return have; throw e; });
        }, function () { return have; });
      },
      /** Save any JSON up to 64 KB. Resolves true once the server has it, or false if it is only on this device for now. */
      set: function (key, value) {
        store.set(mirror(key), JSON.stringify(value));
        return either(function () { return request('PUT', 'saves/' + enc(key), { value: value }).then(function () { return true; }, function (e) { if (e.code === 'offline') return false; throw e; }); }, function () { return false; });
      },
      remove: function (key) {
        store.del(mirror(key));
        return either(function () { return request('DELETE', 'saves/' + enc(key)).then(function () { return true; }); }, function () { return true; });
      },
      list: function () {
        return either(function () { return request('GET', 'saves').then(function (r) { return r.saves; }); }, function () {
          var out = []; var pre = 'office.cloud.save.' + who() + '.';
          try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(pre) === 0) out.push({ key: k.slice(pre.length) }); } } catch (e) { /* none */ }
          return out;
        });
      },
    };

    // ---- leaderboards ----
    var boardKey = function (b) { return 'office.cloud.board.' + b; };
    var leaderboard = {
      /** One entry per player, best kept. {name} for guests (accounts use their own name), {lower: true} when lower is better, such as a time. */
      submit: function (board, score, opts) {
        opts = opts || {};
        return either(function () { return request('POST', 'boards/' + enc(board), { score: score, name: opts.name, lower: !!opts.lower }); }, function () {
          var b = parse(store.get(boardKey(board)), null) || { lower: !!opts.lower, best: null };
          var better = b.best === null || (b.lower ? score < b.best : score > b.best);
          if (better) { b.best = score; b.name = user ? user.name : opts.name || 'Guest'; store.set(boardKey(board), JSON.stringify(b)); }
          return { board: board, lower: b.lower, best: b.best, improved: better, rank: 1 };
        });
      },
      /** {entries: [{rank, name, score, you}], me: {rank, score} or null}. Show names with textContent, never innerHTML. */
      top: function (board, opts) {
        opts = opts || {};
        return either(function () { return request('GET', 'boards/' + enc(board) + '?limit=' + (opts.limit || 10) + (opts.lower ? '&order=asc' : '')); }, function () {
          var b = parse(store.get(boardKey(board)), null);
          var e = b && b.best !== null ? [{ rank: 1, name: b.name, score: b.best, you: true }] : [];
          return { board: board, lower: b ? b.lower : !!opts.lower, entries: e, me: e.length ? { rank: 1, score: b.best } : null };
        });
      },
    };

    // ---- uploads ----
    var localFiles = [];
    var files = {
      /** Upload an image, sound or video (up to 5 MB). Resolves to {id, url, type, size, name}; put the url in an <img> or <audio>. */
      upload: function (blob, opts) {
        opts = opts || {};
        if (!blob || typeof blob.size !== 'number') return Promise.reject(OfficeError('bad_file', 'Pick a file first.'));
        if (blob.size > 5 * 1024 * 1024) return Promise.reject(OfficeError('too_large', 'A file can be at most 5 MB.'));
        var name = opts.name || blob.name || 'file';
        return either(function () { return request('POST', 'files?name=' + enc(name), blob, { raw: true, timeout: 120000 }); }, function () {
          var f = { id: randomToken().slice(0, 22), url: URL.createObjectURL(blob), type: blob.type, size: blob.size, name: name, local: true };
          localFiles.unshift(f); return f;
        });
      },
      /** Your own uploads, newest first. */
      list: function () { return either(function () { return request('GET', 'files').then(function (r) { return r.files; }); }, function () { return localFiles.slice(); }); },
      remove: function (id) { return either(function () { return request('DELETE', 'files/' + enc(id)).then(function () { return true; }); }, function () { localFiles = localFiles.filter(function (f) { return f.id !== id; }); return true; }); },
      url: function (id) { return API + 'files/' + enc(id); },
    };

    // ---- multiplayer rooms ----
    function Room(name, opts) {
      this.name = name; this.opts = opts || {}; this.me = null; this.members = []; this.state = {}; this.live = false; this.left = false;
      this._fns = {}; this._queue = []; this._tries = 0; this._ws = null;
      var room = this;
      this.ready = new Promise(function (res, rej) { room._res = res; room._rej = rej; });
      this.ready.catch(function () { return null; });
      // Wait to learn whether there is a server here before choosing between a real room and a room of one.
      pinged.then(function (there) { if (room.left) return; if (there) room._open(); else room._local(); });
    }
    Room.prototype.on = function (type, fn) { (this._fns[type] = this._fns[type] || []).push(fn); return this; };
    Room.prototype.off = function (type, fn) { this._fns[type] = (this._fns[type] || []).filter(function (x) { return x !== fn; }); return this; };
    Room.prototype._emit = function (type) {
      var args = Array.prototype.slice.call(arguments, 1); var list = (this._fns[type] || []).slice();
      for (var i = 0; i < list.length; i++) { try { list[i].apply(this, args); } catch (e) { setTimeout(function () { throw e; }); } }
    };
    Room.prototype._member = function (id) { for (var i = 0; i < this.members.length; i++) if (this.members[i].id === id) return this.members[i]; return null; };
    Room.prototype._local = function () {
      var room = this;
      room._isLocal = true;
      setTimeout(function () {
        local();
        room.me = { id: 'me', name: (user && user.name) || room.opts.name || 'Guest', user: user ? user.id : null, guest: !user, presence: room.opts.presence === undefined ? null : room.opts.presence, you: true };
        room.members = [room.me]; room.live = true; room._res(room); room._emit('ready', room);
      });
    };
    Room.prototype._open = function () {
      var room = this;
      var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + 'rooms/' + enc(this.name));
      this._ws = ws;
      ws.onopen = function () { ws.send(JSON.stringify({ t: 'hello', session: session && session !== 'local' ? session : undefined, player: player(), name: room.opts.name, presence: room.opts.presence })); };
      ws.onmessage = function (ev) {
        var m = parse(ev.data, null); if (!m) return;
        if (m.t === 'welcome') {
          self.mode = 'live'; room._tries = 0; room.live = true;
          m.you.you = true; room.me = m.you; room.members = [m.you].concat(m.members); room.state = m.state || {};
          var q = room._queue; room._queue = []; for (var i = 0; i < q.length; i++) ws.send(q[i]);
          room._res(room); room._emit('ready', room);
        } else if (m.t === 'join') { room.members.push(m.member); room._emit('join', m.member); } else if (m.t === 'leave') {
          var gone = room._member(m.id); room.members = room.members.filter(function (x) { return x.id !== m.id; }); if (gone) room._emit('leave', gone);
        } else if (m.t === 'msg') { room._emit('message', m.data, room._member(m.from) || { id: m.from }, !!m.direct); } else if (m.t === 'state') {
          if (m.value === null) delete room.state[m.key]; else room.state[m.key] = m.value;
          room._emit('state', m.key, m.value, room._member(m.by) || { id: m.by });
        } else if (m.t === 'presence') { var who2 = room._member(m.id); if (who2) { who2.presence = m.data; room._emit('presence', who2); } } else if (m.t === 'error') room._emit('error', OfficeError(m.code, m.message));
      };
      ws.onclose = function (ev) {
        room.live = false; room._ws = null;
        if (room.left) return;
        var fatal = [1008, 1009, 4003, 4004, 4400, 4401].indexOf(ev.code) >= 0;
        if (!fatal && room._tries < 6) {
          room._tries++; room._emit('reconnecting', room._tries);
          setTimeout(function () { if (!room.left) room._open(); }, Math.min(8000, 500 * Math.pow(2, room._tries)));
          return;
        }
        var e = OfficeError(ev.code === 4003 ? 'room_full' : ev.code === 4401 ? 'signed_out' : 'closed', ev.reason || 'The room closed.');
        room._rej(e); room._emit('close', { code: ev.code, reason: ev.reason });
      };
    };
    Room.prototype._send = function (m) {
      if (this.left) return;
      if (this._isLocal) { if (m.t === 'set') this._localSet(m.key, m.value); return; }
      var s = JSON.stringify(m);
      // Sent once the room says welcome, including after a reconnect.
      if (this.live && this._ws && this._ws.readyState === 1) this._ws.send(s); else if (this._queue.length < 50) this._queue.push(s);
    };
    Room.prototype._localSet = function (key, value) { if (value === null || value === undefined) delete this.state[key]; else this.state[key] = value; this._emit('state', key, value === undefined ? null : value, this.me); };
    /** Send to everyone else in the room. Any JSON up to 8 KB, up to 20 messages a second. */
    Room.prototype.send = function (data) { this._send({ t: 'send', data: data }); };
    Room.prototype.sendTo = function (memberId, data) { this._send({ t: 'to', to: memberId, data: data }); };
    /** Shared state every member sees, including people who join later. null removes a key. Gone when the room empties. */
    Room.prototype.set = function (key, value) { this._send({ t: 'set', key: key, value: value === undefined ? null : value }); };
    Room.prototype.setPresence = function (data) { if (this.me) this.me.presence = data; this._send({ t: 'presence', data: data }); };
    Room.prototype.leave = function () { this.left = true; this.live = false; if (this._ws) { try { this._ws.close(1000, 'bye'); } catch (e) { /* gone */ } } this._emit('close', { code: 1000, reason: 'left' }); };
    var rooms = {
      /** Join (or open) a room by name: office.rooms.join('lobby', {name, presence}). Listen with room.on('ready'|'join'|'leave'|'message'|'state'|'presence'|'error'|'close'). */
      join: function (name, opts) { return new Room(String(name), opts); },
      /** Open rooms in this project: [{name, players, full}]. */
      list: function () { return either(function () { return request('GET', 'rooms').then(function (r) { return r.rooms; }); }, function () { return []; }); },
    };

    // ---- AI and the web, answered by the server: a page never holds a key, and only ever says fast or smart ----
    function published(e) { if (e && e.code === 'local') throw OfficeError('local', 'This works once the site is published.'); throw e; }
    var ai = {
      /** A prompt, or {prompt or messages: [{role, content}], system, maxTokens, model: 'fast' | 'smart'}. Resolves to the reply's text; with details: true to {text, truncated, refused, model, tokens, left}. */
      chat: function (o) {
        if (typeof o === 'string') o = { prompt: o };
        o = o || {};
        return request('POST', 'ai/chat', { prompt: o.prompt, messages: o.messages, system: o.system, maxTokens: o.maxTokens, model: o.model }, { timeout: 70000 })
          .then(function (r) { return o.details ? r : r.text; }).catch(published);
      },
    };
    /** A public web page, through the server: {url, status, type, text, truncated, cached, json()}. HTML, JSON, XML and plain text only. */
    function fetchPage(url) {
      return request('POST', 'fetch', { url: String(url) }, { timeout: 30000 })
        .then(function (r) { r.json = function () { return JSON.parse(r.text); }; return r; }).catch(published);
    }
    /** A public web page, read for you: {url, status, type, title, description, meta, text, links: [{url, text}], truncated, cached}. No script on the page is run. */
    function scrapePage(url) { return request('POST', 'scrape', { url: String(url) }, { timeout: 30000 }).catch(published); }

    // ---- forms the boss reads (the same store the older client uses) ----
    var forms = {
      submit: function (form, fields) {
        if (self.mode === 'local') return Promise.resolve(false);
        return fetch('/_data/v1/form/' + enc(form), { method: 'POST', headers: { 'content-type': 'application/json', 'x-office-player': player() }, body: JSON.stringify({ fields: fields }), credentials: 'same-origin' })
          .then(function (r) { return (r.headers.get('content-type') || '').indexOf('application/json') === 0 ? r.json().then(function (j) { if (r.ok) return true; throw OfficeError(j.error, j.message, r.status); }) : false; }, function () { throw OfficeError('offline', 'Can\'t reach the server.'); });
      },
    };

    // ---- values every visitor shares, such as a counter (the same store the older client uses) ----
    var data = function (method, key, body) {
      return fetch('/_data/v1/shared/' + key, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          if ((r.headers.get('content-type') || '').indexOf('application/json') !== 0) { if (self.mode === 'unknown') local(); throw OfficeError('local', 'There is no Office server here.'); }
          return r.json().then(function (j) { if (r.ok) return j; throw OfficeError(j.error, j.message, r.status); });
        }, function () { throw OfficeError('offline', 'Can\'t reach the server.'); });
    };
    var sharedKey = function (k) { return 'office.cloud.shared.' + k; };
    var shared = {
      /** Anyone using the site can change these, so never keep anything private here or treat it as proof. */
      get: function (key, fallback) { return either(function () { return data('GET', enc(key)).then(function (r) { return r.value; }, function (e) { if (e.status === 404) return fallback; throw e; }); }, function () { return parse(store.get(sharedKey(key)), fallback); }); },
      set: function (key, value) { return either(function () { return data('PUT', enc(key), { value: value }).then(function () { return true; }); }, function () { store.set(sharedKey(key), JSON.stringify(value)); return true; }); },
      incr: function (key, by) {
        by = by === undefined ? 1 : by;
        return either(function () { return data('POST', enc(key) + '/incr', { by: by }).then(function (r) { return r.value; }); }, function () { var n = (parse(store.get(sharedKey(key)), 0) || 0) + by; store.set(sharedKey(key), JSON.stringify(n)); return n; });
      },
    };

    // ---- this project's own server, if the boss has given it one ----
    var serverAddress = null;
    var server = {
      /** The address of this project's server, or null. It is fixed once allowed, so the page can keep it. */
      url: function () {
        if (!serverAddress) serverAddress = request('GET', 'server').then(function (r) { return r.url || null; }, function () { serverAddress = null; return null; });
        return serverAddress;
      },
      /** A fetch to a path on that server. Rejects with code no_server when there isn't one. */
      fetch: function (path, opts) {
        return server.url().then(function (u) {
          if (!u) throw new OfficeError('no_server', 'This project has no server running.');
          return fetch(u + (String(path).charAt(0) === '/' ? '' : '/') + path, opts);
        });
      },
    };
    self.server = server;
    self.auth = auth; self.db = { collection: collection }; self.saves = saves; self.leaderboard = leaderboard; self.rooms = rooms; self.files = files; self.forms = forms; self.shared = shared; self.ai = ai; self.fetch = fetchPage; self.scrape = scrapePage;
    /** Settles once the stored login has been checked with the server (or there is none). */
    self.ready = pinged.then(function (there) { return there ? auth.refresh() : user; }).then(function () { return self; }, function () { return self; });
    return self;
  }

  window.Office = window.Office || {};
  window.Office.connect = connect;
  window.Office.Error = OfficeError;
  // The form call the launch checklist and older pages know, so a page needs only this one script.
  if (!window.Office.submitForm) window.Office.submitForm = function (form, fields) { return connect().forms.submit(form, fields); };
})();
