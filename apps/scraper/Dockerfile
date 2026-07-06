# Build from apps/scraper: docker build .
# Playwright browsers are NOT baked in yet (adds ~800MB) — the scraper is
# still a stub; when Phase D activates it, switch base image to
# mcr.microsoft.com/playwright/python.
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app app
CMD ["python", "-m", "app.worker"]
