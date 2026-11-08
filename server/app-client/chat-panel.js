// The conversation in the website chat, fetched the first time someone opens the bubble. Everything goes back to this site's own origin; nothing written here runs as HTML.
// The conversation lives in this tab's sessionStorage, not a cookie, and is gone when the tab is closed.
(function () {
  'use strict';
  var chat = window.__officeChat;
  if (!chat || chat.init) return;
  var API = '/_office/cloud/chat/', KEY = 'office_chat_v1', POLL_MS = 8000, MAX_LOG = 60;
  var CSS = '.p{position:fixed;z-index:1;right:16px;bottom:16px;width:360px;max-width:calc(100vw - 16px);height:520px;max-height:min(520px,calc(100vh - 32px));max-height:min(520px,calc(100dvh - 32px));background:#fff;color:#1f2430;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font:15px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
    + '.p.left{right:auto;left:16px}.p.open{display:flex}'
    + '@media (max-width:520px){.p,.p.left{left:8px;right:8px;bottom:8px;width:auto;max-width:none;height:min(78vh,560px);height:min(78dvh,560px);max-height:calc(100dvh - 16px)}}'
    + 'button,input{font:inherit}'
    + '.h{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;background:#1f2430;color:#fff}.h b{display:block;font-size:15px;font-weight:650}.h small{display:block;opacity:.75;font-size:12px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}'
    + '.x{all:unset;box-sizing:border-box;margin-left:auto;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:8px;font-size:20px;line-height:1}.x:hover{background:rgba(255,255,255,.14)}.x:focus-visible,.go:focus-visible,.link:focus-visible{outline:2px solid #6aa5ff;outline-offset:1px}'
    + '.n{margin:0;padding:8px 14px;font-size:12px;line-height:1.35;color:#555c6b;background:#f4f5f7;border-bottom:1px solid #e5e7eb}'
    + '.l{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}'
    + '.m{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f1f4}.m.visitor{align-self:flex-end;background:#1f2430;color:#fff}.m.boss{background:#e7f1ff}.m small{display:block;font-size:11px;font-weight:600;color:#3b5b92;margin-bottom:2px}.m.wait{color:#6a7180}'
    + '.xtra{display:none;padding:8px 12px 0;gap:6px;flex-wrap:wrap;align-items:center}.xtra.on{display:flex}.xtra span{font-size:13px;color:#555c6b;flex-basis:100%}.xtra input{flex:1;min-width:140px;border:1px solid #cfd3da;border-radius:8px;padding:8px;font-size:16px}'
    + '.go,.link{all:unset;box-sizing:border-box;cursor:pointer}.go{background:#1f2430;color:#fff;border-radius:8px;padding:8px 12px;font-size:14px;font-weight:600}.go[disabled]{opacity:.5;cursor:default}.link{font-size:13px;color:#555c6b;text-decoration:underline;padding:6px 2px}'
    + '.f{display:flex;gap:6px;padding:8px 12px 10px;border-top:1px solid #e5e7eb;margin-top:8px}.f input{flex:1;min-width:0;border:1px solid #cfd3da;border-radius:10px;padding:9px 10px;font-size:16px;color:#1f2430;background:#fff}.foot{padding:0 12px 10px;display:flex;justify-content:center}'
    + '@media (prefers-color-scheme:dark){.p{background:#171a21;color:#e8eaf0}.n{background:#1f232c;color:#a8afbd;border-color:#2c313c}.m{background:#262b36}.m.visitor{background:#3a4358}.m.boss{background:#22334f}.m small{color:#9bbcf2}.f{border-color:#2c313c}.f input,.xtra input{background:#1f232c;color:#e8eaf0;border-color:#3a4050}.go{background:#e8eaf0;color:#171a21}.link,.xtra span{color:#a8afbd}}';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }

  chat.init = function (root, bubble, host) {
    var s = load();
    s.log = s.log || [];
    function save() { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: the conversation just won't survive a reload */ } }
    try { var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = root.adoptedStyleSheets.concat(sheet); }
    catch (e) { var style = el('style'); style.textContent = CSS; root.appendChild(style); }

    var panel = el('section', 'p');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chat with our AI assistant');
    var head = el('header', 'h');
    var who = el('div'); var title = el('b', '', 'AI assistant'); var sub = el('small', '', 'Ask us anything');
    who.appendChild(title); who.appendChild(sub);
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close chat');
    head.appendChild(who); head.appendChild(x);
    var notice = el('p', 'n', 'You\'re chatting with an AI assistant. Messages are read by an AI and may be read by the company.');
    var log = el('div', 'l'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    var offer = el('div', 'xtra'); offer.appendChild(el('span', '', 'Pass your question on to the team?'));
    var yes = el('button', 'go', 'Yes, pass it on'); yes.type = 'button'; var no = el('button', 'link', 'No thanks'); no.type = 'button';
    offer.appendChild(yes); offer.appendChild(no);
    var emailBox = el('form', 'xtra'); emailBox.appendChild(el('span', '', 'Want a reply by email? (optional)'));
    var email = el('input'); email.type = 'email'; email.placeholder = 'you@example.com'; email.autocomplete = 'email'; email.maxLength = 254;
    var emailGo = el('button', 'go', 'Send'); emailGo.type = 'submit'; var emailNo = el('button', 'link', 'No thanks'); emailNo.type = 'button';
    emailBox.appendChild(email); emailBox.appendChild(emailGo); emailBox.appendChild(emailNo);
    var form = el('form', 'f');
    var input = el('input'); input.placeholder = 'Ask a question…'; input.setAttribute('aria-label', 'Your message'); input.maxLength = 800; input.autocomplete = 'off';
    var send = el('button', 'go', 'Send'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    var foot = el('div', 'foot'); var person = el('button', 'link', 'Talk to a person'); person.type = 'button'; foot.appendChild(person);
    panel.appendChild(head); panel.appendChild(notice); panel.appendChild(log); panel.appendChild(offer); panel.appendChild(emailBox); panel.appendChild(form); panel.appendChild(foot);
    root.appendChild(panel);

    var lastAsked = '', wantPerson = false, thinking = null, pollTimer = 0;
    function show(role, text, keep) {
      var m = el('div', 'm ' + role);
      if (role === 'boss') m.appendChild(el('small', '', 'From the company'));
      m.appendChild(document.createTextNode(text));
      log.appendChild(m); log.scrollTop = log.scrollHeight;
      if (keep !== false) { s.log.push({ role: role, text: text }); if (s.log.length > MAX_LOG) s.log = s.log.slice(-MAX_LOG); save(); }
      return m;
    }
    function post(path, body) {
      return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
    }
    function busy(on) { send.disabled = on; if (on) thinking = show('ai wait', 'Thinking…', false); else if (thinking) { thinking.remove(); thinking = null; } }
    function failed() { show('ai', 'Sorry, something went wrong. Please try again in a moment.'); }
    function after(r) {
      if (r.status === 403) { show('ai', r.message || 'The assistant isn\'t available right now.'); return; }
      if (!r.reply && r.message) { show('ai', r.message); return; }
      if (r.conversation) { s.token = r.conversation; save(); }
      if (r.reply) show('ai', r.reply.text);
      offer.classList.toggle('on', !!r.offer);
      if (r.handoff) { s.handed = true; if (r.askEmail && !s.emailed) emailBox.classList.add('on'); save(); poll(); startPolling(); }
    }
    function ask(text) {
      lastAsked = text;
      offer.classList.remove('on');
      show('visitor', text);
      busy(true);
      post(wantPerson ? 'handoff' : 'message', { text: text, conversation: s.token || undefined })
        .then(function (r) { busy(false); after(r); })
        .catch(function () { busy(false); failed(); });
      if (wantPerson) { wantPerson = false; input.placeholder = 'Ask a question…'; }
    }
    function passOn() {
      offer.classList.remove('on');
      var text = lastAsked;
      if (!text && !s.token) { wantPerson = true; input.placeholder = 'What should we pass on to the team?'; input.focus(); return; }
      busy(true);
      post('handoff', { text: text || undefined, conversation: s.token || undefined })
        .then(function (r) { busy(false); after(r); })
        .catch(function () { busy(false); failed(); });
    }
    function poll() {
      if (!s.token) return;
      post('updates', { conversation: s.token, after: s.after || 0 }).then(function (r) {
        (r.messages || []).forEach(function (m) { if (m.id > (s.after || 0)) { s.after = m.id; show('boss', m.text); } });
        save();
      }).catch(function () { /* the next round will do */ });
    }
    function startPolling() {
      if (pollTimer || !s.handed) return;
      pollTimer = setInterval(function () { if (!document.hidden && panel.classList.contains('open')) poll(); }, POLL_MS);
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); var t = input.value.trim(); if (!t || send.disabled) return; input.value = ''; ask(t); });
    yes.addEventListener('click', passOn);
    no.addEventListener('click', function () { offer.classList.remove('on'); });
    person.addEventListener('click', passOn);
    emailNo.addEventListener('click', function () { emailBox.classList.remove('on'); });
    emailBox.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = email.value.trim(); if (!v || emailGo.disabled) return;
      emailGo.disabled = true;
      post('email', { conversation: s.token, email: v }).then(function (r) {
        emailGo.disabled = false;
        if (r.ok) { s.emailed = true; save(); emailBox.classList.remove('on'); if (r.reply) show('ai', r.reply.text); } else show('ai', r.message || 'That didn\'t work. Please check the address.');
      }).catch(function () { emailGo.disabled = false; failed(); });
    });
    function close() {
      chat.opened = false;
      panel.classList.remove('open');
      bubble.style.display = '';
      bubble.focus();
    }
    x.addEventListener('click', close);
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    chat.show = function () {
      chat.opened = true;
      bubble.style.display = 'none';
      panel.classList.toggle('left', chat.corner === 'left');
      panel.classList.add('open');
      log.scrollTop = log.scrollHeight;
      if (window.matchMedia('(pointer:fine)').matches) input.focus();
      if (s.handed) { poll(); startPolling(); }
    };
    s.log.forEach(function (m) { show(m.role, m.text, false); });
    fetch(API + 'config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (c) {
      if (c.on === false) { show('ai', 'The assistant isn\'t available right now.', false); form.remove(); foot.remove(); return; }
      if (c.company) sub.textContent = c.company;
      if (c.notice) notice.textContent = c.notice;
      if (!s.log.length && c.greeting) show('ai', c.greeting, false);
    }).catch(function () { /* the panel still works without its greeting */ });
    chat.show();
  };
})();
