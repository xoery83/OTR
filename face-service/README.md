# OTR Face Service

Small FastAPI service for server-side face detection and embeddings with
InsightFace.

## Local setup

```bash
cd face-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
FACE_SERVICE_SECRET=dev-face-secret uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Then set this in the Next.js app:

```bash
FACE_SERVICE_URL=http://localhost:8001
FACE_SERVICE_SECRET=dev-face-secret
```

The first request downloads the InsightFace model into the local model cache, so
it can take a little while.

## API

`POST /detect`

Headers:

```text
x-face-service-secret: ...
```

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
