# Floppy Ears – Test report (Margot)
Playwright with Chromium, served by python http.server. Desktop 1280x800 using real Space presses; phone 390x844 with hasTouch/isMobile and real touchscreen taps only. An autopilot flapped based on the dog's position.
- Desktop: 3 full runs of about 30s each, scores 44 / 47 / 41. A tennis ball was picked up and zoomies smashed posts in 2 of the 3 runs.
- Phone: 2 full runs, scores 26 / 40. The tap on "Play again" restarts the game, and the layout fits.
- First ten seconds: the first post arrives about 5s in on desktop and the first gaps are wide (240). Flapping every 450ms without looking ends at the first post, score 0, after about 5.5s. That is fair.
- Score goes up per post passed and per bone. Game over overlay shows Score and Best. Best survives a reload (localStorage + Office.save).
- Leaderboard (Office stubbed): name submit gives "Saved! Good dog." and the listing shows "1. Margot 44". Names are set with textContent.
- Mute: the button toggles the icon, and the setting survives a reload.
- Console: no JS errors. The only errors are 404/501 replies from the local Office API calls, which is expected in a preview.
- Launch check (`node launch-check.mjs . game`): OK: page title, search description, works on phones (viewport), language set, social preview text, social preview image, favicon, no invented claims or contact details found.
No bugs found, and no code changes made.
