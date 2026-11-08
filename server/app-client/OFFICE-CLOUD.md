# Office Cloud: the backend every published project has

Accounts, a database, saves, leaderboards, multiplayer rooms, uploads, AI and reading web pages, with no server code, no keys and nothing to set up.
It works on the published site (its own address, and any domain bought for it). Each project's data is its own: no other site can read it.

```html
<script src="_office/office.js"></script>          <!-- from a page in a folder: ../_office/office.js -->
<script>
  const office = Office.connect();
</script>
```

Every call returns a promise. When one fails, show `err.message` to the person; `err.code` says which problem it was (such as `username_taken`, `bad_login`, `rate_limited`, `quota`, `offline`).
Show anything a visitor wrote (names, posts, chat) with `textContent`, never `innerHTML`.

## Saves: this player's own
```js
await office.saves.set('progress', { level: 3, coins: 120 });   // any JSON up to 64 KB; true once the server has it
const p = await office.saves.get('progress', { level: 1, coins: 0 });  // the fallback when there is nothing yet
await office.saves.remove('progress'); await office.saves.list();       // [{key, size, updatedAt}]
```
A guest's saves stay with their browser. Logged in, they follow the account to any device, and a guest who signs up keeps them.
Up to 200 keys and 1 MB per player.

## Accounts
```js
const user = await office.auth.signUp({ username: 'sam', email: 'sam@example.com', password: 'at least 8', name: 'Sam' }); // username or email, or both
await office.auth.logIn({ login: 'sam', password: '...' });   // login is the username or the email
await office.auth.logOut();
office.auth.user;                       // {id, username, email, name} or null, right away
office.auth.onChange((user) => ...);    // after log-in, log-out, or a session that ran out
await office.ready;                     // the stored login has been checked with the server
await office.auth.setName('Sammy'); await office.auth.changePassword(old, next); await office.auth.deleteAccount(password);
```
**Nothing here sends email, so there is no password reset and no email confirmation.** Say so where people sign up ("keep your password safe: there's no reset yet"), and never promise an email.
Each project has its own list of people. Passwords are stored hashed; logging in is rate-limited. Usernames are 3 to 24 letters, digits, `_ . -`.

## Leaderboards
```js
const r = await office.leaderboard.submit('high', 4200, { name: 'Sam' });       // {best, improved, rank}
await office.leaderboard.submit('fastest', 31.4, { name: 'Sam', lower: true }); // lower is better, such as a time
const { entries, me } = await office.leaderboard.top('high', { limit: 10 });   // entries: [{rank, name, score, you}], me: {rank, score} or null
```
One entry per player, best kept. A logged-in player's name is their account name; `name` is for guests. A board's direction is settled by its first score.
Scores are numbers up to a trillion either way. Up to 50 boards a project.

## Data: collections of JSON documents
```js
const posts = office.db.collection('posts');
const doc = await posts.add({ text: 'Hello', tags: ['news'] });   // {id, data, owner: {id, name}, mine, private, createdAt, updatedAt, version}
await posts.add({ phone: '...' }, { private: true });             // only whoever added it can ever read it
await posts.get(doc.id);                                          // null if there is none you can see
await posts.update(doc.id, { text: 'Hi' });                       // change some fields; null removes one
await posts.set('about', { text: 'Fixed id' });                   // create or replace by id
await posts.remove(doc.id);
const list = await posts.find({ where: { author: 'sam' }, sort: '-createdAt', limit: 20, offset: 0 });
await posts.find({ mine: true }); await posts.count();
```
- Anyone can read a document unless it was added with `{private: true}`. Only whoever added it can change or delete it. Logged out, "whoever" is that browser.
- Anything personal, such as an email address or a phone number, is `{private: true}`, or goes to the boss with `Office.submitForm`.
- `where` matches top-level or dotted fields exactly (strings, numbers, true, false, null). `sort` is a field, `createdAt` or `updatedAt`, with `-` in front for newest or biggest first. Up to 100 a page.
- Documents are objects up to 32 KB. Collection names are 1 to 40 letters, digits, `_ -`. Up to 50 collections and 20 MB of data a project.
- `update` and `set` take `{ifVersion}` to refuse a change if someone else got there first (`version_conflict`).

## Multiplayer rooms
```js
const room = office.rooms.join('lobby', { name: 'Sam', presence: { x: 0, y: 0 } });
room.on('ready', () => draw(room.members));             // room.me, room.members (you included, you: true), room.state
room.on('join', (m) => ...); room.on('leave', (m) => ...);
room.on('message', (data, from) => ...);                 // from room.send by someone else
room.on('state', (key, value, by) => ...);               // shared state changed (yours too)
room.on('presence', (m) => ...);                         // m.presence changed
room.on('error', (err) => ...); room.on('close', () => ...);
room.send({ type: 'shot', x: 3 });                       // to everyone else
room.sendTo(memberId, data);                             // to one person
room.set('door', 'open');                                // shared state: everyone sees it, including people who join later
room.setPresence({ x: 4, y: 2 });                        // little things about you: position, colour, status
room.leave();
await office.rooms.list();                               // [{name, players, full}]
```
Up to 16 people a room. Messages are JSON up to 8 KB, about 20 a second each; send positions a few times a second, not every frame.
A room's state is kept while anyone is in it and forgotten when the last person leaves: keep anything lasting in saves or data.
It reconnects by itself after a dropped connection.

## Uploads
```js
const f = await office.files.upload(input.files[0]);   // {id, url, type, size, name}; up to 5 MB
img.src = f.url;
await office.files.list(); await office.files.remove(f.id);
```
Images (PNG, JPEG, GIF, WebP, AVIF), sound (MP3, OGG, WAV, M4A) and video (MP4, WebM). The type is read from the file itself; anything else is refused.
Keep the url (or the id) in a document to show it to other people. Up to 100 files and 25 MB per person, 50 MB a project.

## AI
```js
const reply = await office.ai.chat({ prompt: 'Write a short welcome for a pizza shop.' });          // the text of the reply
const next = await office.ai.chat({
  system: 'You are the friendly help desk of this site. Answer in two sentences.',
  messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: question }],
  maxTokens: 300,        // the most it may write, up to 1,000 (600 if you leave it out)
  model: 'smart',        // 'fast' is the default and is right for nearly everything; 'smart' has a far smaller daily allowance
});
await office.ai.chat({ prompt: '...', details: true });          // {text, truncated, refused, model, tokens, left: {fast, smart}}
```
- It runs on the server. **Never put an API key in client code, and don't try to call an AI provider from the page:** you don't need a key, and anything in a page can be read by anyone.
- A prompt or a conversation can be up to 32,000 characters, and `system` up to 8,000. A conversation is up to 40 messages and ends with the user. `truncated` means it stopped at `maxTokens`.
- Each site has a daily token allowance and each visitor a rate limit, so a popular site can run out. **Always catch errors and show `err.message` in the page** (`ai_limit`, `ai_resting`, `ai_off`, `rate_limited`, `ai_unavailable`). It reads well as it is: no blank screens, no raw errors.
- What the model writes comes from the model, and a visitor can steer it. Show it with `textContent`, and never let it decide anything that matters.

## Payments
A site takes money through `office.pay`. It opens Stripe's own checkout page; the money goes to the boss's own Stripe account, and card details never touch the page, the server or you.
```js
const s = await office.pay.status();        // {ready, testMode, message, products: [{key, name, description, amountCents, currency, interval}]}
await office.pay.checkout({ product: 'pro' });   // takes the visitor to Stripe; {ok: false, message} when it can't
await office.pay.has('pro');                // true or false, decided on the server
await office.pay.manage();                  // takes a subscriber to Stripe to cancel or update their plan
```
- **Products and prices are proposed, then approved.** The manager proposes each one with `propose_product`; it goes on sale only when the boss taps approve. Until then `checkout` answers `{ok: false, code: 'no_product'}`. Never hard-code a price on the page: read it from `office.pay.status()`.
- **Always handle "not ready".** `office.pay.status()` gives `ready: false` and a `message` until the building has a Stripe key and the boss has connected their Stripe account. `checkout` and `manage` never throw: when they can't go ahead they resolve to `{ok: false, code, message}`. Show that message in the page, as text.
- **It needs an account.** A purchase stays with the signed-in Office Cloud account, so `checkout` answers `signed_out` for a guest; send them to sign up first.
- **Back from Stripe**, the page is at the URL they left with `?office_pay=success` or `?office_pay=cancelled` added (or pass `{ returnPath }` to choose another page on this site). Call `office.pay.has(product)` and unlock; don't trust the URL.
- **Subscriptions and refunds are automatic.** A subscription that lapses or is cancelled, and a refund, make `has` false again. Refunds are the boss's button; there is no refund from the page.
- **Paid data is enforced by the server.** List collections in the proposal's `unlocks`: that collection then answers `402 payment_required` to everyone but buyers, whatever the page does. Never put paid content in the site's files or an unlocked collection: anyone can read those.
- A local preview has no server, so `status()` says not ready: build and check that state there.

## Web pages: fetch and scrape
```js
const page = await office.scrape('https://example.com/news');   // {url, status, type, title, description, meta, text, links: [{url, text}], truncated, cached}
list.textContent = page.title + '\n' + page.text.slice(0, 500);
const r = await office.fetch('https://example.com/data.json');  // {url, status, type, text, truncated, cached}
if (r.status === 200) render(r.json());                         // json() parses r.text
```
- Use `office.scrape` for the words and links of a page and `office.fetch` for raw JSON, XML or HTML. A browser can't fetch other sites itself, so use these.
- Only public `http` and `https` pages, and only HTML, JSON, XML and plain text. No file downloads, no pictures, and no script on the page runs. Nothing is sent but the address: no cookies, no headers of yours.
- Each site's `robots.txt` is obeyed, so a site can say no (`robots_denied`). The same page is remembered for a few minutes, so don't fetch it in a loop.
- A site has a daily allowance of pages, and each address and each site can only be visited so often. **Always catch errors and show `err.message`** (`fetch_limit`, `fetch_off`, `robots_denied`, `host_busy`, `fetch_blocked`, `fetch_failed`, `fetch_timeout`, `fetch_type`).
- Scraped words are written by a stranger: show them with `textContent`, never `innerHTML`. To summarise one with the AI, keep it short: `office.ai.chat({ prompt: 'Summarise: ' + page.text.slice(0, 20000) })`.
- Neither AI nor fetching works in a local preview (`err.code` is `local`): they work on the published site.

## Also
- `office.shared.get(key, fallback)`, `office.shared.set(key, value)`, `office.shared.incr(key, by)`: values every visitor shares, such as a counter. Anyone can change them.
- `Office.submitForm('waitlist', { email, name })`: a form only the boss can read (`office.forms.submit` is the same).
- `office.mode` is `'live'` on the published site and `'local'` on a preview with no Office server behind it. There, everything runs on that one device: accounts are pretend, nobody else is in a room, and nothing reaches the server. Say so rather than calling it saved.
- Too many requests get `rate_limited`; a full project gets `quota`. Show the message and carry on.
- Every launched site or app (not games) gets a small AI chat bubble for visitors, added by the building when the page is served. Don't build your own and don't remove it: it keeps off your fixed buttons by itself, the boss can turn it off per project, and the manager writes what it knows with `chat_faq`.

The example in `.office/examples/cloud-game/index.html` uses all of the main parts in one small page.

## This project's own server (rare)
Office Cloud covers almost everything. If the boss has allowed this project a server, `await office.server.url()` gives its address (or null), and `await office.server.fetch('/path', options)` calls it. It is a separate origin, so the server answers CORS (see the Node server starter's STARTER.md, or server_starter).
