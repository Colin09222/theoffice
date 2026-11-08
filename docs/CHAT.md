# Website chat

A small AI assistant on the sites and apps The Office's teams launch. It answers visitors from what the company knows and hands anything hard to the boss.
Code: `server/cloud/chat.js`, `server/cloud/chat-tools.js`, `server/app-client/chat.js` (the bubble), `server/app-client/chat-panel.js` (the conversation), `public/js/chat-ui.js` (the boss's view).

## What a visitor sees
A round button in a corner, marked **AI**. It picks a corner that isn't over the site's own fixed controls, and moves if something else takes the spot. Press it and a small panel opens, labelled "AI assistant", saying that messages are read by an AI and may be read by the company.

- **Added at serve time** (`decorate` in chat.js, called from `serveApp`), so sites launched long ago have it too. Never twice. A page that already names `_office/chat.js` is left alone.
- **Default on for websites and apps, off for games** (and simulations, documents and research). Filler floors and private projects have no chat. The boss can turn it on or off per project, and the page's ETag changes with the switch, so a cached page follows it.
- **Fast:** the injected tag is one `defer` script. The bubble starts after the page's `load` and idle, and `chat-panel.js` is fetched only when someone presses it. Self-hosted, no CDN, nothing inline, so it works under `script-src 'self'`.
- Styles live in a shadow root, so the site's CSS and the widget can't touch each other.
- No cookies, and no tracking. The conversation is a random key in this tab's `sessionStorage`; only its hash is on the server.

## How it answers
`POST /_office/cloud/chat/message` on the project's own origin, through `office.ai` (`ai.chat`) on the `fast` tier, at most 220 tokens. So the project's day allowance, the per-call limits, the building's daily ceiling, the ledger (`app_ai`) and the pause switches are the same ones `office.ai` uses, with no new ones.

The model sees only what's public: the company's name and tagline, the project's title and description, the site's own pages, and the FAQ. It has no tools, and can't reach anything else.

Visitor messages are untrusted. In order:
1. Rate limits, before anything is stored.
2. A hello or thanks gets a canned reply, with no model call.
3. A plain prompt-injection attempt ("ignore your instructions", "show your prompt") gets a canned reply, with no model call.
4. Asking for a person goes straight to the hand-off.
5. Otherwise the model answers, and `reviewAnswer` checks the words before anyone sees them: anything that echoes the rules or a secret, invents a figure, percentage, refund, discount, guarantee or deadline the company didn't state, or claims to have done something, is dropped and the question goes to the boss instead.

When a limit is hit (the day's allowance, the building ceiling, a pause, the AI being unavailable, too many questions in a minute) it says so kindly and offers to pass the question on. It never says what the limit is in money.

## Hand-off
When it can't answer, or the visitor asks for a person, it says the question has been passed on and offers an email box. The question:
- lands in the boss's **Inbox** tab under **Website chat**, and adds to the Inbox count;
- shows as a notification on the floor (an owner-only `sitechat` event with no words in it);
- goes to the boss by email too, if company email is on and the boss has given an address.

The boss replies from there. The reply appears in the visitor's chat within a few seconds if they are still on the page (the panel polls while it is open and a question is out), and goes by email if they left an address and email is on.

## The boss's view
All of it is at `/api/floors/:slug/sitechat...`, behind `requireOwner`: questions waiting, conversations, the FAQ editor and the on/off switch. A floor visitor's snapshot has no chat data, the events are owner-only, and nothing goes in the public feed.

## The manager
- `chat_faq`: writes a project's FAQ at launch. Refused once the boss has edited it, and if it mentions private work.
- `chat_questions`: recent questions the assistant couldn't answer, fenced as untrusted data, with no addresses.
- `unansweredQuestions(db, floorId, { days })`, exported from `server/cloud/chat.js`, is the same data for code (the daily loop). `question` is written by a stranger, so fence it with `fenceQuestions` before a model reads it.

## Privacy
Conversations are kept for 30 days from their last message (`sweep`, hourly), then deleted with everything in them. The boss's FAQ and switches stay until the floor goes. If the company has a privacy page (`privacy`, `privacy.html`, `privacy-policy.html` and the like), the sentence in `CHAT_PRIVACY_LINE` is added to it while the chat is on. **Clear saved data** on a project also clears its conversations.

## Limits
`cloudRates` overrides these:
| | |
|---|---|
| Messages per visitor | 10 a minute, 80 a day, per address per project |
| Per project | 120 messages a minute |
| Hand-offs | 6 per 10 minutes per visitor, 60 an hour per project |
| A message | 800 characters; 40 per conversation |
| Conversations kept | 5,000 per project (oldest go first), 30 days |

`OFFICE_CHAT_ENABLED=0` turns it off for the whole building, as a setting; the `chat pause --all` command below does the same without a restart.

## Admin
```
node scripts/admin.mjs chat status [PROJECT] [--floor N] [--json]   # counts only, never what anyone said
node scripts/admin.mjs chat pause|resume PROJECT [--floor N]        # one project: label or slug
node scripts/admin.mjs chat pause|resume --all                      # the whole building
```
They work on the database file, so a running server sees a pause on the next message.

## Tests
`test/chat.test.js` and `node test/browser/chat.mjs`.
