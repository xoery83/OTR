import os
import re
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel


MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/var/www/otr-media")).resolve()
PUBLIC_BASE_URL = os.getenv("MEDIA_PUBLIC_BASE_URL", "https://media.xoery.art").rstrip("/")
MAX_UPLOAD_BYTES = int(os.getenv("MEDIA_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))

SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]+")

app = FastAPI(title="OTR Media Service", version="0.1.0")


@app.middleware("http")
async def protect_generate_route(request: Request, call_next):
    if request.url.path == "/generate":
        expected = os.getenv("MEDIA_WORKER_SECRET")
        if not expected:
            return JSONResponse(
                {"detail": "MEDIA_WORKER_SECRET is not configured."},
                status_code=500,
            )
        if request.headers.get("x-media-worker-secret") != expected:
            return JSONResponse({"detail": "Invalid media worker secret."}, status_code=401)
    return await call_next(request)


class VariantResult(BaseModel):
    url: str
    path: str
    width: int
    height: int
    file_size: int
    variant_type: str


class GenerateResponse(BaseModel):
    asset_id: str
    journey_id: str
    thumbnail: VariantResult
    preview: VariantResult


def require_secret(
    x_media_worker_secret: Annotated[
        str | None,
        Header(alias="x-media-worker-secret"),
    ] = None,
) -> None:
    expected = os.getenv("MEDIA_WORKER_SECRET")
    if not expected:
        raise HTTPException(status_code=500, detail="MEDIA_WORKER_SECRET is not configured.")
    if x_media_worker_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid media worker secret.")


def safe_id(value: str, label: str) -> str:
    cleaned = SAFE_ID_RE.sub("-", value.strip()).strip("-")
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{label} is required.")
    return cleaned[:120]


def media_path(journey_id: str, variant_type: str, asset_id: str) -> Path:
    return MEDIA_ROOT / "journeys" / journey_id / f"{variant_type}s" / f"{asset_id}.webp"


def public_url(journey_id: str, variant_type: str, asset_id: str) -> str:
    return f"{PUBLIC_BASE_URL}/journeys/{journey_id}/{variant_type}s/{asset_id}.webp"


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)
    path.chmod(0o644)


def make_variant(image: Image.Image, *, max_dimension: int, quality: int) -> tuple[bytes, int, int]:
    working = ImageOps.exif_transpose(image).convert("RGB")
    working.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    output = BytesIO()
    working.save(output, "WEBP", quality=quality, method=6)
    return output.getvalue(), working.width, working.height


def save_variant(
    image: Image.Image,
    *,
    journey_id: str,
    asset_id: str,
    variant_type: str,
    max_dimension: int,
    quality: int,
) -> VariantResult:
    data, width, height = make_variant(
        image,
        max_dimension=max_dimension,
        quality=quality,
    )
    path = media_path(journey_id, variant_type, asset_id)
    write_atomic(path, data)
    relative_path = path.relative_to(MEDIA_ROOT).as_posix()
    return VariantResult(
        url=public_url(journey_id, variant_type, asset_id),
        path=relative_path,
        width=width,
        height=height,
        file_size=len(data),
        variant_type=variant_type,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "otr-media-service"}


@app.post("/generate", response_model=GenerateResponse)
async def generate_media(
    journey_id: Annotated[str, Form()],
    asset_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    x_media_worker_secret: Annotated[
        str | None,
        Header(alias="x-media-worker-secret"),
    ] = None,
) -> GenerateResponse:
    require_secret(x_media_worker_secret)
    safe_journey_id = safe_id(journey_id, "journey_id")
    safe_asset_id = safe_id(asset_id, "asset_id")
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large.")

    try:
        image = Image.open(BytesIO(content))
        image.verify()
        image = Image.open(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not decode image.") from exc

    thumbnail = save_variant(
        image,
        journey_id=safe_journey_id,
        asset_id=safe_asset_id,
        variant_type="thumbnail",
        max_dimension=420,
        quality=72,
    )
    preview = save_variant(
        image,
        journey_id=safe_journey_id,
        asset_id=safe_asset_id,
        variant_type="preview",
        max_dimension=1280,
        quality=78,
    )

    return GenerateResponse(
        asset_id=safe_asset_id,
        journey_id=safe_journey_id,
        thumbnail=thumbnail,
        preview=preview,
    )
