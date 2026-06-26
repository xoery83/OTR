# OTR Face Service

Small FastAPI service for server-side face detection and embeddings with
InsightFace.

## Local setup

```bash
cd face-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
FACE_SERVICE_SECRET=dev-face-secret uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then set this in the Next.js app:

```bash
FACE_SERVICE_URL=http://localhost:8000
FACE_SERVICE_SECRET=dev-face-secret
```

Startup downloads the InsightFace model into the local model cache when needed,
so the first boot can take a little while.

## API

The face model is loaded once during service startup.

### `GET /health`

No secret is required.

### Authenticated endpoints

Headers:

```text
x-face-service-secret: ...
```

### `POST /faces/detect`

Body:

```json
{
  "image_url": "https://signed-image-url"
}
```

Response:

```json
{
  "model_name": "buffalo_l",
  "embedding_version": "insightface-buffalo_l-512",
  "faces": [
    {
      "bounding_box": { "x": 10, "y": 20, "width": 120, "height": 140 },
      "embedding": [0.01, -0.02],
      "confidence": 0.98,
      "quality_score": 0.78
    }
  ]
}
```

### `POST /faces/embed`

Uses the same request and response shape as `/faces/detect`.

### `POST /faces/compare`

Compare two embeddings:

```json
{
  "embedding_a": [0.01, -0.02],
  "embedding_b": [0.03, -0.04],
  "threshold": 0.42
}
```

Or compare the first detected face in two images:

```json
{
  "image_url_a": "https://signed-image-url-a",
  "image_url_b": "https://signed-image-url-b"
}
```

Response:

```json
{
  "model_name": "buffalo_l",
  "embedding_version": "insightface-buffalo_l-512",
  "similarity": 0.73,
  "is_match": true,
  "threshold": 0.42
}
```

### `POST /detect`

Legacy alias for `/faces/detect`.
