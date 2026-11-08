// The website chat's bubble, on every launched page that has the chat on. It does nothing until the page has finished, takes up one corner the site isn't
// using, and the rest of the chat (chat-panel.js) is only fetched when someone presses it. No cookies, no tracking.
(function () {
  'use strict';
  if (window.__officeChat || window.top !== window.self || !Element.prototype.attachShadow) return;
  var chat = window.__officeChat = {};
  var SIZE = 56, EDGE = 16;
  var CSS = ':host{all:initial}button{all:unset;box-sizing:border-box;cursor:pointer}'
    + '.b{position:relative;width:52px;height:52px;margin:2px;border-radius:50%;background:#1f2430;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(.8);transition:opacity .18s,transform .18s;font:600 11px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
    + '.b.in{opacity:1;transform:none}.b:hover{background:#343b4d}.b:focus-visible{outline:3px solid #6aa5ff;outline-offset:2px}.b svg{width:26px;height:26px;fill:currentColor}'
    + '.t{position:absolute;top:-3px;right:-5px;background:#fff;color:#1f2430;border-radius:999px;padding:3px 6px;font-size:10px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25)}';

  function start() {
    var host = document.createElement('div');
    host.setAttribute('data-office-chat-host', '');
    host.style.cssText = 'position:fixed;z-index:2147483000;width:' + SIZE + 'px;height:' + SIZE + 'px;right:' + EDGE + 'px;bottom:' + EDGE + 'px;';
    var root = host.attachShadow({ mode: 'open' });
    try { var s = new CSSStyleSheet(); s.replaceSync(CSS); root.adoptedStyleSheets = [s]; }
    catch (e) { var st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); }
    var bubble = document.createElement('button');
    bubble.className = 'b'; bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Chat with our AI assistant');
    bubble.title = 'Chat with our AI assistant';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 256 256');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M216 48H40a16 16 0 0 0-16 16v160a15.8 15.8 0 0 0 9.3 14.5 16 16 0 0 0 17-2.2L82 208h134a16 16 0 0 0 16-16V64a16 16 0 0 0-16-16Z');
    svg.appendChild(path);
    var tag = document.createElement('span'); tag.className = 't'; tag.textContent = 'AI';
    bubble.appendChild(svg); bubble.appendChild(tag);
    root.appendChild(bubble);
    document.documentElement.appendChild(host);

    var spot = 0;
    function spots() {
      var h = window.innerHeight, mid = Math.max(EDGE, Math.round(h * 0.42));
      return [{ right: EDGE, bottom: EDGE }, { left: EDGE, bottom: EDGE }, { right: EDGE, bottom: mid }, { left: EDGE, bottom: mid }];
    }
    function pinned(el) { for (var n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) { var p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; }
    function atEnd() { var d = document.documentElement; return window.scrollY + window.innerHeight >= d.scrollHeight - 2; }
    var CONTROL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[onclick]';
    // Only something the visitor could otherwise press counts. Ordinary links scroll out of the way, unless the page has nowhere left to scroll.
    function free(s) {
      var x = s.left !== undefined ? s.left : window.innerWidth - s.right - SIZE, y = window.innerHeight - s.bottom - SIZE;
      var pts = [[x + 28, y + 28], [x + 6, y + 6], [x + SIZE - 6, y + 6], [x + 6, y + SIZE - 6], [x + SIZE - 6, y + SIZE - 6]];
      var end = atEnd();
      for (var i = 0; i < pts.length; i++) {
        var els = document.elementsFromPoint(pts[i][0], pts[i][1]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (el === host || el === document.documentElement || el === document.body) continue;
          if (el.closest(CONTROL) && (end || pinned(el))) return false;
        }
      }
      return true;
    }
    function go(i) {
      spot = i; var s = spots()[i];
      host.style.left = s.left !== undefined ? s.left + 'px' : 'auto';
      host.style.right = s.right !== undefined ? s.right + 'px' : 'auto';
      host.style.bottom = s.bottom + 'px';
      chat.corner = s.left !== undefined ? 'left' : 'right';
    }
    function place() {
      if (chat.opened) return;
      var all = spots();
      if (free(all[spot])) return go(spot);
      for (var i = 0; i < all.length; i++) if (free(all[i])) return go(i);
    }
    var timer = 0;
    function soon() { clearTimeout(timer); timer = setTimeout(place, 240); }
    place();
    addEventListener('resize', soon, { passive: true });
    addEventListener('scroll', soon, { passive: true });
    requestAnimationFrame(function () { bubble.className = 'b in'; });

    var loading = false;
    bubble.addEventListener('click', function () {
      if (chat.show) return chat.show();
      if (loading) return;
      loading = true;
      var script = document.createElement('script');
      script.src = '/_office/chat-panel.js'; script.async = true;
      script.onload = function () { if (chat.init) chat.init(root, bubble, host); };
      script.onerror = function () { loading = false; };
      document.head.appendChild(script);
    });
  }
  var begun = false;
  function later() { if (begun) return; begun = true; if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1200 }); else setTimeout(start, 300); }
  // After the page has finished, or a few seconds on for a page that never quite does.
  if (document.readyState === 'complete') later(); else { addEventListener('load', later, { once: true }); setTimeout(later, 6000); }
})();
