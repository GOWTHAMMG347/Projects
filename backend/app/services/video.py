"""Background video processing: detect (and optionally track) microplastics frame by frame,
write an annotated MP4, and store per-frame counts."""
import json
import logging
import shutil
import subprocess
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import cv2

from ..config import MODEL_PATH, VIDEO_DIR
from ..database import SessionLocal
from ..models import VideoJob
from .detector import MicroplasticDetector

log = logging.getLogger("video")

MIN_TRACK_FRAMES = 3     # a track must appear in this many processed frames to count as a unique particle
MAX_OUTPUT_SIDE = 1280   # annotated output is downscaled to this longest side to keep files small
MAX_TIMELINE_POINTS = 20000

_SLOT = threading.Semaphore(1)  # one video at a time; further uploads wait as "queued"
_CANCEL: set[int] = set()


class _Cancelled(Exception):
    pass


def request_cancel(job_id: int) -> None:
    _CANCEL.add(job_id)


def start_job(job_id: int) -> None:
    threading.Thread(target=_run, args=(job_id,), daemon=True, name=f"video-{job_id}").start()


def _ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def _transcode_h264(raw: Path, final: Path) -> None:
    """OpenCV writes MPEG-4 Part 2, which browsers can't play. Re-encode to H.264 when ffmpeg is available."""
    exe = _ffmpeg()
    if exe:
        cmd = [exe, "-y", "-loglevel", "error", "-i", str(raw), "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(final)]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=3600)
            if r.returncode == 0:
                raw.unlink(missing_ok=True)
                return
            log.warning("ffmpeg failed: %s", r.stderr.decode(errors="ignore")[:300])
        except Exception as e:  # noqa: BLE001
            log.warning("ffmpeg error: %s", e)
    raw.replace(final)  # fallback: still downloadable, may not play inline


def _run(job_id: int) -> None:
    with _SLOT:
        db = SessionLocal()
        try:
            job = db.get(VideoJob, job_id)
            if job is None:
                return
            if job_id in _CANCEL:
                job.status = "cancelled"
                db.commit()
                return
            job.status = "processing"
            db.commit()
            _process(db, job)
        except _Cancelled:
            job = db.get(VideoJob, job_id)
            if job:
                job.status = "cancelled"
                job.result_path = None
                db.commit()
        except Exception as e:  # noqa: BLE001
            log.exception("video job %s failed", job_id)
            db.rollback()
            job = db.get(VideoJob, job_id)
            if job:
                job.status = "failed"
                job.error = (str(e) or "Processing failed.")[:300]
                db.commit()
        finally:
            _CANCEL.discard(job_id)
            db.close()


def _infer(model, frame, job: VideoJob, use_track: bool):
    kw = dict(conf=job.conf_threshold, iou=job.iou_threshold, imgsz=job.imgsz, verbose=False, max_det=1000)
    res = None
    if use_track:
        try:
            res = model.track(frame, persist=True, tracker="bytetrack.yaml", **kw)[0]
        except Exception as e:  # noqa: BLE001  (e.g. tracker dependency missing)
            log.warning("tracking unavailable, falling back to detection only: %s", e)
            use_track = False
    if res is None:
        res = model.predict(frame, **kw)[0]

    out = []
    boxes = res.boxes
    if boxes is not None and len(boxes):
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        ids = boxes.id.int().cpu().tolist() if (use_track and boxes.id is not None) else [None] * len(confs)
        for (x1, y1, x2, y2), c, tid in zip(xyxy, confs, ids):
            out.append({"x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2),
                        "confidence": float(c), "track_id": tid})
    return out, use_track


def _process(db, job: VideoJob) -> None:
    from ultralytics import YOLO

    model = YOLO(str(MODEL_PATH))  # own instance: tracker state must not mix with image requests
    cap = cv2.VideoCapture(job.original_path)
    if not cap.isOpened():
        raise RuntimeError("Couldn't open the video file.")

    w, h = job.width, job.height
    scale = min(1.0, MAX_OUTPUT_SIDE / max(w, h))
    ow, oh = max(2, int(w * scale) // 2 * 2), max(2, int(h * scale) // 2 * 2)

    stem = Path(job.original_path).stem
    raw_path = VIDEO_DIR / f"{stem}_raw.mp4"
    final_path = VIDEO_DIR / f"{stem}_det.mp4"
    writer = cv2.VideoWriter(str(raw_path), cv2.VideoWriter_fourcc(*"mp4v"), job.fps, (ow, oh))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Couldn't create the output video.")

    use_track = job.tracked
    last: list[dict] = []
    timeline: list[list[int]] = []
    track_frames: Counter = Counter()
    conf_sum, conf_n, count_sum, max_pf, processed, idx = 0.0, 0, 0, 0, 0, 0
    t0 = last_commit = time.perf_counter()

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if job.id in _CANCEL:
                raise _Cancelled
            if idx % job.stride == 0:
                last, use_track = _infer(model, frame, job, use_track)
                processed += 1
                n = len(last)
                count_sum += n
                max_pf = max(max_pf, n)
                for p in last:
                    conf_sum += p["confidence"]
                    conf_n += 1
                    if p["track_id"] is not None:
                        track_frames[p["track_id"]] += 1
                if len(timeline) < MAX_TIMELINE_POINTS:
                    timeline.append([idx, n])
            # Frames between samples reuse the last detections so the output plays smoothly.
            drawn = MicroplasticDetector._draw(frame, last)
            if drawn.shape[1] != ow or drawn.shape[0] != oh:
                drawn = cv2.resize(drawn, (ow, oh), interpolation=cv2.INTER_AREA)
            writer.write(drawn)
            idx += 1

            now = time.perf_counter()
            if now - last_commit >= 1.0:
                last_commit = now
                job.processed_frames = processed
                job.progress = min(0.99, idx / job.total_frames) if job.total_frames > 0 else 0.0
                db.commit()
    finally:
        cap.release()
        writer.release()
        if job.id in _CANCEL:
            raw_path.unlink(missing_ok=True)

    if processed == 0:
        raw_path.unlink(missing_ok=True)
        raise RuntimeError("No frames could be read from this video.")

    job.processed_frames = processed
    job.progress = 0.99
    db.commit()
    _transcode_h264(raw_path, final_path)

    job.tracked = use_track
    if use_track:
        qualified = sum(1 for n in track_frames.values() if n >= MIN_TRACK_FRAMES)
        # Very short clips can't reach the minimum; fall back to counting every track.
        job.unique_count = qualified if processed >= MIN_TRACK_FRAMES else len(track_frames)
    else:
        job.unique_count = None
    job.max_per_frame = max_pf
    job.avg_per_frame = round(count_sum / processed, 2)
    job.avg_confidence = round(conf_sum / conf_n, 4) if conf_n else 0.0
    job.processing_s = round(time.perf_counter() - t0, 1)
    job.timeline_json = json.dumps(timeline, separators=(",", ":"))
    job.result_path = str(final_path)
    job.progress = 1.0
    job.status = "done"
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
