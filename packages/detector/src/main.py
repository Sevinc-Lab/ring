"""Detector loop (M4a): poll recorded+unclassified clips, detect person, label.

Invariants: writes ONLY label/label_meta; never deletes; only touches rows that
are recording_status='recorded' AND label='unclassified'. Decoupled from the
worker — if this is down, the worker keeps recording normally.
"""
from __future__ import annotations

import logging
import os
import signal
import tempfile
import time

from PIL import Image

from config import Config
from db import connect, fetch_unclassified, update_label
from detect import Detector, resolve_class_ids
from frames import sample_frames
from notify import build_payload, maybe_notify

ENGINE = "yolov8-onnx"
log = logging.getLogger("detector")


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def classify(
    detector: Detector,
    frames: list[tuple[float, Image.Image]],
    min_conf: float,
    priority: list[str],
):
    """frames: [(timestamp, PIL.Image)] -> (label, max_conf, objects, names).

    The detector sees ALL COCO classes. `label` is the highest-priority class
    present (priority = DETECT_CLASSES order, e.g. person > dog > cat > car), so
    a person holding a laptop is labeled 'person'. `names` is every distinct
    class detected (sorted by confidence) — stored as filterable object tags.
    """
    objects: list[dict] = []
    by_class: dict[str, float] = {}
    for t, img in frames:
        for d in detector.detect(img):
            if d["conf"] >= min_conf:
                objects.append({"t": round(t, 2), **d})
                by_class[d["name"]] = max(by_class.get(d["name"], 0.0), d["conf"])
    objects.sort(key=lambda o: o["conf"], reverse=True)

    label = "none"
    for cls in priority:
        if cls in by_class:
            label = cls
            break
    max_conf = by_class.get(label, 0.0)
    names = [n for n, _ in sorted(by_class.items(), key=lambda kv: kv[1], reverse=True)]
    return label, max_conf, objects[:10], names


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
            label, max_conf, objects, names = classify(
                detector, frames, cfg.min_confidence, cfg.detect_classes
            )
        cpu_ms = round(1000 * (time.process_time() - t_cpu))
        wall_ms = round(1000 * (time.monotonic() - t_wall))
        meta = {
            "engine": ENGINE,
            "model": os.path.basename(cfg.model_path),
            "detected": label != "none",
            "label": label,
            "max_conf": round(max_conf, 3),
            "frames_sampled": len(frames),
            "clip_seconds": round(duration, 1),
            "objects": objects,
            "names": names,
            "cpu_ms": cpu_ms,
            "wall_ms": wall_ms,
        }
        # Filterable tags: ",person,laptop,cup," — leading/trailing commas let the
        # dashboard match a whole tag with a simple LIKE '%,laptop,%'.
        tags = "," + ",".join(names) + "," if names else None
        update_label(conn, event["id"], label, meta, tags)
        log.info(
            "event %s -> %s (max_conf=%.2f, frames=%d, cpu=%dms, wall=%dms)",
            event["id"], label, max_conf, len(frames), cpu_ms, wall_ms,
        )
        if label in cfg.notify_labels:
            maybe_notify(cfg, build_payload(cfg, event, label, max_conf, objects))
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
    # Detect ALL COCO classes (empty class_ids = no filter). The label priority
    # is applied afterwards; everything else becomes a filterable object tag.
    known = resolve_class_ids(cfg.detect_classes)
    if not known:
        log.warning(
            "DETECT_CLASSES=%s has no known COCO classes for the label priority — "
            "events will be labeled 'none' but objects are still tagged.",
            cfg.detect_classes,
        )
    detector = Detector(cfg.model_path, set(), conf=cfg.min_confidence)
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
