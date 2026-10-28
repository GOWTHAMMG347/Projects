"""Thin wrapper around the trained YOLO11 microplastic model."""
import threading
import time
from pathlib import Path

import cv2
import numpy as np

# BGR. Marker orange stands out against blue/teal/transparent plastic on most backgrounds.
BOX_COLOR = (31, 90, 255)
TEXT_COLOR = (255, 255, 255)


class MicroplasticDetector:
    def __init__(self, model_path: Path):
        from ultralytics import YOLO  # imported lazily so the API can import without torch

        self.model = YOLO(str(model_path))
        self.class_names = self.model.names
        self._lock = threading.Lock()  # one inference at a time; the model isn't guaranteed thread-safe

    def predict(self, rgb: np.ndarray, conf: float, iou: float, imgsz: int, um_per_px: float | None):
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        h, w = bgr.shape[:2]

        t0 = time.perf_counter()
        with self._lock:
            result = self.model.predict(
                bgr, conf=conf, iou=iou, imgsz=imgsz, verbose=False, max_det=1000
            )[0]
        inference_ms = (time.perf_counter() - t0) * 1000

        particles = []
        boxes = result.boxes
        if boxes is not None and len(boxes):
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            order = np.argsort(-confs)
            for rank, i in enumerate(order, start=1):
                x1, y1, x2, y2 = (float(v) for v in xyxy[i])
                bw, bh = x2 - x1, y2 - y1
                longest = max(bw, bh)
                particles.append(
                    {
                        "index": rank,
                        "confidence": round(float(confs[i]), 4),
                        "x1": round(x1, 1),
                        "y1": round(y1, 1),
                        "x2": round(x2, 1),
                        "y2": round(y2, 1),
                        "width_px": round(bw, 1),
                        "height_px": round(bh, 1),
                        "longest_px": round(longest, 1),
                        "longest_um": round(longest * um_per_px, 1) if um_per_px else None,
                    }
                )

        annotated = self._draw(bgr, particles)
        covered = sum((p["x2"] - p["x1"]) * (p["y2"] - p["y1"]) for p in particles)
        summary = {
            "count": len(particles),
            "avg_confidence": round(float(np.mean([p["confidence"] for p in particles])), 4)
            if particles
            else 0.0,
            "max_confidence": max((p["confidence"] for p in particles), default=0.0),
            # Sum of box areas; overlapping boxes are counted twice, so treat as an upper-bound estimate.
            "coverage_pct": round(min(100.0, covered / (w * h) * 100), 3),
            "inference_ms": round(inference_ms, 1),
        }
        return particles, annotated, summary

    @staticmethod
    def _draw(bgr: np.ndarray, particles: list[dict]) -> np.ndarray:
        out = bgr.copy()
        h, w = out.shape[:2]
        scale = max(w, h) / 1000
        thickness = max(1, round(2 * scale))
        font_scale = max(0.4, 0.5 * scale)
        for p in particles:
            p1 = (int(p["x1"]), int(p["y1"]))
            p2 = (int(p["x2"]), int(p["y2"]))
            cv2.rectangle(out, p1, p2, BOX_COLOR, thickness, cv2.LINE_AA)
            tid = p.get("track_id")
            label = f'#{tid} {p["confidence"]:.2f}' if tid is not None else f'{p["confidence"]:.2f}'
            (tw, th), base = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
            ty = max(p1[1], th + base + 2)
            cv2.rectangle(out, (p1[0], ty - th - base - 2), (p1[0] + tw + 6, ty), BOX_COLOR, -1)
            cv2.putText(
                out, label, (p1[0] + 3, ty - base), cv2.FONT_HERSHEY_SIMPLEX,
                font_scale, TEXT_COLOR, 1, cv2.LINE_AA,
            )
        return out
