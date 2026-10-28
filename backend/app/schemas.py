import json
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("password")
    @classmethod
    def strong_enough(cls, v: str) -> str:
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("Password must contain at least one letter and one number")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: EmailStr


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class Particle(BaseModel):
    index: int
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float
    width_px: float
    height_px: float
    longest_px: float
    longest_um: float | None = None


class DetectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    width: int
    height: int
    count: int
    avg_confidence: float
    max_confidence: float
    coverage_pct: float
    conf_threshold: float
    iou_threshold: float
    imgsz: int
    um_per_px: float | None
    inference_ms: float
    created_at: datetime
    particles: list[Particle] = []

    @model_validator(mode="before")
    @classmethod
    def load_particles(cls, data):
        # Accept an ORM row: decode its JSON column into `particles`.
        if hasattr(data, "detections_json"):
            return {
                **{k: getattr(data, k) for k in cls.model_fields if k != "particles" and hasattr(data, k)},
                "particles": json.loads(data.detections_json or "[]"),
            }
        return data


class StatsOut(BaseModel):
    analyses: int
    total_particles: int
    avg_per_image: float
    avg_confidence: float


class VideoSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    status: str
    progress: float
    error: str | None
    width: int
    height: int
    fps: float
    total_frames: int
    processed_frames: int
    duration_s: float
    conf_threshold: float
    iou_threshold: float
    imgsz: int
    stride: int
    tracked: bool
    um_per_px: float | None
    unique_count: int | None
    max_per_frame: int
    avg_per_frame: float
    avg_confidence: float
    processing_s: float
    created_at: datetime
    finished_at: datetime | None


class VideoDetail(VideoSummary):
    timeline: list[list[int]] = []  # [frame_index, particle_count]

    @model_validator(mode="before")
    @classmethod
    def load_timeline(cls, data):
        if hasattr(data, "timeline_json"):
            return {
                **{k: getattr(data, k) for k in VideoSummary.model_fields if hasattr(data, k)},
                "timeline": json.loads(data.timeline_json or "[]"),
            }
        return data


class MediaUrls(BaseModel):
    result: str | None
    original: str
    poster: str | None
