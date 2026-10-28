from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update

from .config import FRONTEND_DIR, MODEL_PATH
from .database import Base, SessionLocal, engine
from .models import VideoJob
from .routers import auth, detect, history, video
from .services.detector import MicroplasticDetector


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Jobs that were running when the server last stopped can never finish.
    with SessionLocal() as db:
        db.execute(
            update(VideoJob)
            .where(VideoJob.status.in_(["queued", "processing"]))
            .values(status="failed", error="The server restarted while this video was processing. Upload it again.")
        )
        db.commit()
    if not MODEL_PATH.exists():
        raise RuntimeError(f"Model weights not found at {MODEL_PATH}")
    app.state.detector = MicroplasticDetector(MODEL_PATH)  # loaded once, reused per request
    yield


app = FastAPI(title="Microplastic Detector", version="1.0.0", lifespan=lifespan)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(detect.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(video.router, prefix="/api")

# Must be mounted last so it doesn't shadow /api routes.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
