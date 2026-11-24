# Scale Model Garage

A personal, mobile-first app for cataloguing a scale model collection. First app in the Collection Vault family.

- Installable web app (PWA) hosted on GitHub Pages: https://abhilashsudhindran-collab.github.io/scale-model-garage/
- **This repository contains code only.** No collection data, photos, credentials, tokens or personal information are ever stored here. All data lives in the owner's own Google Drive (`SCALE GARAGE/`) and Google Sheet (`SCALE_GARAGE_MASTER`), reached with the `drive.file` scope only.

## Status: Stage 1 (quick-capture slice), version s1-0.2.0

**s1-0.2.0 (24 Nov 2026): experience-audit P0 fixes.** Possible matches can be opened or added as another copy (never merged automatically); the header counts boxes and says "Sign in to sync" when needed; warnings and errors no longer look like success; typed edits on the item page are saved before leaving; the capture timer counts only time spent on each box; a box in progress survives a tab reload; a hidden box-art photo is no longer saved.

| Works in this version | Not yet (later stages) |
|---|---|
| Quick capture: box front + rear photos (phone camera), box art for sealed boxes, brand, scale, barcode scan/typing, name, optional product code | Shop-check screen (Stage 2) |
| Exact duplicate check on the phone (brand + exact code), possible matches (barcode, similar code, similar name) | Cropping/straightening, OCR (Stage 3) |
| Offline capture; batched, idempotent sync to Drive + Sheet; clash handling | Full identification, AI copy-paste helper (Stage 4) |
| Garage list with search and filters; item page to add details later; copy details (price/date "unknown" allowed) | Orders, transactions, analytics, backups, valuation (Stages 5–9) |

## Developer tests (not acceptance tests)
- `node tests/rules.test.mjs` — identity rules, barcode standardisation, check digits, IDs.
- `node tests/md5.test.mjs` — md5 against node:crypto.
- `node tests/timing.test.mjs` — capture timer.
- `python3 tests/e2e_p0.py` — headless checks for the s1-0.2.0 fixes (fake Google).
- `python3 tests/e2e_mock.py` — headless Chrome against a **fake** in-memory Google Drive/Sheets.

**A feature counts as passed only after testing on the owner's phone with the real Google account.**

Licences of bundled libraries: `vendor/barcode/` (MIT).
