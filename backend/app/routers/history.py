from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Detection, User
from ..schemas import DetectionOut, StatsOut

router = APIRouter(tags=["history"])


def _owned(db: Session, user: User, detection_id: int) -> Detection:
    row = db.get(Detection, detection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Analysis not found.")
    return row


@router.get("/detections", response_model=list[DetectionOut])
def list_detections(
    limit: int = Query(24, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(Detection)
        .where(Detection.user_id == user.id)
        .order_by(Detection.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return db.scalars(stmt).all()


@router.get("/detections/{detection_id}", response_model=DetectionOut)
def get_detection(detection_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _owned(db, user, detection_id)


@router.get("/detections/{detection_id}/image")
def get_image(
    detection_id: int,
    kind: str = Query("result", pattern="^(result|original)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = _owned(db, user, detection_id)
    path = Path(row.result_path if kind == "result" else row.original_path)
    if not path.exists():
        raise HTTPException(404, "Image file is missing.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/detections/{detection_id}", status_code=204)
def delete_detection(detection_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, user, detection_id)
    for p in (row.original_path, row.result_path):
        Path(p).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    n, total, avg_conf = db.execute(
        select(
            func.count(Detection.id),
            func.coalesce(func.sum(Detection.count), 0),
            func.coalesce(func.avg(Detection.avg_confidence), 0.0),
        ).where(Detection.user_id == user.id)
    ).one()
    return StatsOut(
        analyses=n,
        total_particles=int(total),
        avg_per_image=round(total / n, 1) if n else 0.0,
        avg_confidence=round(float(avg_conf), 3),
    )
