import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT_DIR / 'storage' / 'app.db'}")
MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT_DIR / "backend" / "models" / "best.pt"))
if not MODEL_PATH.is_absolute():
    MODEL_PATH = ROOT_DIR / MODEL_PATH

UPLOAD_DIR = ROOT_DIR / "storage" / "uploads"
RESULT_DIR = ROOT_DIR / "storage" / "results"
VIDEO_DIR = ROOT_DIR / "storage" / "videos"
FRONTEND_DIR = ROOT_DIR / "frontend"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "15")) * 1024 * 1024
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_MB", "200")) * 1024 * 1024
MAX_VIDEO_SECONDS = int(os.getenv("MAX_VIDEO_SECONDS", "300"))

for d in (UPLOAD_DIR, RESULT_DIR, VIDEO_DIR):
    d.mkdir(parents=True, exist_ok=True)

if SECRET_KEY == "dev-only-change-me":
    print("WARNING: using the default SECRET_KEY. Set SECRET_KEY in .env before deploying.")
