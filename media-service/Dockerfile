FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8040
ENV MEDIA_ROOT=/var/www/otr-media
ENV MEDIA_PUBLIC_BASE_URL=https://media.xoery.art

WORKDIR /app

COPY requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8040

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8040}"]
