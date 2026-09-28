// Downloads the Phase 2 vision models into public/models (served with the extension, never committed).
// Run once after npm install: npm run models
import { mkdir, stat, writeFile } from 'node:fs/promises';

const MODELS = {
  'yunet.onnx': 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
  'ocr-det.onnx': 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx',
  'ocr-rec.onnx': 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx',
  // DistilBERT fine-tuned on CoNLL-2003 (dslim/distilbert-NER, Apache-2.0), int8. Loaded lazily for free text.
  'ner.onnx': 'https://huggingface.co/onnx-community/distilbert-NER-ONNX/resolve/main/onnx/model_int8.onnx',
  'ner-vocab.txt': 'https://huggingface.co/onnx-community/distilbert-NER-ONNX/resolve/main/vocab.txt',
};

const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const file = new URL(name, dir);
  if (await stat(file).then((s) => s.size > 0, () => false)) {
    console.log(`${name}: present`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  console.log(`${name}: ${(buf.length / 1e6).toFixed(1)} MB`);
}
