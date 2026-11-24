# Scale Model Garage

A personal, mobile-first app for cataloguing a scale model collection. First app in the Collection Vault family.

- Installable web app (PWA) hosted on GitHub Pages: https://abhilashsudhindran-collab.github.io/scale-model-garage/
- **This repository contains code only.** No collection data, photos, credentials, tokens or personal information are ever stored here. All data lives in the owner's own Google Drive (`SCALE GARAGE/`) and Google Sheet (`SCALE_GARAGE_MASTER`), reached with the `drive.file` scope only.

## Status: Stage 1 (quick-capture slice), version s1-0.15.0

**s1-0.15.0 (24 Nov 2026): crop / straighten (D14).** On a car's page, tap a photo → Crop / straighten: drag four corners onto the box (magnifier while dragging; crossed corners shown in red and refused). The app makes a straight copy with a perspective transform written in plain JavaScript (₹0, no OpenCV): `cropped` (≤1600 px, uploaded to Drive as its own file) and a small copy for tiles. The original is never changed; corners are saved (crop_corners) so it can be adjusted or undone. If the full photo was freed from the phone after sync, it is fetched from Drive. Other devices download the straightened copy.

**s1-0.14.1 (24 Nov 2026): app icon.** New icon redrawn as vector art from B's reference (green garage with a car on warm paper): home-screen icons 192/512 (plain and maskable, design inside the safe zone), Apple touch icon 180, favicon 32 and SVG; also shown beside the name in the header. Manifest colours now warm paper.

**s1-0.14.0 (24 Nov 2026): restore from a backup (D25).** Settings → Backups → Restore from a backup… lists the copies (Back up now, daily, monthly), newest first. Restoring refuses while anything on the phone is unsynced; otherwise it makes a fresh backup, copies the chosen backup into 00_DATABASE as the main sheet, keeps the old sheet renamed "(replaced <date time>)" (nothing deleted), rebuilds the phone's data from the restored sheet and records the restore in CHANGE_LOG. Photos are not touched. A second device opens the restored sheet.

**s1-0.13.0 (24 Nov 2026): car page as a product page; line icons.** The car page opens with brand · scale, the name and product code, one large photo and thumbnails (tap for photo options), then facts (copies, sealed/opened, storage box as a link, barcode, quick/complete). Details show name, brand, scale and code; variant, series, notes and barcode fold under "More details" while empty. Each copy and the record info fold into a summary line. Camera and box emoji replaced by line icons. Photo run: "Saving…" while a car is being saved, so it can't be saved twice.

**s1-0.12.0 (24 Nov 2026): Showroom look (DV-0.1).** Following B's design direction (IKEA-like cleanliness, MUJI restraint, Apple-style product photos, Discogs collection logic; not their branding): warm neutral foundation, white cards without borders, pill controls, line icons, photo-first tiles with text underneath, sentence-case headings, soft message tints. Accent colour switchable in Settings → Look: forest green (default), cobalt blue, burnt orange; every text pair checked at 4.5:1 or better. Home order: search first, compact shelf, then photos. Box settings fold into one line once a box is set up (stay open while editing). Desktop: 4–5 photos across, floating menu bar. No features or flows removed. `tests/shots_design.py` makes the review screenshots.

**s1-0.11.0 (24 Nov 2026): box scale; remove and restore boxes.** A box can be "Only 1:43" (the run presets the scale) or "Mixed scales" (after a car's photos, the app asks the scale, together with the brand if that's mixed too), e.g. mixed brands but only 1:43. Remove a box from its card: an empty box goes straight away; a box with cars asks first, and its cars stay in the collection under "No box yet". Dashboard → Removed boxes lists the history with Restore, which puts the box and its cars back. Every step is in CHANGE_LOG.

**s1-0.10.0 (24 Nov 2026): box-first flow.** The home screen shows the shelf of storage boxes with a "＋ New box" tile (next number, created empty). Tap a box to see what's inside, set its size and name, and "📷 Fill Box N" to start a photo run straight into it. The run shows "Filling Box N" with Switch box and Done (Done waits for a car still saving, and warns about a half-done car). Chips jump to any box in use; "Box full" is now "Next box". Each storage box says what's in it: "Only <brand>" (the run presets that brand) or "Mixed brands" (take the photos, then tap the brand for each car). Runs count cars ("Car 3 of this run") so "box" always means a storage box. Boxes may hold anything in any order; the number is what matters.

**s1-0.9.1 (24 Nov 2026): offline fix.** s1-0.9.0 shipped an empty `sw.js` (a build-script mistake), so the app could not open without a network. Restored. New guards: `node tests/release_check.mjs` and `python3 tests/e2e_offline.py` (both fail on the broken file).

**s1-0.9.0 (24 Nov 2026): storage boxes as a shelf.** Following B's sketch, the Dashboard draws each storage box as a SAMLA-style side view with the number of cars big inside, and the size (S, M, L, XL), number and name underneath. Box size is set on the box card (new `box_size` column in STORAGE_BOXES; sync adds the column to an existing sheet). Every box keeps its number; the name is optional. Safety fix: backup copies are tagged as backups in the copy request and lose the main-sheet tag, and a new device never accepts a backup as the main sheet.

**s1-0.8.0 (24 Nov 2026): storage boxes you can name and open.** Tap a storage box (Dashboard, or a "By box" header in the Garage) to see only the cars inside it, with a card to name the box (e.g. "Le Mans racers"). Box names are kept in a new STORAGE_BOXES tab; an existing sheet gets the tab added on the next sync (nothing deleted). Garage can also be grouped By brand and By scale. The "last 7 days" chart is removed (B: not useful).

**s1-0.7.0 (24 Nov 2026): Dashboard.** New Dashboard tab: boxes catalogued with a rough progress bar (the collection-size guess is never shown as a target), status tiles (named, need a name, need review, waiting to sync), boxes added in the last 7 days with a rough sessions-to-go estimate, boxes by brand and by scale, numbered storage boxes with their counts, and sealed/opened/loose when recorded. Every tile and bar opens the matching list. New Name tab with a badge counting boxes that need a name. Searching "box 3" (or tapping Box 3) now shows exactly storage Box 3, not Box 30 or scale 1:43.

**s1-0.6.1 (24 Nov 2026): Gemini's own answer style accepted.** First real test on B's phone: sharing worked and Gemini read the box correctly, but replied as a labelled list ("Car Name: …", "Product / Item Code: …"), which the app rejected. The app now also reads labelled lists (grouped by "Box N" headings or the photo names Gemini cites; importer, price and dates ignored), and the instructions ask for the format first and last (prompt `names-v2`).

**s1-0.6.0 (24 Nov 2026): names from Gemini or Claude (copy-paste, ₹0).** On "Name them", the app prepares up to 10 nameless boxes (front + rear display copies, no location data) with instructions, and shares them to the Gemini or Claude app on the phone. Paste the reply back; each box's name and code are shown as a suggestion to check, never saved until you tap Save. Codes with odd characters are ignored; a different brand reading is shown as a note only. Every batch is logged in AI_LOG (prompt version, raw answer, what you confirmed or edited). Backups: two syncs finishing together no longer make two copies.


**s1-0.5.0 (24 Nov 2026): Photo run + Name them.** Photo run: set brand, scale, storage box and sealed once; each box needs only its photos and saves itself (barcode read from the rear photo; a barcode match pauses the run to ask "same model or different"; "Undo last box" archives). Name them: nameless boxes one at a time, big photo first, name + optional code, Save & next. Garage shows "Needs a name (N)".


**s1-0.4.0 (24 Nov 2026): storage boxes, overview, backups, photos on other devices.** Each capture can record a numbered storage box (remembered; "Box full → next"); tiles show the box; Garage can group "By box"; search finds "box 12". Garage overview shows how much of the collection is catalogued (collection size set in Settings). The sheet is backed up to `06_BACKUPS` after a sync: daily (7 kept), monthly (12 kept), plus "Back up now" (decision D25; photos not copied; restore is manual for now). Thumbnails are downloaded on sync, so the laptop shows real photos.


**s1-0.3.0 (24 Nov 2026): experience-audit P1 fixes.** "Sealed box / Car visible" toggle is remembered; Save is always visible above the bottom menu; the barcode is read from the box-rear photo when possible; search matches words in any order and ignores punctuation (also searches scale, variant, series, notes, storage); pages open at the top and Back returns to the same place in the Garage; barcodes can be corrected, photos relabelled, made main or removed, and archived models restored; portrait 3:4 Garage tiles; one row of filters showing only those with items; header and bottom menu fully opaque.


**s1-0.2.0 (24 Nov 2026): experience-audit P0 fixes.** Possible matches can be opened or added as another copy (never merged automatically); the header counts boxes and says "Sign in to sync" when needed; warnings and errors no longer look like success; typed edits on the item page are saved before leaving; the capture timer counts only time spent on each box; a box in progress survives a tab reload; a hidden box-art photo is no longer saved.

| Works in this version | Not yet (later stages) |
|---|---|
| Quick capture: box front + rear photos (phone camera), box art for sealed boxes, brand, scale, barcode scan/typing, name, optional product code | Shop-check screen (Stage 2) |
| Exact duplicate check on the phone (brand + exact code), possible matches (barcode, similar code, similar name) | Cropping/straightening, OCR (Stage 3) |
| Offline capture; batched, idempotent sync to Drive + Sheet; clash handling | Full identification (Stage 4); AI helper covers names only so far |
| Garage list with search and filters; item page to add details later; copy details (price/date "unknown" allowed) | Orders, transactions, analytics, backups, valuation (Stages 5–9) |

## Developer tests (not acceptance tests)
- `node tests/rules.test.mjs` — identity rules, barcode standardisation, check digits, IDs.
- `node tests/md5.test.mjs` — md5 against node:crypto.
- `node tests/timing.test.mjs` — capture timer.
- `python3 tests/e2e_p0.py` — headless checks for the s1-0.2.0 fixes (fake Google).
- `python3 tests/e2e_p1.py` — headless checks for the s1-0.3.0 fixes (fake Google; needs `pip install python-barcode`).
- `python3 tests/e2e_p2.py` — headless checks for s1-0.4.0 (storage boxes, backups, second device).
- `python3 tests/e2e_p3.py` — headless checks for s1-0.5.0 (Photo run, Name them).
- `node tests/release_check.mjs` — offline file complete and in step with the app version (run before every release).
- `python3 tests/e2e_restore.py` — restore from a backup, end to end (refusal, safety backup, old sheet kept, second device).
- `python3 tests/e2e_offline.py` — the app opens with the network cut.
- `node tests/crop.test.mjs` — straightening maths (homography, corner order, warp).
- `python3 tests/e2e_crop.py` — crop / straighten end to end.
- `node tests/ai.test.mjs` — AI answer parser (copy-paste names).
- `python3 tests/e2e_p5.py` — headless checks for s1-0.7.0 (Dashboard, Name tab).
- `python3 tests/e2e_p4.py` — headless checks for s1-0.6.0 (share sheet and clipboard simulated).
- `python3 tests/e2e_mock.py` — headless Chrome against a **fake** in-memory Google Drive/Sheets.

**A feature counts as passed only after testing on the owner's phone with the real Google account.**

Licences of bundled libraries: `vendor/barcode/` (MIT).
