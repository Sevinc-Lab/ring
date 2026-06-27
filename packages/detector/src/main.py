"""Detector loop (M4a): poll recorded+unclassified clips, detect person, label.

Invariants: writes ONLY label/label_meta; never deletes; only touches rows that
are recording_status='recorded' AND label='unclassified'. Decoupled from the
worker — if this is down, the worker keeps recording normally.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import tempfile
import time

from PIL import Image

from config import Config
from db import connect, fetch_unclassified, update_label
from detect import Detector, resolve_class_ids
from frames import sample_frames
from notify import build_payload, maybe_notify

ENGINE = "yolov8n-onnx"
log = logging.getLogger("detector")


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def classify(detector: Detector, frames: list[tuple[float, Image.Image]], min_conf: float):
    """frames: [(timestamp, PIL.Image)] -> (label, max_conf, objects)."""
    objects: list[dict] = []
    max_conf = 0.0
    for t, img in frames:
        for d in detector.detect(img):
            if d["conf"] >= min_conf:
                objects.append({"t": round(t, 2), **d})
                max_conf = max(max_conf, d["conf"])
    objects.sort(key=lambda o: o["conf"], reverse=True)
    label = "person" if objects else "none"
    return label, max_conf, objects[:10]


def process_event(cfg: Config, conn, detector: Detector, event: dict) -> None:
    clip_abs = os.path.join(cfg.media_dir, event["clip_path"])
    t_wall, t_cpu = time.monotonic(), time.process_time()
    try:
        if not os.path.exists(clip_abs):
            raise FileNotFoundError(clip_abs)
        with tempfile.TemporaryDirectory() as tmp:
            duration, frame_files = sample_frames(clip_abs, cfg.frames_per_clip, tmp)
            frames: list[tuple[float, Image.Image]] = []
            for t, fp in frame_files:
                try:
                    frames.append((t, Image.open(fp).convert("RGB")))
                except Exception:  # noqa: BLE001
                    pass
            if not frames:
                raise RuntimeError("no frames extracted")
            label, max_conf, objects = classify(detector, frames, cfg.min_confidence)
        cpu_ms = round(1000 * (time.process_time() - t_cpu))
        wall_ms = round(1000 * (time.monotonic() - t_wall))
        meta = {
            "engine": ENGINE,
            "model": os.path.basename(cfg.model_path),
            "detected": label == "person",
            "label": label,
            "max_conf": round(max_conf, 3),
            "frames_sampled": len(frames),
            "clip_seconds": round(duration, 1),
            "objects": objects,
            "cpu_ms": cpu_ms,
            "wall_ms": wall_ms,
        }
        update_label(conn, event["id"], label, meta)
        log.info(
            "event %s -> %s (max_conf=%.2f, frames=%d, cpu=%dms, wall=%dms)",
            event["id"], label, max_conf, len(frames), cpu_ms, wall_ms,
        )
        if label == "person":
            maybe_notify(cfg, build_payload(event, label, max_conf, objects))
    except Exception as e:  # noqa: BLE001
        cpu_ms = round(1000 * (time.process_time() - t_cpu))
        meta = {"engine": ENGINE, "detected": False, "label": "error",
                "error": str(e)[:300], "cpu_ms": cpu_ms}
        try:
            update_label(conn, event["id"], "error", meta)
        except Exception as e2:  # noqa: BLE001
            log.error("failed to mark error on event %s: %s", event["id"], e2)
        log.error("event %s -> error: %s", event["id"], e)


_running = True


def _stop(*_):
    global _running
    _running = False


def main() -> None:
    cfg = Config()
    setup_logging(cfg.log_level)
    log.info(
        "Detector starting (engine=%s, frames=%d, min_conf=%.2f, poll=%ds, classes=%s)",
        ENGINE, cfg.frames_per_clip, cfg.min_confidence, cfg.poll_seconds, cfg.detect_classes,
    )
    class_ids = resolve_class_ids(cfg.detect_classes)
    if not class_ids:
        log.error(
            "No known COCO classes in DETECT_CLASSES=%s "
            "(note: 'parcel' needs a custom model — M4d). Exiting.",
            cfg.detect_classes,
        )
        sys.exit(1)
    detector = Detector(cfg.model_path, class_ids, conf=cfg.min_confidence)
    conn = connect(cfg.db_path)
    log.info("Ready. Watching for recorded+unclassified clips.")

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    while _running:
        try:
            rows = fetch_unclassified(conn, limit=10)
        except Exception as e:  # noqa: BLE001  (e.g. table not created by worker yet)
            log.warning("db poll failed (will retry): %s", e)
            time.sleep(cfg.poll_seconds)
            continue
        if not rows:
            time.sleep(cfg.poll_seconds)
            continue
        for event in rows:
            if not _running:
                break
            process_event(cfg, conn, detector, event)

    conn.close()
    log.info("Detector stopped.")


if __name__ == "__main__":
    main()
