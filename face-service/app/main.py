import os
from contextlib import asynccontextmanager
from typing import Annotated

import cv2
import numpy as np
import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from insightface.app import FaceAnalysis
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("INSIGHTFACE_MODEL_NAME") or os.getenv(
    "INSIGHTFACE_MODEL",
    "buffalo_l",
)
MODEL_ROOT = os.getenv("INSIGHTFACE_HOME", "/tmp/insightface")
EMBEDDING_VERSION = f"insightface-{MODEL_NAME}-512"
MAX_IMAGE_BYTES = int(os.getenv("FACE_SERVICE_MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))
DEFAULT_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.42"))

face_app: FaceAnalysis | None = None


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


class EmbedResponse(BaseModel):
    model_name: str
    embedding_version: str
    faces: list[FaceResult]


class CompareRequest(BaseModel):
    embedding_a: list[float] | None = None
    embedding_b: list[float] | None = None
    image_url_a: str | None = None
    image_url_b: str | None = None
    threshold: float = Field(default=DEFAULT_MATCH_THRESHOLD, ge=-1.0, le=1.0)


class CompareResponse(BaseModel):
    model_name: str
    embedding_version: str
    similarity: float
    is_match: bool
    threshold: float


def load_face_app() -> FaceAnalysis:
    analyzer = FaceAnalysis(
        name=MODEL_NAME,
        root=MODEL_ROOT,
        providers=["CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))
    return analyzer


@asynccontextmanager
async def lifespan(_: FastAPI):
    global face_app
    face_app = load_face_app()
    yield


app = FastAPI(title="OTR Face Service", version="0.2.0", lifespan=lifespan)


def get_face_app() -> FaceAnalysis:
    if face_app is None:
        raise HTTPException(status_code=503, detail="Face model is not loaded.")
    return face_app


def require_secret(
    x_face_service_secret: Annotated[
        str | None,
        Header(alias="x-face-service-secret"),
    ] = None,
) -> None:
    expected = os.getenv("FACE_SERVICE_SECRET")
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="FACE_SERVICE_SECRET is not configured.",
        )
    if x_face_service_secret != expected:
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


def analyze_faces(image_url: str) -> list[FaceResult]:
    image = fetch_image(image_url)
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

    return results


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        raise HTTPException(
            status_code=400,
            detail="Embeddings must have the same non-zero length.",
        )

    left_vector = np.array(left, dtype=np.float32)
    right_vector = np.array(right, dtype=np.float32)
    denominator = float(np.linalg.norm(left_vector) * np.linalg.norm(right_vector))
    if denominator == 0.0:
        raise HTTPException(status_code=400, detail="Embeddings must not be zero vectors.")

    return float(np.dot(left_vector, right_vector) / denominator)


def first_embedding_from_image(image_url: str) -> list[float]:
    faces = analyze_faces(image_url)
    if not faces:
        raise HTTPException(status_code=400, detail="No face found in image.")
    return faces[0].embedding


def resolve_compare_embedding(
    embedding: list[float] | None,
    image_url: str | None,
    label: str,
) -> list[float]:
    if embedding is not None:
        return embedding
    if image_url:
        return first_embedding_from_image(image_url)
    raise HTTPException(
        status_code=400,
        detail=f"{label} embedding or image_url is required.",
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post(
    "/faces/detect",
    response_model=DetectResponse,
    dependencies=[Depends(require_secret)],
)
def detect_faces(
    payload: DetectRequest,
) -> DetectResponse:
    return DetectResponse(
        model_name=MODEL_NAME,
        embedding_version=EMBEDDING_VERSION,
        faces=analyze_faces(payload.image_url),
    )


@app.post(
    "/faces/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_secret)],
)
def embed_faces(payload: DetectRequest) -> EmbedResponse:
    return EmbedResponse(
        model_name=MODEL_NAME,
        embedding_version=EMBEDDING_VERSION,
        faces=analyze_faces(payload.image_url),
    )


@app.post(
    "/faces/compare",
    response_model=CompareResponse,
    dependencies=[Depends(require_secret)],
)
def compare_faces(payload: CompareRequest) -> CompareResponse:
    embedding_a = resolve_compare_embedding(
        payload.embedding_a,
        payload.image_url_a,
        "embedding_a",
    )
    embedding_b = resolve_compare_embedding(
        payload.embedding_b,
        payload.image_url_b,
        "embedding_b",
    )
    similarity = round(cosine_similarity(embedding_a, embedding_b), 8)

    return CompareResponse(
        model_name=MODEL_NAME,
        embedding_version=EMBEDDING_VERSION,
        similarity=similarity,
        is_match=similarity >= payload.threshold,
        threshold=payload.threshold,
    )


@app.post(
    "/detect",
    response_model=DetectResponse,
    dependencies=[Depends(require_secret)],
)
def legacy_detect_faces(payload: DetectRequest) -> DetectResponse:
    return DetectResponse(
        model_name=MODEL_NAME,
        embedding_version=EMBEDDING_VERSION,
        faces=analyze_faces(payload.image_url),
    )
