STATUS: GREEN
JOB: 01 One skin
DONE MEANS: "Lobby and floor use the same 8 colours, 2 fonts and 1 card style."
  - public/css/skin.css (loaded last on the one page that serves lobby and floor) defines the 8 palette colours as CSS variables
    (--c-paper #F6F1E7, --c-card #FFFDF8, --c-ink #1F2430, --c-red #C93A24, --c-amber #F2A33A, --c-teal #17766F, --c-slate #5B6270,
    --c-line #E3DBCB), points every older variable (--ink, --paper, --teal, --tomato, --sun, --felt, --brass...) at them, and gives the
    red badge, the cream card, the dark wood directory, the brass lift, the cork wall, the floor plaque, the wooden desk panel and the
    modals one Card style (Card fill, 1px Line border, 14px corners, 16px padding, one soft shadow). One Button: Tower Red fill + white
    for the main action (.btn.primary, send, the Open an office pill), Ink outline for all others. The status badge (.badge with
    data-state working/waiting/idle/paused: Amber, Red, Slate outline, Slate fill) is defined here and used from j02 on.
  - Two families only: Bricolage Grotesque (headings) and DM Sans (body, labels; tabular figures). Self-hosted latin variable woff2 in
    public/assets/fonts/ (41 KB + 37 KB) from the npm packages @fontsource-variable/bricolage-grotesque@5.3.0 and
    @fontsource-variable/dm-sans@5.3.0; OFL credits in NOTICE and public/assets/NOTICE.txt. Lilita One, Barlow, Barlow Condensed and
    Patrick Hand are removed. No runtime font fetch from Google. The 3D scene keeps its sunset colours; its painted signs ask for
    "Fraunces", which now maps to Bricolage Grotesque, so even the signs use the two faces.
  - The phone sheet's own palette (mobile.css --m-*) is pointed at the same 8 colours. The about/privacy/terms pages (page.css) use the
    same palette and faces.
  - Proof: test/skin.test.js (5 tests): the 8 hex values as variables; no colour in skin.css outside the palette (+ white text on the red
    button); 15 text/background pairs the skin uses all at least 4.5:1 (lowest: Teal on Paper 4.84:1; white on Red 5.10:1, Slate on Paper 5.45:1); exactly two
    self-hosted woff2 families, no googleapis/gstatic anywhere in public/css or index.html, skin.css loaded last; one card / one button /
    four badge states. test/statics.test.js updated for the new font file names (the old test named lilita-one-400.woff2).
  - Screenshots (mock mode, 0 console errors): docs/redesign/jobs/j01/shots/{home,floor}-{visitor,boss}-{desktop 1440x900,phone 390x844}.jpg
TESTS: npm test 1697/1698. The one failure is test/domains.test.js "the key only travels over TLS ... over IPv4": listen EAFNOSUPPORT ::1,
  this container has no IPv6; unrelated to this job. Browser suites run: test/browser/redesign-shots.mjs (new: home and floor, visitor
  and boss, desktop and phone, 8 shots, 0 console errors). Other browser suites not run for this job (no layout or behaviour change).
DEPLOY NOTES: none. No migration, no env var, no admin command. Static files only (one new stylesheet, two new font files, four old ones removed).
RISKS: The older stylesheets still hold their own hard-coded colours on less-seen panels (Business, Numbers, mail, servers, customise
  dialogs); skin.css repaints the main surfaces and remaps the shared variables, so those panels mostly follow, but a few accents
  (e.g. coin buttons, some status colours inside Business) are still the old ones. Layout is untouched (jobs 14 to 16). Uppercase
  labels from the old sheets that are not overridden show in DM Sans.
