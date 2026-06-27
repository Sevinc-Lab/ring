"""YOLOv8n (COCO) person detection on CPU via onnxruntime — lean, no torch."""
from __future__ import annotations

import numpy as np
import onnxruntime as ort
from PIL import Image

# COCO class names (YOLOv8 default order). Index 0 = person.
COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator",
    "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]
NAME_TO_ID = {n: i for i, n in enumerate(COCO_NAMES)}


def resolve_class_ids(names: list[str]) -> set[int]:
    """Map class names to COCO ids, ignoring unknown names (e.g. 'parcel' — M4d)."""
    return {NAME_TO_ID[n] for n in names if n in NAME_TO_ID}


class Detector:
    def __init__(self, model_path: str, class_ids: set[int], conf: float = 0.40, iou: float = 0.5):
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.imgsz = 640
        self.class_ids = set(class_ids)
        self.conf = conf
        self.iou = iou

    def _preprocess(self, img: Image.Image):
        w0, h0 = img.size
        r = min(self.imgsz / w0, self.imgsz / h0)
        nw, nh = round(w0 * r), round(h0 * r)
        resized = img.resize((nw, nh), Image.BILINEAR)
        canvas = Image.new("RGB", (self.imgsz, self.imgsz), (114, 114, 114))
        px, py = (self.imgsz - nw) // 2, (self.imgsz - nh) // 2
        canvas.paste(resized, (px, py))
        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        arr = arr.transpose(2, 0, 1)[None, ...]  # 1,3,640,640
        return np.ascontiguousarray(arr), r, px, py

    def detect(self, img: Image.Image) -> list[dict]:
        x, r, px, py = self._preprocess(img)
        out = self.session.run(None, {self.input_name: x})[0]  # 1,84,8400
        preds = out[0].T  # 8400,84
        boxes = preds[:, :4]
        cls_scores = preds[:, 4:]
        class_ids = cls_scores.argmax(1)
        confs = cls_scores.max(1)

        keep = confs >= self.conf
        boxes, class_ids, confs = boxes[keep], class_ids[keep], confs[keep]
        if self.class_ids and len(class_ids):
            m = np.isin(class_ids, list(self.class_ids))
            boxes, class_ids, confs = boxes[m], class_ids[m], confs[m]
        if len(boxes) == 0:
            return []

        # cxcywh (letterbox space) -> xyxy
        xy = np.empty_like(boxes)
        xy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
        xy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
        xy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
        xy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2

        results = []
        for i in self._nms(xy, confs, self.iou):
            x1 = (xy[i, 0] - px) / r
            y1 = (xy[i, 1] - py) / r
            x2 = (xy[i, 2] - px) / r
            y2 = (xy[i, 3] - py) / r
            cid = int(class_ids[i])
            results.append(
                {
                    "class_id": cid,
                    "name": COCO_NAMES[cid] if cid < len(COCO_NAMES) else str(cid),
                    "conf": round(float(confs[i]), 3),
                    "box": [round(float(v), 1) for v in (x1, y1, x2, y2)],
                }
            )
        return results

    @staticmethod
    def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]
        keep: list[int] = []
        while order.size > 0:
            i = int(order[0])
            keep.append(i)
            if order.size == 1:
                break
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])
            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, yy2 - yy1)
            inter = w * h
            ovr = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
            order = order[1:][ovr <= iou_thr]
        return keep
