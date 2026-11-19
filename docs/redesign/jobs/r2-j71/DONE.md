STATUS: GREEN
JOB: r2-j71 Photo button
DONE MEANS: "Photo saves a 1,920 by 1,080 PNG with no UI and the floor name." Proved:
  - Browser (room-r2.mjs j71, desktop, ?q=mid): a click on the room's Photo button saves a PNG (image/png, header 1920x1080, 2.2 MB) with
    "Photo Floor" and "Floor 1 · 19 November 2026" stamped in the bottom-left corner; the picture is the 3D room only (the page's controls, panels
    and name labels are page elements and never in it); the room goes back to its own size; no page errors. On a phone at low there is no Photo
    button. Picture: r2-j71-photo.jpg (the saved PNG, kept here as a JPEG to save space).
  - test/r2-room.test.js "1,920 by 1,080; the floor name and the date in the corner; hidden on phone low only" (PHOTO, photoStamp with New
    York's date, photoFile "<floor>-YYYY-MM-DD.png", photoAllowed).
How it works: office-scene.js photo() sets the renderer to 1920x1080 at pixel ratio 1, draws the room once through the same picture pipeline,
  copies it to a canvas in the same task, puts the renderer and the camera back, and stamps the name and date over a soft dark band.
  floor-ui.js savePhoto() turns it into a PNG and downloads it as <floor>-<date>.png. No model, nothing sent anywhere.
TESTS: node --test test/r2-room.test.js 42/42. Full npm test: see LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j71 all passed.
DEPLOY NOTES: No migration. New env ROOM_PHOTO (default on; 0 = no button).
RISKS: The photo keeps the camera's current angle and distance, so a phone held upright gives a wider, landscape crop of the same view. A large
  PNG (around 2 MB) on a detailed floor.
