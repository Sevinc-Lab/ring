/**
 * In-browser YOLOv8n inference via onnxruntime-web (WASM). Runs on the viewer's
 * device — the ZimaBlade is never involved. Model + WASM are served locally from
 * /models and /ort (no CDN). Single-threaded WASM+SIMD: a few FPS, plenty for a
 * "where is the person right now" overlay.
 */

// COCO class names (YOLOv8 default order). Index 0 = person.
export const COCO_NAMES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
  'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
]

// Classes you care about most — drawn in the accent colour.
export const PRIMARY = new Set(['person', 'dog', 'cat', 'car'])

export interface Box {
  name: string
  conf: number
  x1: number
  y1: number
  x2: number
  y2: number
  primary: boolean
}

const IMGSZ = 640

// onnxruntime-web is heavy and browser-only; loaded lazily and cached.
let _ort: typeof import('onnxruntime-web') | null = null
let _session: import('onnxruntime-web').InferenceSession | null = null
let _loading: Promise<void> | null = null
let _pre: HTMLCanvasElement | null = null

export function loadModel(): Promise<void> {
  if (_session) return Promise.resolve()
  if (_loading) return _loading
  _loading = (async () => {
    // Load onnxruntime-web at RUNTIME from the locally-served ESM build (no CDN).
    // webpackIgnore keeps webpack from bundling it — ORT's bundle uses
    // `import.meta`, which Terser refuses to minify inside a webpack chunk.
    const ortUrl = '/ort/ort.wasm.min.mjs'
    const ort = (await import(/* webpackIgnore: true */ ortUrl)) as typeof import('onnxruntime-web')
    ort.env.wasm.wasmPaths = '/ort/'
    ort.env.wasm.numThreads = 1 // no cross-origin isolation needed
    _session = await ort.InferenceSession.create('/models/yolov8n.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    _ort = ort
  })()
  return _loading
}

/** Detect objects in the current video frame. Coords are in the video's own
 *  pixel space (so a canvas sized to videoWidth/Height maps 1:1). */
export async function detect(video: HTMLVideoElement, minConf = 0.4, iou = 0.45): Promise<Box[]> {
  if (!_session || !_ort) return []
  const w0 = video.videoWidth
  const h0 = video.videoHeight
  if (!w0 || !h0) return []

  const r = Math.min(IMGSZ / w0, IMGSZ / h0)
  const nw = Math.round(w0 * r)
  const nh = Math.round(h0 * r)
  const px = Math.floor((IMGSZ - nw) / 2)
  const py = Math.floor((IMGSZ - nh) / 2)

  if (!_pre) {
    _pre = document.createElement('canvas')
    _pre.width = IMGSZ
    _pre.height = IMGSZ
  }
  const ctx = _pre.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, IMGSZ, IMGSZ)
  ctx.drawImage(video, 0, 0, w0, h0, px, py, nw, nh)
  const { data } = ctx.getImageData(0, 0, IMGSZ, IMGSZ) // RGBA

  const area = IMGSZ * IMGSZ
  const chw = new Float32Array(3 * area)
  for (let i = 0; i < area; i++) {
    chw[i] = data[i * 4] / 255
    chw[i + area] = data[i * 4 + 1] / 255
    chw[i + 2 * area] = data[i * 4 + 2] / 255
  }

  const tensor = new _ort.Tensor('float32', chw, [1, 3, IMGSZ, IMGSZ])
  const feeds: Record<string, import('onnxruntime-web').Tensor> = {}
  feeds[_session.inputNames[0]] = tensor
  const out = await _session.run(feeds)
  const o = out[_session.outputNames[0]]
  const d = o.data as Float32Array
  const n = o.dims[2] // 8400
  const nc = o.dims[1] - 4 // 80 classes

  const boxes: Box[] = []
  for (let i = 0; i < n; i++) {
    let best = 0
    let bestC = 0
    for (let c = 0; c < nc; c++) {
      const s = d[(4 + c) * n + i]
      if (s > best) {
        best = s
        bestC = c
      }
    }
    if (best < minConf) continue
    const cx = d[i]
    const cy = d[n + i]
    const bw = d[2 * n + i]
    const bh = d[3 * n + i]
    const name = COCO_NAMES[bestC] ?? String(bestC)
    boxes.push({
      name,
      conf: best,
      x1: (cx - bw / 2 - px) / r,
      y1: (cy - bh / 2 - py) / r,
      x2: (cx + bw / 2 - px) / r,
      y2: (cy + bh / 2 - py) / r,
      primary: PRIMARY.has(name),
    })
  }
  return nms(boxes, iou)
}

/** Class-agnostic greedy non-max suppression. */
function nms(boxes: Box[], iouThr: number): Box[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].conf - boxes[a].conf)
  const keep: Box[] = []
  const removed = new Set<number>()
  for (let k = 0; k < order.length; k++) {
    const i = order[k]
    if (removed.has(i)) continue
    keep.push(boxes[i])
    for (let m = k + 1; m < order.length; m++) {
      const j = order[m]
      if (removed.has(j)) continue
      if (iou(boxes[i], boxes[j]) > iouThr) removed.add(j)
    }
  }
  return keep
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter + 1e-6)
}
