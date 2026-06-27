"""Environment configuration for the detector (M4a)."""
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass
class Config:
    db_path: str = field(default_factory=lambda: os.environ.get("DATA_DB_PATH", "/data/db/ring.db"))
    media_dir: str = field(default_factory=lambda: os.environ.get("DATA_MEDIA_DIR", "/data/media"))
    model_path: str = field(default_factory=lambda: os.environ.get("MODEL_PATH", "/app/model/yolov8n.onnx"))
    poll_seconds: int = field(default_factory=lambda: _int("POLL_SECONDS", 5))
    frames_per_clip: int = field(default_factory=lambda: _int("FRAMES_PER_CLIP", 5))  # KORREKTUR M4-2
    min_confidence: float = field(default_factory=lambda: _float("MIN_CONFIDENCE", 0.40))
    detect_classes: list = field(
        default_factory=lambda: [
            c.strip() for c in os.environ.get("DETECT_CLASSES", "person").split(",") if c.strip()
        ]
    )
    # M4c — unused in M4a (stub stays off by default)
    n8n_webhook_url: str = field(default_factory=lambda: os.environ.get("N8N_WEBHOOK_URL", ""))
    notify_enabled: bool = field(
        default_factory=lambda: os.environ.get("NOTIFY_ENABLED", "false").lower() == "true"
    )
    log_level: str = field(default_factory=lambda: os.environ.get("LOG_LEVEL", "info"))
