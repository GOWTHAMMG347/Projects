from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    detections: Mapped[list["Detection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    original_path: Mapped[str] = mapped_column(String(500))
    result_path: Mapped[str] = mapped_column(String(500))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)
    avg_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    max_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    coverage_pct: Mapped[float] = mapped_column(Float, default=0.0)
    conf_threshold: Mapped[float] = mapped_column(Float)
    iou_threshold: Mapped[float] = mapped_column(Float)
    imgsz: Mapped[int] = mapped_column(Integer)
    um_per_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    inference_ms: Mapped[float] = mapped_column(Float)
    detections_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    user: Mapped[User] = relationship(back_populates="detections")


class VideoJob(Base):
    __tablename__ = "video_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)  # queued|processing|done|failed|cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    original_path: Mapped[str] = mapped_column(String(500))
    result_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    poster_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    fps: Mapped[float] = mapped_column(Float)
    total_frames: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unknown
    processed_frames: Mapped[int] = mapped_column(Integer, default=0)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)

    conf_threshold: Mapped[float] = mapped_column(Float)
    iou_threshold: Mapped[float] = mapped_column(Float)
    imgsz: Mapped[int] = mapped_column(Integer)
    stride: Mapped[int] = mapped_column(Integer, default=1)
    tracked: Mapped[bool] = mapped_column(Boolean, default=True)
    um_per_px: Mapped[float | None] = mapped_column(Float, nullable=True)

    unique_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_per_frame: Mapped[int] = mapped_column(Integer, default=0)
    avg_per_frame: Mapped[float] = mapped_column(Float, default=0.0)
    avg_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    processing_s: Mapped[float] = mapped_column(Float, default=0.0)
    timeline_json: Mapped[str] = mapped_column(Text, default="[]")  # [[frame_index, count], ...]

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship()
