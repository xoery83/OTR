import os
import re
import json
import subprocess
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel


MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/var/www/otr-media")).resolve()
PUBLIC_BASE_URL = os.getenv("MEDIA_PUBLIC_BASE_URL", "https://media.xoery.art").rstrip("/")
MAX_UPLOAD_BYTES = int(os.getenv("MEDIA_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
MAX_VIDEO_UPLOAD_BYTES = int(
    os.getenv("MEDIA_MAX_VIDEO_UPLOAD_BYTES", str(300 * 1024 * 1024))
)

SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]+")

app = FastAPI(title="OTR Media Service", version="0.1.0")


@app.middleware("http")
async def protect_generate_route(request: Request, call_next):
    if request.url.path in {"/generate", "/process-video"}:
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


class VideoMetadata(BaseModel):
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    rotation: int | None = None
    codec: str | None = None
    bitrate: int | None = None
    has_audio: bool = False


class VideoProcessResponse(BaseModel):
    asset_id: str
    journey_id: str
    metadata: VideoMetadata
    thumbnail: VariantResult
    thumbnails: list[VariantResult]
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


def video_thumbnail_path(journey_id: str, asset_id: str, index: int) -> Path:
    return (
        MEDIA_ROOT
        / "journeys"
        / journey_id
        / "video-thumbnails"
        / f"{asset_id}-{index}.webp"
    )


def video_thumbnail_url(journey_id: str, asset_id: str, index: int) -> str:
    return (
        f"{PUBLIC_BASE_URL}/journeys/{journey_id}/video-thumbnails/"
        f"{asset_id}-{index}.webp"
    )


def video_preview_path(journey_id: str, asset_id: str) -> Path:
    return MEDIA_ROOT / "journeys" / journey_id / "video-previews" / f"{asset_id}.mp4"


def video_preview_url(journey_id: str, asset_id: str) -> str:
    return f"{PUBLIC_BASE_URL}/journeys/{journey_id}/video-previews/{asset_id}.mp4"


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


def run_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "Media command failed."
        raise HTTPException(status_code=400, detail=detail[:500]) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Video processing timed out.") from exc


def parse_fps(value: str | None) -> float | None:
    if not value or value == "0/0":
        return None
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            den = float(denominator)
            return None if den == 0 else round(float(numerator) / den, 3)
        except ValueError:
            return None
    try:
        return round(float(value), 3)
    except ValueError:
        return None


def probe_video(path: Path) -> VideoMetadata:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams") if isinstance(payload, dict) else []
    video_stream = next(
        (stream for stream in streams if stream.get("codec_type") == "video"),
        {},
    )
    audio_stream = any(stream.get("codec_type") == "audio" for stream in streams)
    tags = video_stream.get("tags") if isinstance(video_stream.get("tags"), dict) else {}
    rotation = video_stream.get("rotation") or tags.get("rotate")
    duration = video_stream.get("duration") or payload.get("format", {}).get("duration")
    bitrate = video_stream.get("bit_rate") or payload.get("format", {}).get("bit_rate")

    return VideoMetadata(
        duration_seconds=round(float(duration), 3) if duration else None,
        width=video_stream.get("width"),
        height=video_stream.get("height"),
        fps=parse_fps(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")),
        rotation=int(float(rotation)) if rotation not in (None, "") else None,
        codec=video_stream.get("codec_name"),
        bitrate=int(float(bitrate)) if bitrate not in (None, "") else None,
        has_audio=audio_stream,
    )


def frame_times(duration: float | None) -> list[float]:
    if not duration or duration <= 1:
        return [0.1]
    if duration < 6:
        return [max(0.1, duration * 0.2), duration * 0.5, max(0.1, duration * 0.8)]
    return [duration * 0.12, duration * 0.32, duration * 0.52, duration * 0.72]


def save_video_thumbnail(
    frame_path: Path,
    *,
    journey_id: str,
    asset_id: str,
    index: int,
) -> VariantResult:
    image = Image.open(frame_path)
    data, width, height = make_variant(image, max_dimension=720, quality=76)
    path = video_thumbnail_path(journey_id, asset_id, index)
    write_atomic(path, data)
    return VariantResult(
        url=video_thumbnail_url(journey_id, asset_id, index),
        path=path.relative_to(MEDIA_ROOT).as_posix(),
        width=width,
        height=height,
        file_size=len(data),
        variant_type="thumbnail",
    )


def extract_video_thumbnails(
    video_path: Path,
    *,
    journey_id: str,
    asset_id: str,
    duration_seconds: float | None,
) -> list[VariantResult]:
    thumbnails: list[VariantResult] = []
    with TemporaryDirectory() as tmp_dir:
        tmp_root = Path(tmp_dir)
        for index, seconds in enumerate(frame_times(duration_seconds)):
            frame_path = tmp_root / f"frame-{index}.jpg"
            run_command(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{seconds:.3f}",
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    str(frame_path),
                ]
            )
            if frame_path.exists() and frame_path.stat().st_size > 0:
                thumbnails.append(
                    save_video_thumbnail(
                        frame_path,
                        journey_id=journey_id,
                        asset_id=asset_id,
                        index=index,
                    )
                )
    if not thumbnails:
        raise HTTPException(status_code=400, detail="Could not extract a video thumbnail.")
    return thumbnails


def extract_video_preview(
    video_path: Path,
    *,
    journey_id: str,
    asset_id: str,
    duration_seconds: float | None,
) -> VariantResult:
    start = 0.0
    if duration_seconds and duration_seconds > 5:
        start = max(0.0, min(duration_seconds - 3, duration_seconds * 0.25))

    path = video_preview_path(journey_id, asset_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(video_path),
        "-t",
        "3",
        "-vf",
        "scale=min(960\\,iw):-2",
        "-movflags",
        "+faststart",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
    ]
    if probe_video(video_path).has_audio:
        command.extend(["-c:a", "aac", "-b:a", "96k"])
    else:
        command.append("-an")
    command.append(str(path))
    run_command(
        command
    )
    path.chmod(0o644)
    return VariantResult(
        url=video_preview_url(journey_id, asset_id),
        path=path.relative_to(MEDIA_ROOT).as_posix(),
        width=0,
        height=0,
        file_size=path.stat().st_size,
        variant_type="preview",
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


@app.post("/process-video", response_model=VideoProcessResponse)
async def process_video(
    journey_id: Annotated[str, Form()],
    asset_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    x_media_worker_secret: Annotated[
        str | None,
        Header(alias="x-media-worker-secret"),
    ] = None,
) -> VideoProcessResponse:
    require_secret(x_media_worker_secret)
    safe_journey_id = safe_id(journey_id, "journey_id")
    safe_asset_id = safe_id(asset_id, "asset_id")
    content = await file.read()
    if len(content) > MAX_VIDEO_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Video is too large.")

    with TemporaryDirectory() as tmp_dir:
        source_path = Path(tmp_dir) / "source-video"
        source_path.write_bytes(content)
        metadata = probe_video(source_path)
        thumbnails = extract_video_thumbnails(
            source_path,
            journey_id=safe_journey_id,
            asset_id=safe_asset_id,
            duration_seconds=metadata.duration_seconds,
        )
        preview = extract_video_preview(
            source_path,
            journey_id=safe_journey_id,
            asset_id=safe_asset_id,
            duration_seconds=metadata.duration_seconds,
        )

    return VideoProcessResponse(
        asset_id=safe_asset_id,
        journey_id=safe_journey_id,
        metadata=metadata,
        thumbnail=thumbnails[0],
        thumbnails=thumbnails,
        preview=preview,
    )
