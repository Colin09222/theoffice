# App starter

Working already: a landing page (`#/`), sign up and sign in on Office Cloud accounts (`#/signup`, `#/signin`), a signed-in list with
create, edit, done and delete on `office.db.collection('items')` (private to each person), empty, loading and error states, settings kept
on the account with `office.saves`, sign out, and a clearly marked "coming soon" payments hook. No email exists here, so there is no
password reset; the sign-up form says so.

Make it this app: rename `items` to the spec's core object and give it its real fields, add the screens the spec lists, and give the
landing page the spec's real words. Keep the `data-office="..."` attributes on the auth form, the create form, the list and sign out:
the Tester's end-to-end check signs up, creates something, reloads, signs out and back in through them.
Payments stay a "coming soon" hook until the boss pastes a Stripe Payment Link (then a plain link to `_office/pay`).

AI and web data are built in too: `office.ai.chat({ prompt })` for AI features and `office.scrape(url)` for data from public pages (see `.office/OFFICE-CLOUD.md`). They run on the server, so a key never goes in the page. Both have daily limits: catch errors and show `err.message` kindly.
