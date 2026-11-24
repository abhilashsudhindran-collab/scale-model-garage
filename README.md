# Scale Model Garage

A personal, mobile-first app for cataloguing a scale model collection. First app in the Collection Vault family.

- Installable web app (PWA) hosted on GitHub Pages: https://abhilashsudhindran-collab.github.io/scale-model-garage/
- **This repository contains code only.** No collection data, photos, credentials, tokens or personal information are ever stored here. All data lives in the owner's own Google Drive (`SCALE GARAGE/`) and Google Sheet (`SCALE_GARAGE_MASTER`), reached with the `drive.file` scope only.

## Status: Stage 1 (quick-capture slice), version s1-0.6.0

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
- `node tests/ai.test.mjs` — AI answer parser (copy-paste names).
- `python3 tests/e2e_p4.py` — headless checks for s1-0.6.0 (share sheet and clipboard simulated).
- `python3 tests/e2e_mock.py` — headless Chrome against a **fake** in-memory Google Drive/Sheets.

**A feature counts as passed only after testing on the owner's phone with the real Google account.**

Licences of bundled libraries: `vendor/barcode/` (MIT).
