import math
import mimetypes
import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_DIR
from ..database import get_db
from ..deps import bearer, get_current_user
from ..models import User, VideoJob
from ..schemas import MediaUrls, VideoDetail, VideoSummary
from ..security import create_media_token, decode_access_token, decode_media_token
from ..services import video as video_service

router = APIRouter(tags=["video"])

ALLOWED_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
ALLOWED_IMGSZ = {640, 960, 1280, 1536}
ALLOWED_STRIDE = {1, 2, 3, 5, 10}


def _owned(db: Session, user: User, video_id: int) -> VideoJob:
    row = db.get(VideoJob, video_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Video not found.")
    return row


def _remove_files(row: VideoJob) -> None:
    for p in (row.original_path, row.result_path, row.poster_path):
        if p:
            Path(p).unlink(missing_ok=True)
    stem = Path(row.original_path).stem
    (VIDEO_DIR / f"{stem}_raw.mp4").unlink(missing_ok=True)


@router.post("/videos", response_model=VideoDetail, status_code=status.HTTP_201_CREATED)
def upload_video(
    file: UploadFile = File(...),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    imgsz: int = Form(640),
    stride: int = Form(2),
    track: bool = Form(True),
    um_per_px: float | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not 0.01 <= conf <= 0.99:
        raise HTTPException(422, "Confidence must be between 0.01 and 0.99.")
    if not 0.05 <= iou <= 0.95:
        raise HTTPException(422, "IoU must be between 0.05 and 0.95.")
    if imgsz not in ALLOWED_IMGSZ:
        raise HTTPException(422, f"Resolution must be one of {sorted(ALLOWED_IMGSZ)}.")
    if stride not in ALLOWED_STRIDE:
        raise HTTPException(422, f"Frame sampling must be one of {sorted(ALLOWED_STRIDE)}.")
    if um_per_px is not None and um_per_px <= 0:
        um_per_px = None

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, "Upload an MP4, MOV, AVI, MKV, WEBM or M4V video.")

    stem = uuid.uuid4().hex
    original = VIDEO_DIR / f"{stem}{ext}"
    poster = VIDEO_DIR / f"{stem}_poster.jpg"

    # Stream to disk in chunks so large videos never sit in memory.
    size = 0
    too_big = False
    with open(original, "wb") as out:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                too_big = True
                break
            out.write(chunk)
    if too_big:
        original.unlink(missing_ok=True)
        raise HTTPException(413, f"Video is larger than {MAX_VIDEO_BYTES // (1024 * 1024)} MB.")

    def reject(code: int, msg: str):
        original.unlink(missing_ok=True)
        poster.unlink(missing_ok=True)
        raise HTTPException(code, msg)

    cap = cv2.VideoCapture(str(original))
    if not cap.isOpened():
        cap.release()
        reject(415, "This file isn't a readable video.")
    ok, first = cap.read()
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or (first.shape[1] if ok else 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or (first.shape[0] if ok else 0)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if not ok or w <= 0 or h <= 0:
        reject(415, "No frames could be read from this video.")
    if not fps or math.isnan(fps) or fps <= 0 or fps > 240:
        fps = 25.0
    if frames < 0 or frames > 10_000_000:
        frames = 0
    duration = frames / fps if frames > 0 else 0.0
    if duration > MAX_VIDEO_SECONDS:
        reject(413, f"Video is longer than {MAX_VIDEO_SECONDS // 60} minutes. Trim it and try again.")

    ph, pw = first.shape[:2]
    if pw > 640:
        first = cv2.resize(first, (640, max(1, int(ph * 640 / pw))), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(poster), first, [cv2.IMWRITE_JPEG_QUALITY, 85])

    row = VideoJob(
        user_id=user.id,
        filename=(file.filename or "video")[:255],
        status="queued",
        original_path=str(original),
        poster_path=str(poster),
        width=w, height=h, fps=float(fps), total_frames=frames, duration_s=round(duration, 2),
        conf_threshold=conf, iou_threshold=iou, imgsz=imgsz, stride=stride, tracked=track,
        um_per_px=um_per_px,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    video_service.start_job(row.id)
    return row


@router.get("/videos", response_model=list[VideoSummary])
def list_videos(
    limit: int = Query(24, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(VideoJob).where(VideoJob.user_id == user.id)
        .order_by(VideoJob.created_at.desc()).limit(limit).offset(offset)
    )
    return db.scalars(stmt).all()


@router.get("/videos/{video_id}", response_model=VideoDetail)
def get_video(video_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _owned(db, user, video_id)


@router.post("/videos/{video_id}/cancel", status_code=202)
def cancel_video(video_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, user, video_id)
    if row.status not in ("queued", "processing"):
        raise HTTPException(409, "This video isn't being processed.")
    video_service.request_cancel(row.id)
    return {"status": "cancelling"}


@router.delete("/videos/{video_id}", status_code=204)
def delete_video(video_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, user, video_id)
    if row.status in ("queued", "processing"):
        raise HTTPException(409, "Stop processing before deleting this video.")
    _remove_files(row)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/videos/{video_id}/media", response_model=MediaUrls)
def media_urls(video_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Signed URLs so <video>/<img> tags can load files (they can't send an Authorization header)."""
    row = _owned(db, user, video_id)
    t = create_media_token(row.id, user.id)
    base = f"/api/videos/{row.id}/file?t={t}"
    return MediaUrls(
        result=f"{base}&kind=result" if row.result_path else None,
        original=f"{base}&kind=original",
        poster=f"{base}&kind=poster" if row.poster_path else None,
    )


@router.get("/videos/{video_id}/file")
def media_file(
    video_id: int,
    kind: str = Query("result", pattern="^(result|original|poster)$"),
    t: str | None = None,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user_id = None
    if creds:
        user_id = decode_access_token(creds.credentials)
    if user_id is None and t:
        claims = decode_media_token(t)
        if claims and claims[0] == video_id:
            user_id = claims[1]
    if user_id is None:
        raise HTTPException(401, "Your session has expired. Sign in again.")

    row = db.get(VideoJob, video_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(404, "Video not found.")
    path_str = {"result": row.result_path, "original": row.original_path, "poster": row.poster_path}[kind]
    if not path_str or not Path(path_str).exists():
        raise HTTPException(404, "File is not available.")
    media_type = "image/jpeg" if kind == "poster" else (
        "video/mp4" if kind == "result" else (mimetypes.guess_type(path_str)[0] or "video/mp4")
    )
    # FileResponse supports HTTP Range requests, which the browser needs for seeking.
    return FileResponse(path_str, media_type=media_type, headers={"Cache-Control": "private, max-age=600"})
