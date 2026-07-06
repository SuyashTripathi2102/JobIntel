# Deploying CareerOS to a VPS

Target: one small VPS (~$5/mo — Hetzner CX22 or DigitalOcean basic droplet, 2GB RAM min),
running the whole stack via `compose.prod.yml`. Once this is live, CareerOS hunts 24/7.

## 1. Provision

- Ubuntu 24.04 LTS, 2GB+ RAM, any region (Falkenstein/Bangalore — latency is irrelevant,
  crawling is outbound).
- Add your SSH key at creation. Log in: `ssh root@<ip>`.

## 2. Base setup (once)

```bash
apt update && apt upgrade -y
# Docker (official convenience script)
curl -fsSL https://get.docker.com | sh
# Firewall: SSH + the API port (or only SSH if you'll tunnel)
ufw allow OpenSSH && ufw allow 3001/tcp && ufw enable
```

## 3. Deploy

```bash
git clone https://github.com/SuyashTripathi2102/CareerOS.git
cd CareerOS
cp .env.prod.example .env.prod
nano .env.prod        # fill every blank — generators are in the comments
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

First boot: API container runs `prisma migrate deploy` automatically, MinIO bucket is
auto-created, workers register the schedulers (15-min crawl tick, 10-min discovery tick,
24h boards). Seed and go:

```bash
# register your user + upload resume via the API, then:
curl -X POST http://<ip>:3001/api/crawl/seed -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"source":"yc","limit":500}'
```

## 4. Verify

```bash
curl http://<ip>:3001/api/health              # liveness
curl -H "Authorization: Bearer <token>" http://<ip>:3001/api/admin/health | jq
#   -> companies funnel, queue depths, 24h crawl success rate, failing companies
docker compose -f compose.prod.yml logs -f workers   # watch it hunt
```

## 5. Updates

```bash
cd CareerOS && git pull
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

## 6. Backups (the only data that matters is Postgres)

```bash
# nightly cron: crontab -e
0 3 * * * docker exec careeros-prod-postgres-1 pg_dump -U careeros careeros | gzip > /root/backups/careeros-$(date +\%u).sql.gz
```

Seven rotating daily dumps; MinIO holds only resume PDFs (re-uploadable), Redis holds only
queue state (rebuilds itself).

## 7. Costs & notes

- VPS ~$5/mo. Everything else $0 at current scale (Gemini free tier handles daily increments;
  consider paid tier ~$1-2/mo to eliminate 429 grinding on bulk operations).
- The API is plain HTTP on :3001 — fine for personal use behind a firewall; add Caddy
  (auto-HTTPS) in front when the web dashboard ships (Phase F).
- Telegram works from anywhere — set TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in `.env.prod` and
  restart the api container.
