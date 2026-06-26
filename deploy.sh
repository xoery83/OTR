#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 face-service
