import os
import re
import tempfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel
from opencc import OpenCC
from pydantic import BaseModel


SERVICE_VERSION = "stt-faster-whisper-v1"
MAX_AUDIO_BYTES = int(os.getenv("STT_MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))
MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "base")
DEVICE = os.getenv("STT_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
LANGUAGE = os.getenv("STT_LANGUAGE") or None

app = FastAPI(title="OTR STT Service", version="0.1.0")
model: WhisperModel | None = None
opencc = OpenCC("t2s")


class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResponse(BaseModel):
    text: str
    language: str | None
    duration: float | None
    provider: str
    model: str
    segments: list[Segment]


def require_secret(
    x_ai_server_secret: Annotated[str | None, Header(alias="x-ai-server-secret")] = None,
) -> None:
    expected = os.getenv("AI_SERVER_SECRET")
    if not expected:
        raise HTTPException(status_code=500, detail="AI_SERVER_SECRET is not configured.")
    if x_ai_server_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid AI server secret.")


def normalize_transcript_text(text: str) -> str:
    return re.sub(r"\s+", " ", opencc.convert(text)).strip()


def comparable_transcript_text(text: str) -> str:
    return re.sub(r"[\s,，.。!！?？:：;；、\"'“”‘’（）()]+", "", text)


def merge_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for segment in segments:
        text = normalize_transcript_text(str(segment["text"]))
        if not text:
            continue

        current = {**segment, "text": text}
        current_key = comparable_transcript_text(text)
        previous = merged[-1] if merged else None
        previous_key = (
            comparable_transcript_text(str(previous["text"])) if previous else ""
        )

        if previous and current_key == previous_key:
            previous["end"] = current["end"]
            continue

        if previous and current_key.startswith(previous_key) and len(current_key) > len(previous_key):
            merged[-1] = {
                **current,
                "start": previous["start"],
            }
            continue

        if previous and previous_key.startswith(current_key):
            previous["end"] = current["end"]
            continue

        merged.append(current)
    return merged


@app.on_event("startup")
def load_model() -> None:
    global model
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "stt-service",
        "version": SERVICE_VERSION,
        "model": MODEL_SIZE,
    }


@app.post(
    "/stt/transcribe",
    response_model=TranscriptionResponse,
    dependencies=[Depends(require_secret)],
)
async def transcribe(audio: UploadFile = File(...)) -> dict[str, Any]:
    if model is None:
        raise HTTPException(status_code=503, detail="STT model is not ready.")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file is too large.")

    suffix = Path(audio.filename or "capture.webm").suffix or ".webm"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        segments_iter, info = model.transcribe(
            temp_path,
            language=LANGUAGE,
            vad_filter=True,
            beam_size=5,
        )
        segments = [
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
            }
            for segment in segments_iter
        ]
        segments = merge_segments(segments)
        text = " ".join(segment["text"] for segment in segments if segment["text"]).strip()
        return {
            "text": text,
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
            "provider": "faster-whisper",
            "model": MODEL_SIZE,
            "segments": segments,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)
