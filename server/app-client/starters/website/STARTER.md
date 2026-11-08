# Website starter

Working already: sections with in-page links (`#what`, `#how`, `#contact`), a sticky header, full search and social meta (title,
description, og:title, og:description, og:image, twitter:card, favicon, lang), a skip link, and a contact form that posts to Office Cloud
with `office.forms.submit('contact', ...)`, a spam trap, validation, a sending state, a thank-you and a clear error. The boss reads the
messages on the project card. Company email: `COMPANY_EMAIL.notify` in site.js is the one-line hook for when company mail is switched on.

Make it this site: the words from notes/copy.md, the look from notes/design.md (change the variables in site.css and the layout), the
sections the subject needs. Never invent a review, price, phone number, address or story. Keep `data-office="contact-form"` and
`data-office="form-status"`: the Tester submits the form through them. Replace og.svg with a real picture if one can be made here.
