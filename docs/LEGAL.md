# The Lawyer

Every company gets **Hollis**, job title **Lawyer**: dry, careful, a bit funny, and not a real lawyer (he says so first).
He drafts each project's own **Terms**, **Privacy Policy** and, if it takes money, **Refund Policy**, flags risky copy,
and says plainly when a business needs a real lawyer. Code: `server/legal.js`, `server/legal-role.js`, `public/js/legal-ui.js`.

## Who he is
- In `config/models.json` under `hireable.lawyer`: Sonnet 5.5, medium effort. His brief carries the honesty rules for any task the manager gives him.
- New companies get him by default (`engine.seedStaff` is wrapped in `legal.js`). Filler floors don't, and nor does a floor whose staff limit would leave no room to hire after him; those can add him with the card.
- A floor from before him gets an **Add Hollis** card under Requests: one tap, `POST /api/floors/:slug/legal/hire`. It uses the normal hire path, so nobody else's work or desk is touched. The Customise panel and the manager's `hire_staff` also work, and he's still Hollis.
- He stays through a floor reset, like a founding role.
- Tools (`LAWYER_TOOLS`): read and write files, fetch public pages (untrusted, wrapped like everyone else's), ask the boss, ask a colleague. **No** publishing, purchase requests, domains or email.

## What he does
- **Drafts cost nothing.** No model is called for them. They're built from fixed clauses, and each clause is switched on only by a feature the project really has: payments (live Stripe products, a payment link, or `office.pay` in the code), subscriptions, accounts (`office.auth`), saved data, scores, forms, email sign-ups, uploads, the site chat, AI features (`office.ai`), ad scripts, and the company mailbox. Nothing is claimed that the project doesn't show.
- **Facts he can't know**: legal or trading name, country or state, contact address. He asks the boss **once** (a boss-only message and a card under Requests). Until they're given, the drafts show `[waiting for the boss: ...]` and **can't be approved**. He never makes them up.
- **The boss's tap publishes.** Approve on the card (`POST /api/floors/:slug/legal/:project/approve` with the version the boss saw). Only then do the pages go up at the project's `/terms`, `/privacy` and `/refunds`, served from the approved copy, with links added to the foot of the project's HTML pages.
- **When things change** (payments on, a form added, chat on) he notices when the project is published again and on his rounds every 10 minutes, redrafts, and asks again. The approved version stays live until the boss approves the new one.
- **Copy review**: guaranteed results, health or money claims, testimonials or star ratings nobody gave, someone else's brand, or a name that's obviously someone else's trademark. These are flags sent to the boss when he drafts and just before a maker Launch. They never hold Launch.
- **Regulated or risky businesses** (gambling, alcohol or tobacco, health or medical, financial advice or investing, children's data, anything that may be illegal): he tells the boss it needs a real lawyer before launch, and doesn't draft it.

## Honesty
- Every draft card says once: *Drafted by AI, not legal advice. Have a real lawyer check it before relying on it.*
- He never says something is legal, compliant or safe.
- Published pages carry no authorship line and never claim a lawyer wrote them.

## The Office's own Terms
`/theoffice/terms` (`public/terms.html`), served like About and Privacy and linked with them and from the lobby. Bosses own their companies and are the sellers; tax, refunds and chargebacks are theirs; acceptable use; provided as is; office@iscolinfree.com. The Connect Stripe card says "By connecting you agree to the Terms, and you're the seller."

## Tests
- `test/legal.test.js` (unit and API, AI_MODE=mock).
- `test/browser/legal.mjs` (headless Chrome): facts, approve, live pages, footer, The Office Terms.

## Limits worth knowing
- The drafts are plain and general. They aren't jurisdiction-specific (no GDPR or CCPA clauses), and a refund window is never invented.
- Detection reads the project's files, so a feature the code hides from plain view can be missed. The boss sees the list of features each draft was written for.
- The trademark list is short and obvious on purpose. It's a prompt to look, not a search.
