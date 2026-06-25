import os
from functools import lru_cache
from typing import Annotated

import cv2
import numpy as np
import requests
from fastapi import FastAPI, Header, HTTPException
from insightface.app import FaceAnalysis
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("INSIGHTFACE_MODEL", "buffalo_l")
EMBEDDING_VERSION = f"insightface-{MODEL_NAME}-512"
MAX_IMAGE_BYTES = int(os.getenv("FACE_SERVICE_MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))


class DetectRequest(BaseModel):
    image_url: str = Field(min_length=1)


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class FaceResult(BaseModel):
    bounding_box: BoundingBox
    embedding: list[float]
    confidence: float | None = None
    quality_score: float | None = None


class DetectResponse(BaseModel):
    model_name: str
    embedding_version: str
    faces: list[FaceResult]


app = FastAPI(title="OTR Face Service", version="0.1.0")


@lru_cache(maxsize=1)
def get_face_app() -> FaceAnalysis:
    face_app = FaceAnalysis(name=MODEL_NAME, providers=["CPUExecutionProvider"])
    face_app.prepare(ctx_id=-1, det_size=(640, 640))
    return face_app


def require_secret(secret: str | None) -> None:
    expected = os.getenv("FACE_SERVICE_SECRET")
    if expected and secret != expected:
        raise HTTPException(status_code=401, detail="Invalid face service secret.")


def fetch_image(image_url: str) -> np.ndarray:
    try:
        response = requests.get(image_url, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch image: {exc}") from exc

    content = response.content
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large for face detection.")

    image_array = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")
    return image


def face_quality(face) -> float | None:
    keypoints = getattr(face, "kps", None)
    bbox = getattr(face, "bbox", None)
    if keypoints is None or bbox is None:
        return None

    width = max(float(bbox[2] - bbox[0]), 1.0)
    height = max(float(bbox[3] - bbox[1]), 1.0)
    area_score = min((width * height) / (240.0 * 240.0), 1.0)
    keypoint_score = min(len(keypoints) / 5.0, 1.0)
    return round((area_score * 0.6) + (keypoint_score * 0.4), 4)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/detect", response_model=DetectResponse)
def detect_faces(
    payload: DetectRequest,
    x_face_service_secret: Annotated[str | None, Header()] = None,
) -> DetectResponse:
    require_secret(x_face_service_secret)
    image = fetch_image(payload.image_url)
    faces = get_face_app().get(image)

    results: list[FaceResult] = []
    for face in faces:
        bbox = [float(value) for value in face.bbox]
        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            embedding = getattr(face, "embedding", None)
        if embedding is None:
            continue

        results.append(
            FaceResult(
                bounding_box=BoundingBox(
                    x=round(bbox[0], 2),
                    y=round(bbox[1], 2),
                    width=round(max(bbox[2] - bbox[0], 0.0), 2),
                    height=round(max(bbox[3] - bbox[1], 0.0), 2),
                ),
                embedding=[round(float(value), 8) for value in embedding.tolist()],
                confidence=round(float(getattr(face, "det_score", 0.0)), 4),
                quality_score=face_quality(face),
            )
        )

    return DetectResponse(
        model_name=MODEL_NAME,
        embedding_version=EMBEDDING_VERSION,
        faces=results,
    )
