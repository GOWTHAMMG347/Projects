import io
import json
import uuid

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from ..config import MAX_UPLOAD_BYTES, RESULT_DIR, UPLOAD_DIR
from ..database import get_db
from ..deps import get_current_user
from ..models import Detection, User
from ..schemas import DetectionOut

router = APIRouter(tags=["detect"])

ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "BMP": "bmp", "TIFF": "tif"}
ALLOWED_IMGSZ = {640, 960, 1280, 1536}


@router.post("/detect", response_model=DetectionOut, status_code=status.HTTP_201_CREATED)
def detect(
    request: Request,
    file: UploadFile = File(...),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    imgsz: int = Form(640),
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
    if um_per_px is not None and um_per_px <= 0:
        um_per_px = None

    raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Image is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        if fmt not in ALLOWED_FORMATS:
            raise HTTPException(415, "Upload a JPG, PNG, WEBP, BMP or TIFF image.")
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(415, "This file isn't a readable image.")

    rgb = np.asarray(img)
    h, w = rgb.shape[:2]

    detector = request.app.state.detector
    particles, annotated, summary = detector.predict(rgb, conf, iou, imgsz, um_per_px)

    # Store files under random names; the original filename is kept only as display text.
    stem = uuid.uuid4().hex
    original_path = UPLOAD_DIR / f"{stem}.jpg"
    result_path = RESULT_DIR / f"{stem}.jpg"
    img.save(original_path, "JPEG", quality=92)
    cv2.imwrite(str(result_path), annotated, [cv2.IMWRITE_JPEG_QUALITY, 92])

    row = Detection(
        user_id=user.id,
        filename=(file.filename or "image")[:255],
        original_path=str(original_path),
        result_path=str(result_path),
        width=w,
        height=h,
        conf_threshold=conf,
        iou_threshold=iou,
        imgsz=imgsz,
        um_per_px=um_per_px,
        detections_json=json.dumps(particles),
        **summary,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
