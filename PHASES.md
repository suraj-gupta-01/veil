# VEIL build phases

Each phase ends in something that runs and a measurable exit check. Phases map to the five evaluation metrics.

| Phase | Scope | Exit check |
|---|---|---|
| **1. Foundation and round trip** | WXT extension for Chrome and Firefox; DOM snapshot with span-precise rects; rule-based detection (DOM semantics, patterns with checksums, label context, vault dictionary); pixel redaction from DOM rects; token vault; egress firewall; policy engine; action executor; side panel privacy lens; FastAPI server with VRS schema, leak guard and a rule planner; contract test; demo sites; synthetic page generator | Demo bank form filled end to end from the ID card page with the rule planner, zero leaks at the firewall and the server guard |
| **2. Local vision** | ONNX Runtime Web on WebGPU with WASM fallback in the perception worker; DeiT-Tiny screen classifier; YOLO11n UI detector; YuNet faces; PP-OCRv4 on raster regions; DOM and vision fusion; targeted masks replace whole-image masking | ID card as an image works end to end; detection F1 ≥ 0.90 on VEIL-Bench |
| **3. Privacy engine hardening** | Transformers.js NER for names in free text; QR and signature detection; span-precise OCR masks; per-class width buckets; paranoid OCR audit; iframes; user-defined terms | PII recall ≥ 0.97, pixel precision ≥ 0.85, zero leaks on VEIL-Bench |
| **4. Server intelligence** | vLLM serving Qwen2.5-VL-7B; JSON-schema guided output; VRS system prompt; set-of-mark grounding; text-only fast path; Presidio guard; streaming; Redis sessions | VLM planner beats the rule planner on 20 scripted tasks |
| **5. Agent execution and safety** | Full action set; post-action verification and re-planning; multi-tab entity capture; prompt-injection test pages | Demo task succeeds 8 times in 10 |
| **6. Benchmark, performance, demo** | Playwright runner and metrics dashboard; lazy loading, change gate, batching; Firefox parity; demo script | All five metric targets met |

## Phase 1 status

Done:
- Extension builds for Chrome MV3 and Firefox MV3 from one codebase; strict TypeScript passes.
- 28 extension unit tests, 10 server tests, and a cross-language contract test (TypeScript payload validated by the Python schema and planned by the server).
- Rule layers measured on 150 synthetic pages: 962 of 962 labelled identifiers found, 99.4% precision. These pages label every value, so real sites will score lower until Phases 2 and 3.

Known limits, by design for this phase:
- Every image, canvas, video and iframe is masked whole (fail closed) until the Phase 2 detectors can mask precisely. Phase 2 replaced this with targeted masks.
- Names in unlabelled free text are redacted only once the vault has learned them from a field or label. NER arrives in Phase 3.
- Top frame only. Iframes are treated as images.

Still open:
- [ ] Firefox has not been run by hand. Only the build is checked. Run `npm run dev:firefox` and do both demos.
- [ ] The browser smoke test (`bench/runner/demo.mjs`) is not in CI. It passes in headless Chromium when run by hand.

## Phase 2 status

Done:
- Perception page runs ONNX Runtime Web: a Chrome offscreen document, or a hidden iframe in Firefox's background page. It tries WebGPU and falls back to WASM. Sessions load lazily, are released after 60 s idle, and each scan has a 5 s budget and a 6-image cap.
- YuNet faces, PP-OCRv4 mobile text detection and recognition, and a QR finder-pattern detector run on raster regions only.
- OCR text goes through the same L1 patterns and vault dictionary as DOM text, plus a same-row label rule ("Aadhaar" left of a number). Masks cover only the matched characters, located from CTC timesteps.
- Images whose alt or aria-label says QR code or portrait are masked whole as that class.
- Targeted masks replace whole-image masking. Any model failure, timeout or missing model still masks the whole image (fail closed).
- Exit check, first half: the ID card as an image works end to end in headless Chromium (`bench/runner/demo.mjs`). The scan tokenizes name, DOB, Aadhaar, PAN, mobile, email, address, face and QR. The bank form is then filled with zero firewall or guard blocks.
- The first real-browser runs found and fixed these Phase 1 issues:
  - Form labels were read as values of the previous field, which made the firewall block the bank form.
  - JPEG capture made OCR merge words, so capture is now PNG.
  - aria-label was ignored on images.
  - The contract test broke on Windows because of the file encoding.

Still open (steps in "Finishing Phase 2" below):
- [ ] DeiT-Tiny screen-state classifier. Screen state is still guessed by `guessState` in `lib/sanitize.ts`.
- [ ] YOLO11n UI element detector. Without it there are no vision-only elements for canvas UIs.
- [ ] DOM and vision fusion by IoU. This is blocked on the UI detector.
- [ ] Detection F1 ≥ 0.90 and screen-state accuracy ≥ 0.93 on VEIL-Bench, not measured.
- [ ] WebGPU in a real browser, untested because headless runs have no GPU. On WASM a scan takes 1.2 to 2.2 s against a 350 ms budget.

Known limits:
- OCR can drop spaces on small text. Labels are matched with optional spaces, but a value can be typed without its spaces (the mobile number came out as "+9198450 12345").
- Free text inside images with no label and no pattern is not caught until NER arrives in Phase 3. Barcodes and signatures are not detected. The QR finder uses a fixed brightness threshold.

## Finishing Phase 2

The first two steps need a GPU and a labelled screenshot set. Steps 3 and 4 do not. Phase 3 does not depend on any of them, except that its exit check uses the same VEIL-Bench scoring as step 3.

### 1. Training data (no GPU)

- Extend `bench/generator/generate.py` with the missing templates: login, checkout, banking dashboard, email inbox and document viewer. Tag each page with one of the seven screen classes: login, form, payment, document, messaging, dashboard, generic.
- Add `bench/training/render.mjs`, a Playwright script that opens every page at 2 or 3 viewport sizes and saves:
  - a PNG screenshot;
  - one YOLO label line per visible element, from `getBoundingClientRect`. Classes: button, text input, password input, checkbox or radio, dropdown, link, icon, image, text block, QR or barcode.
  - the page's screen class for the classifier.
- Mix in a public web UI screenshot set, such as WebUI, for real-site variety. Hold out 10% of pages, and keep all of a page's viewports in the same split.

### 2. Train and export (GPU: one 16 to 24 GB card, a few hours; Colab or Kaggle is enough)

- **Screen classifier.** Fine-tune `facebook/deit-tiny-patch16-224` (timm or Hugging Face) at 224 px on the seven classes. Export ONNX (opset 17) and quantize to int8 with `onnxruntime.quantization.quantize_dynamic`. Target: accuracy ≥ 0.93 on the held-out split, about 6 MB.
- **UI detector.** `yolo train model=yolo11n.pt imgsz=640` on the element labels, then `yolo export format=onnx half=True`. Target: about 5.5 MB. Ultralytics is AGPL-3.0; RT-DETR or PicoDet are Apache-licensed swaps for production.
- Put both scripts and their exact commands in `bench/training/`. Host the `.onnx` files next to the others and add their URLs to `extension/scripts/models.mjs` as `screen.onnx` and `ui.onnx`.

### 3. Wire into the extension

- `lib/vision/screen.ts`: resize the full frame to 224 px, normalize with ImageNet mean and std, run softmax, and return `{ class, confidence, src: 'vit' }`. In `sanitize`, use it instead of `guessState` when its confidence is ≥ 0.6.
- `lib/vision/ui.ts`: letterbox the frame to 640, decode the `[1, 4 + classes, 8400]` output, and run NMS. Follow the pattern of `face.ts`.
- **Fusion (FR-4).**
  - A detection that overlaps a DOM element at IoU > 0.5 keeps the DOM id.
  - A detection inside a raster region, or one with no DOM match, becomes a `src: 'vision'` element with a new id.
  - The content script executor clicks vision elements by coordinate, using `document.elementFromPoint` plus the same pointer and mouse sequence.
- Screen class sets the sensitivity profile. On ID and payment screens, mask all raster text, not just matched values.

### 4. Measure (no GPU)

- Have the generator write element ground truth, not just PII.
- Add `bench/runner/score.mjs`. It loads each bench page with the extension, triggers a scan, reads the lens payload, and computes:
  - element detection F1 at IoU 0.5;
  - screen-state accuracy.
- The same runner produces the Phase 3 metrics (entity recall and precision, pixel precision and recall, leak count).
- WebGPU: with a GPU, run `npm run dev` in Chrome, scan `id-card-scan.html`, and check that the log says "Vision on webgpu". Record the stage timings in this file. If WebGPU fails, the WASM fallback already works.

Phase 2 is done when steps 1 to 4 are in and the benchmark shows F1 ≥ 0.90 and state accuracy ≥ 0.93.
