"""Channel-agnostic notification webhook.

M4a: the payload builder is implemented and the send path exists, but firing is
GATED OFF by default (NOTIFY_ENABLED=false). Real notifications are wired in M4c
(n8n flow). In M4a this only logs a stub line.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request

log = logging.getLogger("detector.notify")

LABEL_TEXT = {
    "person": "Person",
    "dog": "Hund",
    "cat": "Katze",
    "car": "Auto",
}


def build_payload(cfg, event: dict, label: str, max_conf: float, objects: list[dict]) -> dict:
    base = getattr(cfg, "dashboard_base_url", "") or ""
    clip_path = event.get("clip_path")
    thumb_path = event.get("thumb_path")
    payload = {
        "label": label,
        "device_id": event.get("device_id"),
        "device_name": event.get("device_name"),
        "started_at": event.get("started_at"),
        "clip_path": clip_path,
        "thumb_path": thumb_path,
        "max_conf": round(max_conf, 3),
        "objects": objects,
        # Clickable links for the n8n/Telegram message (empty if base not set).
        "event_url": f"{base}/event/{event.get('id')}" if base else None,
        "clip_url": f"{base}/api/media/{clip_path}" if base and clip_path else None,
        "thumb_url": f"{base}/api/media/{thumb_path}" if base and thumb_path else None,
    }
    return payload


def _webhook_for(cfg, label: str) -> str:
    """Per-label webhook override (N8N_WEBHOOK_URL_<LABEL>) or the default."""
    specific = os.environ.get(f"N8N_WEBHOOK_URL_{label.upper()}", "").strip()
    return specific or cfg.n8n_webhook_url


def _ntfy_priority(label: str) -> str:
    """Per-label ntfy priority (NTFY_PRIORITY_<LABEL>) or the default 'urgent'.

    The Android app maps the *sound* to the priority channel, not the topic — so
    giving person/cat a different priority than the doorbell ('urgent'/5) puts
    them on a different channel where you can pick a different ringtone.
    """
    return os.environ.get(f"NTFY_PRIORITY_{label.upper()}", "").strip() or "urgent"


def _notify_ntfy(cfg, payload: dict, label: str) -> None:
    """Loud ntfy alarm with the detection image (header values stay ASCII; the
    UTF-8 message goes in the body)."""
    if not getattr(cfg, "ntfy_url", "") or label not in getattr(cfg, "ntfy_labels", []):
        return
    headers = {"Title": "Erkennung", "Priority": _ntfy_priority(label), "Tags": "rotating_light"}
    click = payload.get("event_url")
    if click:
        headers["Click"] = click
        headers["Actions"] = f"view, Ansehen, {click}"
    if payload.get("thumb_url"):
        headers["Attach"] = payload["thumb_url"]
    name = LABEL_TEXT.get(label, label)
    device = payload.get("device_name") or "Kamera"
    body = f"🚨 {name} erkannt ({device})".encode("utf-8")
    try:
        req = urllib.request.Request(cfg.ntfy_url, data=body, headers=headers)
        urllib.request.urlopen(req, timeout=10).close()
        log.info("ntfy alarm for label=%s", label)
    except Exception as e:  # noqa: BLE001
        log.warning("ntfy alarm failed (ignored): %s", e)


def maybe_notify(cfg, payload: dict) -> None:
    label = payload.get("label")
    # Only fire for a real detection (never on 'none'/'error'/'unclassified').
    if label in (None, "none", "error", "unclassified"):
        return

    # 1) Loud ntfy alarm — independent of the n8n/Telegram path.
    _notify_ntfy(cfg, payload, label)

    # 2) n8n/Telegram webhook (per-label URL if configured).
    if label not in cfg.notify_labels or not cfg.notify_enabled:
        return
    url = _webhook_for(cfg, label)
    if not url:
        log.debug("notify stub (no webhook) for label=%s", label)
        return
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).close()
        log.info("notified n8n for label=%s via %s", label, url)
    except Exception as e:  # noqa: BLE001
        log.warning("notify failed (ignored): %s", e)
