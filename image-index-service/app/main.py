import os
import json
from datetime import UTC, datetime
from io import BytesIO
from typing import Annotated, Any

import cv2
import imagehash
import numpy as np
import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field


SERVICE_VERSION = "image-index-local-v2"
MAX_IMAGE_BYTES = int(os.getenv("IMAGE_INDEX_MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))
VISION_ESCALATION_ENABLED = os.getenv("IMAGE_INDEX_ENABLE_VISION_ESCALATION", "true").lower() != "false"
TEXT_REWRITE_ENABLED = os.getenv("IMAGE_INDEX_ENABLE_TEXT_REWRITE", "false").lower() == "true"
VISION_PROVIDER = os.getenv("IMAGE_INDEX_VISION_PROVIDER", "openai").strip().lower()
TEXT_PROVIDER = os.getenv("IMAGE_INDEX_TEXT_PROVIDER", "none").strip().lower()

app = FastAPI(title="OTR Image Index Service", version="0.1.0")


class ImageMetadata(BaseModel):
    file_id: str | None = None
    journey_id: str
    uploader_id: str | None = None
    upload_time: str | None = None
    original_filename: str | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None
    exif_time: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    camera_model: str | None = None
    google_drive_file_id: str | None = None
    supabase_asset_id: str
    storage_provider: str | None = None
    provider_file_id: str | None = None
    mime_type: str | None = None
    exif_json: dict[str, Any] = Field(default_factory=dict)


class IndexRequest(BaseModel):
    media_asset_id: str
    journey_id: str
    image_url: str = Field(min_length=1)
    metadata: ImageMetadata
    force: bool = False


class BatchIndexRequest(BaseModel):
    items: list[IndexRequest]


class EscalateRequest(BaseModel):
    media_asset_id: str
    journey_id: str
    reason: str = Field(min_length=1)


class IndexResponse(BaseModel):
    media_asset_id: str
    status: str
    caption: str
    scene: str | None
    objects: list[str]
    ocr_text: str | None
    people: list[dict[str, Any]]
    image_hash: str
    duplicate_hash: str
    blur_score: float
    brightness_score: float
    dominant_colors: list[str]
    quality_score: float
    needs_llm_review: bool
    llm_review_reason: str | None
    model_used: str
    model_version: str
    cost_estimate: float = 0.0


def require_secret(
    x_ai_server_secret: Annotated[
        str | None,
        Header(alias="x-ai-server-secret"),
    ] = None,
) -> None:
    expected = os.getenv("AI_SERVER_SECRET")
    if not expected:
        raise HTTPException(status_code=500, detail="AI_SERVER_SECRET is not configured.")
    if x_ai_server_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid AI server secret.")


def get_supabase_auth(authorization: str | None) -> tuple[str, dict[str, str]]:
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured.")

    if service_key:
        key = service_key
        bearer = service_key
    elif anon_key and authorization:
        key = anon_key
        bearer = authorization.removeprefix("Bearer ").strip()
    else:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured.",
        )

    return url.rstrip("/"), {
        "apikey": key,
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
    }


def supabase_request(
    method: str,
    path: str,
    authorization: str | None,
    *,
    json: Any | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    base_url, base_headers = get_supabase_auth(authorization)
    request_headers = {**base_headers, **(headers or {})}
    response = requests.request(
        method,
        f"{base_url}/rest/v1/{path}",
        headers=request_headers,
        json=json,
        timeout=25,
    )
    if not response.ok:
        raise HTTPException(
            status_code=500,
            detail=f"Supabase request failed: {response.text[:300]}",
        )
    if response.text:
        return response.json()
    return None


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def fetch_image(image_url: str) -> tuple[bytes, np.ndarray, Image.Image]:
    try:
        response = requests.get(image_url, timeout=25)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch image: {exc}") from exc

    content = response.content
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large for indexing.")

    image_array = np.frombuffer(content, dtype=np.uint8)
    cv_image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if cv_image is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    try:
        pil_image = Image.open(BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not open image.") from exc

    return content, cv_image, pil_image


def blur_score(image: np.ndarray) -> float:
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    score = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
    return round(min(score / 1000.0, 1.0), 4)


def brightness_score(image: np.ndarray) -> float:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    score = float(np.mean(hsv[:, :, 2]) / 255.0)
    return round(score, 4)


def dominant_colors(image: np.ndarray, count: int = 5) -> list[str]:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    small = cv2.resize(rgb, (64, 64), interpolation=cv2.INTER_AREA)
    pixels = small.reshape((-1, 3)).astype(np.float32)
    quantized = (pixels // 32 * 32).astype(np.uint8)
    colors, counts = np.unique(quantized, axis=0, return_counts=True)
    order = np.argsort(counts)[::-1][:count]
    return [
        "#{:02x}{:02x}{:02x}".format(int(colors[index][0]), int(colors[index][1]), int(colors[index][2]))
        for index in order
    ]


def local_caption(metadata: ImageMetadata, faces: list[dict[str, Any]], brightness: float) -> tuple[str, str | None, list[str]]:
    objects: list[str] = []
    if faces:
        objects.append("person")

    if metadata.gps_latitude is not None and metadata.gps_longitude is not None:
        scene = "travel_location"
    elif metadata.width and metadata.height and metadata.width > metadata.height:
        scene = "landscape_or_wide_photo"
    else:
        scene = "photo"

    lighting = "bright" if brightness >= 0.62 else "dark" if brightness <= 0.28 else "normal light"
    people_phrase = f" with {len(faces)} detected face{'s' if len(faces) != 1 else ''}" if faces else ""
    caption = f"A {lighting} travel photo{people_phrase}."
    return caption, scene, objects


def quality_score(blur: float, brightness: float) -> float:
    brightness_balance = max(0.0, 1.0 - abs(brightness - 0.5) * 2.0)
    return round((blur * 0.65) + (brightness_balance * 0.35), 4)


def face_service_detect(image_url: str) -> list[dict[str, Any]]:
    face_url = os.getenv("FACE_SERVICE_URL", "").rstrip("/")
    face_secret = os.getenv("FACE_SERVICE_SECRET")
    if not face_url or not face_secret:
        return []

    try:
        response = requests.post(
            f"{face_url}/faces/detect",
            headers={
                "Content-Type": "application/json",
                "x-face-service-secret": face_secret,
            },
            json={"image_url": image_url},
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        return []

    faces = payload.get("faces", [])
    if not isinstance(faces, list):
        return []
    return [
        {
            "bounding_box": face.get("bounding_box"),
            "confidence": face.get("confidence"),
            "quality_score": face.get("quality_score"),
        }
        for face in faces
        if isinstance(face, dict)
    ]


def openai_endpoint(base_url: str) -> str:
    normalized_base_url = base_url.rstrip("/")
    if normalized_base_url.endswith("/v1"):
        return f"{normalized_base_url}/chat/completions"
    if "api.openai.com" in normalized_base_url:
        return f"{normalized_base_url}/v1/chat/completions"
    return f"{normalized_base_url}/chat/completions"


def chat_endpoint(base_url: str) -> str:
    normalized_base_url = base_url.rstrip("/")
    if normalized_base_url.endswith("/v1"):
        return f"{normalized_base_url}/chat/completions"
    return f"{normalized_base_url}/chat/completions"


def should_escalate_to_vision(objects: list[str], scene: str | None, quality: float) -> tuple[bool, str | None]:
    semantic_objects = {item for item in objects if item not in {"person", "photo"}}
    if quality < 0.35:
        return True, "low_quality_local_index"
    if scene in {None, "photo", "landscape_or_wide_photo"} and not semantic_objects:
        return True, "sparse_local_index"
    if not semantic_objects:
        return True, "missing_semantic_objects"
    return False, None


def vision_index(image_url: str) -> dict[str, Any] | None:
    if not VISION_ESCALATION_ENABLED:
        return None

    provider = VISION_PROVIDER
    if provider == "qwen":
        api_key = os.getenv("DASHSCOPE_API_KEY")
        base_url = os.getenv("DASHSCOPE_BASE_URL")
        model = os.getenv("DASHSCOPE_VISION_MODEL") or "qwen3-vl-plus"
        response_format: dict[str, Any] = {"type": "json_object"}
    elif provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_URL") or "https://api.openai.com/v1"
        model = os.getenv("OPENAI_VISION_MODEL") or os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "otr_image_index",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "caption": {"type": "string"},
                        "scene": {"type": "string"},
                        "activity": {"type": ["string", "null"]},
                        "objects": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": 16,
                        },
                        "ocr_text": {"type": ["string", "null"]},
                        "location_hint": {"type": ["string", "null"]},
                        "quality_notes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": 8,
                        },
                    },
                    "required": [
                        "caption",
                        "scene",
                        "activity",
                        "objects",
                        "ocr_text",
                        "location_hint",
                        "quality_notes",
                    ],
                },
            },
        }
    else:
        return None

    if not api_key or not base_url:
        return None

    try:
        response = requests.post(
            openai_endpoint(base_url),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.1,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You index travel photos for OTR. Describe visible content for search. "
                            "Do not identify people by name. Prefer concrete nouns, scene, food, activity, "
                            "place type, and visible text. Return compact valid JSON."
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Index this photo. Avoid generic phrases like 'travel photo'. "
                                    "If there is food, restaurant context, documents, transport, scenery, "
                                    "shopping, hotel, airport, hiking, or group activity, include that explicitly. "
                                    "Return valid JSON with caption, scene, activity, objects, ocr_text, "
                                    "location_hint, and quality_notes."
                                ),
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": image_url, "detail": "low"},
                            },
                        ],
                    },
                ],
                "response_format": response_format,
            },
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            return None
        result = json.loads(content)
        result["model"] = model
        result["provider"] = provider
        return result
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        return None


def clean_tags(items: Any, limit: int = 18) -> list[str]:
    if not isinstance(items, list):
        return []
    cleaned: list[str] = []
    for item in items:
        tag = stringify_model_value(item).strip().lower()
        if tag and tag not in cleaned:
            cleaned.append(tag)
        if len(cleaned) >= limit:
            break
    return cleaned


def stringify_model_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(
            item for item in (stringify_model_value(item) for item in value) if item
        )
    if isinstance(value, dict):
        for key in ("text", "name", "description", "label", "value", "title", "content"):
            nested = stringify_model_value(value.get(key))
            if nested:
                return nested
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value).strip()


def deepseek_text_rewrite(
    *,
    caption: str,
    scene: str | None,
    objects: list[str],
    ocr_text: str | None,
    people_count: int,
    quality: float,
    metadata: ImageMetadata,
) -> dict[str, Any] | None:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return None

    model = os.getenv("DEEPSEEK_MODEL") or "deepseek-chat"
    base_url = os.getenv("DEEPSEEK_BASE_URL") or os.getenv("DEEPSEEK_API_URL") or "https://api.deepseek.com"
    facts = {
        "caption": caption,
        "scene": scene,
        "objects": objects,
        "ocr_text": ocr_text,
        "people_count": people_count,
        "quality_score": quality,
        "metadata": {
            "original_filename": metadata.original_filename,
            "mime_type": metadata.mime_type,
            "width": metadata.width,
            "height": metadata.height,
            "gps_latitude_present": metadata.gps_latitude is not None,
            "gps_longitude_present": metadata.gps_longitude is not None,
            "camera_model": metadata.camera_model,
        },
    }

    try:
        response = requests.post(
            chat_endpoint(base_url),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You rewrite OTR travel image indexes from supplied facts only. "
                            "Do not invent visual details, locations, or people's names. "
                            "Remove generic phrasing such as 'normal travel photo'. "
                            "Return compact JSON with caption, scene, objects, search_tags, "
                            "ocr_text, and quality_notes."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            "Rewrite this image index for search and album grouping. "
                            "Use concrete visible categories from the facts. "
                            "JSON facts:\n"
                            f"{json.dumps(facts, ensure_ascii=False)}"
                        ),
                    },
                ],
                "max_tokens": 500,
            },
            timeout=35,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            return None
        result = json.loads(content)
        result["model"] = model
        result["provider"] = "deepseek"
        return result
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        return None


def rewrite_text_index(
    *,
    caption: str,
    scene: str | None,
    objects: list[str],
    ocr_text: str | None,
    people_count: int,
    quality: float,
    metadata: ImageMetadata,
) -> dict[str, Any] | None:
    if not TEXT_REWRITE_ENABLED:
        return None
    if TEXT_PROVIDER != "deepseek":
        return None
    return deepseek_text_rewrite(
        caption=caption,
        scene=scene,
        objects=objects,
        ocr_text=ocr_text,
        people_count=people_count,
        quality=quality,
        metadata=metadata,
    )


def save_index(request: IndexRequest, result: IndexResponse, authorization: str | None) -> None:
    status = (
        "needs_llm"
        if result.needs_llm_review
        else "indexed_llm"
        if result.model_used != "local"
        else "indexed_local"
    )
    record = {
        "media_asset_id": request.media_asset_id,
        "journey_id": request.journey_id,
        "status": status,
        "caption": result.caption,
        "scene": result.scene,
        "objects": result.objects,
        "people": result.people,
        "ocr_text": result.ocr_text,
        "quality_score": result.quality_score,
        "duplicate_hash": result.duplicate_hash,
        "image_hash": result.image_hash,
        "blur_score": result.blur_score,
        "brightness_score": result.brightness_score,
        "dominant_colors": result.dominant_colors,
        "metadata": request.metadata.model_dump(mode="json"),
        "needs_llm_review": result.needs_llm_review,
        "llm_review_reason": result.llm_review_reason,
        "model_used": result.model_used,
        "model_version": result.model_version,
        "cost_estimate": result.cost_estimate,
        "error_message": None,
    }
    supabase_request(
        "POST",
        "image_index_records?on_conflict=media_asset_id",
        authorization,
        json=record,
        headers={"Prefer": "resolution=merge-duplicates"},
    )
    supabase_request(
        "PATCH",
        f"media_assets?id=eq.{request.media_asset_id}&trip_id=eq.{request.journey_id}",
        authorization,
        json={
            "ai_status": "indexed",
            "ai_metadata": {
                "summary": result.caption,
                "locationHints": [],
                "peopleDescription": f"{len(result.people)} detected face(s)" if result.people else None,
                "objects": result.objects,
                "travelMomentType": result.scene,
                "qualityNotes": [],
                "provider": "otr-ai-server",
                "model": result.model_version,
                "modelUsed": result.model_used,
                "costEstimate": result.cost_estimate,
                "needsLlmReview": result.needs_llm_review,
                "llmReviewReason": result.llm_review_reason,
                "imageHash": result.image_hash,
                "dominantColors": result.dominant_colors,
                "metadata": request.metadata.model_dump(mode="json"),
            },
            "ocr_text": result.ocr_text,
            "scene_tags": [tag for tag in [result.scene, *result.objects] if tag],
            "duplicate_score": None,
            "blur_score": result.blur_score,
            "indexed_at": now_iso(),
        },
    )


def mark_failed(request: IndexRequest, message: str, authorization: str | None) -> None:
    try:
        supabase_request(
            "POST",
            "image_index_records?on_conflict=media_asset_id",
            authorization,
            json={
                "media_asset_id": request.media_asset_id,
                "journey_id": request.journey_id,
                "status": "failed",
                "metadata": request.metadata.model_dump(mode="json"),
                "model_used": "local",
                "model_version": SERVICE_VERSION,
                "error_message": message,
            },
            headers={"Prefer": "resolution=merge-duplicates"},
        )
        supabase_request(
            "PATCH",
            f"media_assets?id=eq.{request.media_asset_id}&trip_id=eq.{request.journey_id}",
            authorization,
            json={
                "ai_status": "failed",
                "ai_metadata": {"error": message, "provider": "otr-ai-server"},
            },
        )
    except Exception:
        pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "image-index-service", "version": SERVICE_VERSION}


@app.post("/image-index/index", response_model=IndexResponse, dependencies=[Depends(require_secret)])
def index_image(
    payload: IndexRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> IndexResponse:
    try:
        _, cv_image, pil_image = fetch_image(payload.image_url)
        image_hash = str(imagehash.phash(pil_image))
        blur = blur_score(cv_image)
        brightness = brightness_score(cv_image)
        colors = dominant_colors(cv_image)
        people = face_service_detect(payload.image_url)
        caption, scene, objects = local_caption(payload.metadata, people, brightness)
        quality = quality_score(blur, brightness)
        should_escalate, review_reason = should_escalate_to_vision(objects, scene, quality)
        model_used = "local"
        model_version = SERVICE_VERSION
        cost_estimate = 0.0
        needs_review = should_escalate

        if should_escalate:
            vision = vision_index(payload.image_url)
            if vision:
                vision_objects = clean_tags(vision.get("objects", []))
                caption = stringify_model_value(vision.get("caption")) or caption
                scene = stringify_model_value(vision.get("scene")) or scene
                objects = sorted(set([*objects, *vision_objects]))
                ocr_text = stringify_model_value(vision.get("ocr_text")) or None
                needs_review = False
                review_reason = None
                model_used = f"{vision.get('provider', VISION_PROVIDER)}_vision"
                model_version = str(vision.get("model") or model_version)
                cost_estimate = 0.001
            else:
                ocr_text = None
        else:
            ocr_text = None

        rewrite = rewrite_text_index(
            caption=caption,
            scene=scene,
            objects=objects,
            ocr_text=ocr_text,
            people_count=len(people),
            quality=quality,
            metadata=payload.metadata,
        )
        if rewrite:
            caption = stringify_model_value(rewrite.get("caption")) or caption
            scene = stringify_model_value(rewrite.get("scene")) or scene
            rewrite_objects = clean_tags(rewrite.get("objects", []))
            search_tags = clean_tags(rewrite.get("search_tags", []))
            objects = sorted(set([*objects, *rewrite_objects, *search_tags]))
            ocr_text = stringify_model_value(rewrite.get("ocr_text")) or ocr_text
            text_model_used = f"{rewrite.get('provider', TEXT_PROVIDER)}_text"
            model_used = f"{model_used}+{text_model_used}" if model_used != "local" else text_model_used
            model_version = f"{model_version}+{rewrite.get('model')}" if rewrite.get("model") else model_version
            cost_estimate = round(cost_estimate + 0.0002, 6)

        result = IndexResponse(
            media_asset_id=payload.media_asset_id,
            status=(
                "needs_llm"
                if needs_review
                else "indexed_llm"
                if model_used != "local"
                else "indexed_local"
            ),
            caption=caption,
            scene=scene,
            objects=objects,
            ocr_text=ocr_text,
            people=people,
            image_hash=image_hash,
            duplicate_hash=image_hash,
            blur_score=blur,
            brightness_score=brightness,
            dominant_colors=colors,
            quality_score=quality,
            needs_llm_review=needs_review,
            llm_review_reason=review_reason,
            model_used=model_used,
            model_version=model_version,
            cost_estimate=cost_estimate,
        )
        save_index(payload, result, authorization)
        return result
    except HTTPException as exc:
        mark_failed(payload, str(exc.detail), authorization)
        raise
    except Exception as exc:
        mark_failed(payload, str(exc), authorization)
        raise HTTPException(status_code=500, detail="Image indexing failed.") from exc


@app.post("/image-index/reindex", response_model=IndexResponse, dependencies=[Depends(require_secret)])
def reindex_image(
    payload: IndexRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> IndexResponse:
    payload.force = True
    return index_image(payload, authorization)


@app.post("/image-index/batch", dependencies=[Depends(require_secret)])
def batch_index(
    payload: BatchIndexRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    results = []
    for item in payload.items:
        try:
            results.append(index_image(item, authorization).model_dump(mode="json"))
        except HTTPException as exc:
            results.append(
                {
                    "media_asset_id": item.media_asset_id,
                    "status": "failed",
                    "error": exc.detail,
                }
            )
    return {"results": results}


@app.post("/image-index/escalate", dependencies=[Depends(require_secret)])
def escalate(
    payload: EscalateRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    supabase_request(
        "PATCH",
        f"image_index_records?media_asset_id=eq.{payload.media_asset_id}&journey_id=eq.{payload.journey_id}",
        authorization,
        json={
            "status": "needs_llm",
            "needs_llm_review": True,
            "llm_review_reason": payload.reason,
        },
    )
    return {"status": "needs_llm", "reason": payload.reason}
