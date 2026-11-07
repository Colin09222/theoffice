// The Office client library for published games and apps. Add it with <script src="_office/client.js"></script> and use window.Office.
// Works offline and under a local preview server: everything is mirrored to localStorage, and calls that can't reach the backend fall back to that copy.
(function () {
  'use strict';
  var script = document.currentScript;
  var base = script && script.src ? script.src.replace(/_office\/client\.js.*$/, '_data/v1/') : './_data/v1/';
  var memory = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (k in memory ? memory[k] : null) : v; } catch (e) { return k in memory ? memory[k] : null; } },
    set: function (k, v) { memory[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* the memory copy will do */ } },
    del: function (k) { delete memory[k]; try { localStorage.removeItem(k); } catch (e) { /* gone anyway */ } },
  };
  function randomToken() {
    var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function player() {
    var t = store.get('office.player');
    if (!t) { t = randomToken(); store.set('office.player', t); }
    return t;
  }
  var online = location.protocol === 'http:' || location.protocol === 'https:';
  var Offline = function () { this.offline = true; };
  function call(method, path, body) {
    if (!online) return Promise.reject(new Offline());
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 6000);
    var headers = { 'x-office-player': player() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl && ctl.signal, credentials: 'same-origin' })
      .catch(function () { throw new Offline(); })
      .then(function (r) {
        var isJson = (r.headers.get('content-type') || '').indexOf('application/json') === 0;
        // A plain static server answers with its own 404 page: that means no backend here, not "no such key".
        if (!isJson) throw new Offline();
        return r.json().then(function (j) {
          if (r.ok) return j;
          var e = new Error(j.message || j.error || 'Request failed'); e.status = r.status; e.code = j.error; throw e;
        });
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  var localKey = function (k) { return 'office.save.' + k; };
  var boardKey = function (b) { return 'office.board.' + b; };
  var parse = function (s, d) { try { return s === null ? d : JSON.parse(s); } catch (e) { return d; } };

  var Office = {
    /** True once the shared backend has answered. False means saves live on this device only. */
    connected: false,
    /** Save something for this player. Always succeeds locally; resolves true if the backend has it too. */
    save: function (key, value) {
      store.set(localKey(key), JSON.stringify(value));
      return call('PUT', 'save/' + encodeURIComponent(key), { value: value }).then(function () { Office.connected = true; return true; }, function (e) { if (e && e.offline) return false; throw e; });
    },
    /** Load this player's value, or the fallback if there is none. */
    load: function (key, fallback) {
      var local = parse(store.get(localKey(key)), undefined);
      return call('GET', 'save/' + encodeURIComponent(key)).then(function (r) {
        Office.connected = true; store.set(localKey(key), JSON.stringify(r.value)); return r.value;
      }, function (e) {
        if (e && e.status === 404) { Office.connected = true; if (local !== undefined) { Office.save(key, local).catch(function () {}); return local; } return fallback; }
        if (e && e.offline) return local === undefined ? fallback : local;
        throw e;
      });
    },
    remove: function (key) { store.del(localKey(key)); return call('DELETE', 'save/' + encodeURIComponent(key)).then(function () { return true; }, function (e) { if (e && e.offline) return false; throw e; }); },
    /** Post a score. One entry per player, keeping their best. Pass {lower:true} when lower is better, such as a time. */
    submitScore: function (board, name, score, opts) {
      var lower = !!(opts && opts.lower);
      var list = parse(store.get(boardKey(board)), []);
      var mine = list.filter(function (x) { return x.you; })[0];
      if (!mine) { mine = { name: name, score: score, you: true }; list.push(mine); } else if (lower ? score < mine.score : score > mine.score) { mine.score = score; mine.name = name; }
      store.set(boardKey(board), JSON.stringify(list));
      return call('POST', 'board/' + encodeURIComponent(board), { name: name, score: score, lower: lower }).then(function (r) { Office.connected = true; return r; }, function (e) { if (e && e.offline) return { board: board, best: mine.score, improved: mine.score === score, offline: true }; throw e; });
    },
    /** Top scores, best first: [{rank, name, score, you}]. Render names with textContent. */
    leaderboard: function (board, opts) {
      opts = opts || {};
      var q = 'limit=' + (opts.limit || 20) + (opts.lower ? '&order=asc' : '');
      return call('GET', 'board/' + encodeURIComponent(board) + '?' + q).then(function (r) { Office.connected = true; return r.entries; }, function (e) {
        if (e && e.offline) {
          var list = parse(store.get(boardKey(board)), []).sort(function (a, b) { return opts.lower ? a.score - b.score : b.score - a.score; });
          return list.map(function (x, i) { return { rank: i + 1, name: x.name, score: x.score, you: !!x.you }; });
        }
        throw e;
      });
    },
    /** State every visitor shares. Anyone using the site can change it, so never keep anything private here. */
    shared: {
      get: function (key, fallback) { return call('GET', 'shared/' + encodeURIComponent(key)).then(function (r) { return r.value; }, function (e) { if (e && (e.status === 404 || e.offline)) return fallback; throw e; }); },
      set: function (key, value, opts) { var b = { value: value }; if (opts && opts.ifVersion !== undefined) b.ifVersion = opts.ifVersion; return call('PUT', 'shared/' + encodeURIComponent(key), b); },
      incr: function (key, by) { return call('POST', 'shared/' + encodeURIComponent(key) + '/incr', { by: by === undefined ? 1 : by }).then(function (r) { return r.value; }); },
    },
  };
  window.Office = Office;
})();
