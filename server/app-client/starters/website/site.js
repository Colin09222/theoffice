// The contact form: it posts to Office Cloud, where the boss reads it on the project card. Nothing here sends email.
// Company email hook: when company mail is switched on (server/mail.js), set notify to true to also send each message to the company inbox.
const COMPANY_EMAIL = { notify: false };
const office = Office.connect();
const form = document.querySelector('[data-office="contact-form"]'), status = document.querySelector('[data-office="form-status"]');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form), name = String(f.get('name') || '').trim(), email = String(f.get('email') || '').trim(), message = String(f.get('message') || '').trim();
  status.classList.remove('bad');
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message) { status.textContent = 'Please fill in your name, a real email address and a message.'; status.classList.add('bad'); return; }
  const btn = form.querySelector('button'); btn.disabled = true; status.textContent = 'Sending...';
  try {
    const ok = await office.forms.submit('contact', { name, email, message, website: String(f.get('website') || ''), ...(COMPANY_EMAIL.notify ? { notify: 'company' } : {}) });
    status.textContent = ok === false ? 'This preview has no Office server behind it, so nothing was sent. It works once the site is live.' : `Thanks, ${name}. Your message is in, and you'll hear back personally.`;
    if (ok !== false) form.reset();
  } catch (x) { status.textContent = x.message || 'That did not go through. Please try again.'; status.classList.add('bad'); } finally { btn.disabled = false; }
});
