# Microplastic Detector

Web app for detecting microplastics in sample images and videos using your trained YOLO11m model (`best.pt`).
FastAPI backend, SQLite database, JWT login, and a static HTML/CSS/JS frontend served by the same server (no Node build step).

## Run it

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then set SECRET_KEY (command is inside the file)
uvicorn backend.app.main:app --reload
```

Open http://127.0.0.1:8000. Interactive API docs are at http://127.0.0.1:8000/docs.

The model is expected at `backend/models/best.pt` (already placed there). Change `MODEL_PATH` in `.env` to use another file.

## Project structure

```
microplastic-detector/
├── backend/
│   ├── models/best.pt            your trained weights
│   └── app/
│       ├── main.py               app setup, loads model once, serves frontend
│       ├── config.py             settings from .env
│       ├── database.py           SQLAlchemy engine/session
│       ├── models.py             User, Detection tables
│       ├── schemas.py            request/response validation
│       ├── security.py           bcrypt hashing, JWT
│       ├── deps.py               get_current_user dependency
│       ├── routers/
│       │   ├── auth.py           register, login, me
│       │   ├── detect.py         POST /api/detect (images)
│       │   ├── video.py          video upload, status, cancel, media
│       │   └── history.py        list, detail, image, delete, stats
│       └── services/
│           ├── detector.py       YOLO wrapper + box drawing
│           └── video.py          background frame-by-frame processing
├── frontend/
│   ├── index.html                landing page
│   ├── login.html, register.html
│   ├── analyze.html              image upload + results
│   ├── video.html                video upload, progress, results
│   ├── history.html              past analyses
│   ├── css/styles.css            design system
│   └── js/ api.js, auth.js, shell.js, field.js, analyze.js, history.js, video.js
├── storage/                      uploaded and annotated images, app.db
├── requirements.txt, .env.example, Dockerfile
```

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | name, email, password (8+ chars, letter and number) |
| POST | `/api/auth/login` | returns JWT |
| GET | `/api/auth/me` | current user |
| POST | `/api/detect` | multipart: `file`, `conf`, `iou`, `imgsz`, `um_per_px` |
| GET | `/api/detections` | your history, paged |
| GET | `/api/detections/{id}` / `/image?kind=result\|original` | detail / image |
| DELETE | `/api/detections/{id}` | removes record and files |
| GET | `/api/stats` | totals for the History page |
| POST | `/api/videos` | multipart: `file`, `conf`, `iou`, `imgsz`, `stride`, `track`, `um_per_px`. Returns immediately; processing runs in the background |
| GET | `/api/videos`, `/api/videos/{id}` | list / status, progress, stats and per-frame timeline |
| POST | `/api/videos/{id}/cancel` | stop a queued or running job |
| DELETE | `/api/videos/{id}` | removes record and files (not while running) |
| GET | `/api/videos/{id}/media` | short-lived signed URLs for the `<video>` and poster |

## How video works

1. The upload is streamed to disk, checked (type, size, length, readable) and a job is queued.
2. A background worker processes one video at a time. Every Nth frame goes through the model; frames in between reuse the last boxes.
3. With **Count unique particles** on, the model's built-in ByteTrack tracker gives each particle an ID. A particle counts as unique once it appears in 3 analysed frames, which filters one-frame noise. A particle that leaves the view and returns can be counted twice.
4. The annotated video is written with OpenCV, then re-encoded to H.264 with the ffmpeg binary bundled in `imageio-ffmpeg`, so it plays in browsers. Output is capped at 1280 px on the longest side.
5. The page polls for progress. Jobs survive navigating away; reopen from History. Jobs interrupted by a server restart are marked failed.

Limits are set in `.env` (`MAX_VIDEO_MB`, `MAX_VIDEO_SECONDS`). Video URLs use a signed token that is valid for 60 minutes and only for that video.

## Before you deploy

- Set a long random `SECRET_KEY`; serve over HTTPS.
- The JWT sits in `localStorage`. For stricter security, move it to an HttpOnly cookie.
- Add rate limiting on `/api/auth/*` (e.g. `slowapi` or your reverse proxy).
- SQLite is fine for one server. Use Postgres via `DATABASE_URL` for more.
- Inference runs on CPU unless CUDA-enabled PyTorch is installed. Large `imgsz` values are slow on CPU.
- The landing page shows model facts only (architecture, class, resolution). Add your own mAP/precision/recall from training if you want to show accuracy.

## Docker

```bash
docker build -t microplastic-detector .
docker run -p 8000:8000 --env-file .env -v $(pwd)/storage:/app/storage microplastic-detector
```
