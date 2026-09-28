# VEIL

A privacy-preserving vision agent for Chrome and Firefox. The browser reads and redacts the screen locally; the server plans actions over typed placeholders like `⟦AADHAAR_1⟧` and never sees the real values.

See `PHASES.md` for the roadmap and current status.

## Layout

```
extension/     WXT project (Chrome and Firefox, Manifest V3)
  entrypoints/ background agent loop, content script, side panel, offscreen host
  lib/         vrs schema, pii rules and validators, vault, sanitizer, redaction, egress firewall, policy
  lib/vision/  on-device models: YuNet faces, PP-OCRv4 text, QR finder (ONNX Runtime Web)
  tests/       vitest unit and contract tests
server/        FastAPI: VRS schema, leak guard, planner, API
demo-sites/    ID card, bank form, plans page (synthetic data)
bench/         synthetic page generator with exact ground truth; browser smoke test in runner/
contracts/     payload fixture shared by both test suites
```

## Run it

Three terminals.

```bash
# 1. Server
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# 2. Demo sites
cd demo-sites
python -m http.server 5500

# 3. Extension
cd extension
npm install
npm run models           # once: downloads the vision models (about 16 MB) into public/models
npm run dev              # launches Chrome with VEIL loaded
npm run dev:firefox      # or Firefox
```

To load a production build by hand, run `npm run build`, then in Chrome open `chrome://extensions`, enable Developer mode and use Load unpacked on `extension/.output/chrome-mv3`. For Firefox, run `npm run build:firefox`, open `about:debugging`, choose Load Temporary Add-on and select `extension/.output/firefox-mv3/manifest.json`. Firefox treats host permissions as opt-in, so allow "Access your data for all websites" for VEIL in `about:addons`.

## Try the Phase 1 demo

1. Open `http://localhost:5500/id-card.html` and click the VEIL toolbar button to open the side panel.
2. Press **Scan page**. The privacy lens shows the raw card and the redacted version side by side, and the vault now holds placeholders for the name, date of birth, Aadhaar, PAN, mobile, email and address. Click any placeholder to reveal its value locally for three seconds.
3. Open `http://localhost:5500/bank-form.html` in the same window, type a goal such as “Open a savings account using my ID card details”, and press **Start**.
4. Approve each send. The server fills every field with placeholders, VEIL types the real values locally, asks you to set the password yourself, and asks you to confirm before Submit application.
5. On the final page, the thank-you message contains the name and mobile number. Both are masked in the lens because the vault learned them.

`Alt+Shift+.` stops the agent and wipes the vault.

## Try the Phase 2 demo (ID card as an image)

Same flow, but open `http://localhost:5500/id-card-scan.html` in step 1. The card is a single PNG, so there is no DOM to read: VEIL runs OCR, face detection and a QR finder on the image locally, masks only the face, the QR code and the sensitive values, and learns the same placeholders. Then fill the bank form as before.

Without the models, or if a model fails or runs out of time, every image is masked whole (fail closed) and the log says why.

## Tests

```bash
cd extension && npm test && npm run typecheck
cd server && pytest -q
```

Run the extension tests first; they write `contracts/step_request.json`, which the server contract test replays. The vision tests run the real models on `demo-sites/id-card-scan.png` and are skipped until `npm run models` has run.

With the server and demo sites running and the extension built (`npm run build`), a headless Chromium smoke test runs the whole Phase 2 demo:

```bash
cd bench/runner
npm install && npx playwright install chromium
node demo.mjs
```

Branded Google Chrome ignores `--load-extension`; use Playwright's Chromium or point `CHROMIUM` at another Chromium build.

## Generate benchmark pages

```bash
cd bench/generator
pip install -r requirements.txt
python generate.py --count 150
```

Pages and their ground truth land in `bench/pages/`. Serve that folder and scan pages with VEIL to inspect detection. `python id_card_image.py` redraws `demo-sites/id-card-scan.png` (needs `pillow` and `qrcode`).
