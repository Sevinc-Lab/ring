/**
 * ============================================================================
 * M2 STUB — NOT WIRED IN M1. Do not call until M1-Gate #2 passes.
 * ============================================================================
 *
 * This file documents the corrected M2 recording design so the architecture is
 * visible, but it is intentionally inert in M1.
 *
 * KORREKTUR 1 (Architekt): On battery cameras, getSnapshot() does NOT work
 * while the camera is recording — and every motion event starts a recording.
 * Therefore the thumbnail MUST be derived from the FIRST FRAME of the
 * recordToFile() clip via ffmpeg, never from getSnapshot().
 *
 * Planned flow (M2):
 *   t0 = Date.now()
 *   await camera.recordToFile(clipAbs, CLIP_SECONDS)   // wakes the stream
 *   cold_start_ms = (first frame timestamp) - t0
 *   ffmpeg -i clipAbs -frames:v 1 -q:v 2 thumbAbs      // first-frame thumbnail
 *   - success -> UPDATE row: clip_path, thumb_path, clip_seconds, cold_start_ms, status='recorded'
 *   - failure -> UPDATE row: status='failed', error=...   (row stays; maybe no thumbnail)
 *
 * getSnapshot() may be attempted ONLY as best-effort when RECORD_SNAPSHOT=true,
 * and is never a reliable fallback.
 *
 * Concurrency: one recording per camera at a time (battery-friendly). Overlapping
 * events during an active recording are logged as rows but not streamed in parallel.
 */

export const M2_NOT_IMPLEMENTED = true
