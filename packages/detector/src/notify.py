"""Channel-agnostic notification webhook.

M4a: the payload builder is implemented and the send path exists, but firing is
GATED OFF by default (NOTIFY_ENABLED=false). Real notifications are wired in M4c
(n8n flow). In M4a this only logs a stub line.
"""
from __future__ import annotations

import json
import logging
import urllib.request

log = logging.getLogger("detector.notify")


def build_payload(event: dict, label: str, max_conf: float, objects: list[dict]) -> dict:
    return {
        "label": label,
        "device_id": event.get("device_id"),
        "device_name": event.get("device_name"),
        "started_at": event.get("started_at"),
        "clip_path": event.get("clip_path"),
        "thumb_path": event.get("thumb_path"),
        "max_conf": round(max_conf, 3),
        "objects": objects,
    }


def maybe_notify(cfg, payload: dict) -> None:
    # Only fire for relevant labels (never on 'none'/'error').
    if payload.get("label") in (None, "none", "error", "unclassified"):
        return
    if not cfg.notify_enabled or not cfg.n8n_webhook_url:
        log.debug("notify stub (disabled) for label=%s", payload.get("label"))
        return
    # M4c: real send (guarded so a webhook failure never affects labeling).
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            cfg.n8n_webhook_url, data=data, headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10).close()
        log.info("notified n8n for label=%s", payload.get("label"))
    except Exception as e:  # noqa: BLE001
        log.warning("notify failed (ignored): %s", e)
