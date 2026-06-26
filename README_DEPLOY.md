# OTR AI Server Deployment

Deploy the OTR face-service on a Hetzner VPS running Ubuntu 24.04.

## 1. Install Docker

Install Docker Engine and the Docker Compose plugin on the server before deploying.

## 2. Clone the repo

```bash
sudo mkdir -p /opt/otr
sudo chown "$USER":"$USER" /opt/otr
git clone <repo-url> /opt/otr
cd /opt/otr
```

If the repo is already cloned:

```bash
cd /opt/otr
git pull
```

## 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Set a strong secret:

```bash
FACE_SERVICE_SECRET=replace-with-a-long-random-secret
PORT=8000
INSIGHTFACE_MODEL_NAME=buffalo_l
```

Do not commit `.env`.

## 4. Start the service

```bash
docker compose up -d --build
docker compose ps
```

The first startup can take longer because InsightFace may download the model.

## 5. Test health

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok","model":"buffalo_l"}
```

## 6. Deploy updates

```bash
./deploy.sh
```

`deploy.sh` runs `git pull`, rebuilds and restarts the service, shows compose status,
and prints the last 100 face-service log lines.

## Vercel environment

Set these for the Next.js app:

```bash
AI_SERVER_URL=https://ai.xoery.art
AI_SERVER_SECRET=<same value as /opt/otr/services/image-index-service/.env>
FACE_SERVICE_URL=https://ai.xoery.art
FACE_SERVICE_SECRET=<same value as /opt/otr/services/face-service/.env>
```
