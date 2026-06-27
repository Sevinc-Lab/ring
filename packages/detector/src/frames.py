"""Sample frames evenly across the WHOLE clip via ffmpeg (KORREKTUR M4-2)."""
from __future__ import annotations

import json
import os
import subprocess


def probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def frame_timestamps(duration: float, n: int) -> list[float]:
    """Evenly spread over the whole clip — (k+0.5)/n avoids the very start/end."""
    if n <= 0:
        return []
    if duration <= 0:
        return [0.0]
    return [duration * (k + 0.5) / n for k in range(n)]


def sample_frames(path: str, n: int, out_dir: str) -> tuple[float, list[tuple[float, str]]]:
    """Return (duration, [(timestamp, frame_path), ...]) covering the whole clip."""
    duration = probe_duration(path)
    frames: list[tuple[float, str]] = []
    for idx, t in enumerate(frame_timestamps(duration, n)):
        fp = os.path.join(out_dir, f"f{idx}.jpg")
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{t:.3f}",
                 "-i", path, "-frames:v", "1", "-q:v", "3", "-y", fp],
                capture_output=True,
                timeout=60,
            )
        except Exception:
            continue
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            frames.append((t, fp))
    return duration, frames
