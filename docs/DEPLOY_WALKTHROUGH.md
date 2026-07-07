# VPS Deployment Walkthrough — annotated, as it actually happened

*2026-07-07. CareerOS's first production deployment: DigitalOcean droplet, Ubuntu 24.04,
1 vCPU / 2GB RAM / 50GB SSD, Bangalore region. This is the STUDY version — every step with the
why, the real outputs, and the two bugs we hit live. The terse repeatable version is
[DEPLOY.md](DEPLOY.md).*

## Phase 1 — Base system (steps 1-4)

### 1. Connect
```bash
ssh root@<ip>
hostname && free -h        # verify right box + see actual RAM
```
First connection asks to trust the host fingerprint (`yes`). Our box: 1.9Gi RAM, no swap.

### 2. Update everything
```bash
apt update && apt upgrade -y
```
**Why first:** a fresh droplet image is weeks old; you want current security patches *before*
exposing services. **What we saw:** a pending kernel upgrade (6.8.0-124 → 134) — Ubuntu
installs the new kernel but keeps running the old one until reboot.

### 3. Reboot onto the new kernel
```bash
reboot
# ...reconnect after ~45s
uname -r && uptime          # expect the new kernel version
```
**Why now:** reboot while nothing is deployed — it's free. Later it costs downtime.

### 4. Swap (the 2GB-box lifesaver)
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab          # survive reboots
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-careeros.conf
free -h && swapon --show    # validate: Swap: 2.0Gi
```
**Why:** Docker builds (`npm ci` + `tsc`) briefly need more RAM than the box has. Without swap
the kernel OOM-kills the build; with swap it just runs slower for a minute. `swappiness=10`
means "swap only under real pressure" — don't trade RAM for disk eagerly.

## Phase 2 — Docker + hardening (steps 5-9)

### 5. Docker
```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version && systemctl is-enabled docker   # expect: enabled
```

### 6. Log rotation (daemon-wide)
```bash
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
systemctl restart docker
docker info --format '{{.LoggingDriver}}'   # expect: json-file
```
**Why:** a chatty container can fill a 50GB disk with logs in weeks. 30MB cap per container,
forever. (compose.prod.yml ALSO sets this per-service — belt and braces.)

### 7. Firewall
```bash
ufw allow OpenSSH && ufw allow 3001/tcp && ufw --force enable && ufw status verbose
```
**The rule order matters:** allow SSH *before* enable, or you lock yourself out of the box.
**Honest footnote:** Docker's published ports bypass UFW (it writes iptables directly) — UFW
here protects the HOST (ssh, stray services). Our containers only publish 3001 by design;
Postgres/Redis/MinIO have no `ports:` and are unreachable from the internet.

### 8. Fail2Ban
```bash
apt install fail2ban -y
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban && fail2ban-client status sshd
```
**`backend = systemd` matters on Ubuntu 24.04** — sshd logs to the journal, not the old
auth.log. **What we saw:** within MINUTES of the droplet existing, 11 failed root-login
attempts and 2 IPs already banned. That's the internet's background radiation; every public
IPv4 is under constant credential-stuffing. This is why steps 7-8 aren't optional.

### 9. Automatic security updates
```bash
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades
unattended-upgrade --dry-run --debug 2>&1 | tail -3    # proves the machinery works
```

## Phase 3 — Deploy CareerOS (steps 10-12)

### 10. Clone
```bash
git clone https://github.com/SuyashTripathi2102/JobIntel.git careeros && cd careeros
git log --oneline -1        # verify you're on the expected commit
```

### 11. Secrets
```bash
cat > .env.prod <<EOF
POSTGRES_USER=careeros
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=careeros
S3_ACCESS_KEY=careeros
S3_SECRET_KEY=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
INTERNAL_API_TOKEN=$(openssl rand -hex 32)
GEMINI_API_KEY=PASTE_ME
TELEGRAM_BOT_TOKEN=PASTE_ME
TELEGRAM_CHAT_ID=<your chat id>
NOTIFY_MIN_SCORE=70
CORS_ORIGIN=http://localhost:3000
EOF
chmod 600 .env.prod
nano .env.prod              # replace the two PASTE_ME values
grep -c PASTE_ME .env.prod  # validate: 0
```
**Pattern:** machine-generated secrets inline via `openssl rand`; human-owned keys pasted by
hand; file mode 600; never committed (gitignored).

### 12. Build + launch
```bash
# build one image at a time on 1 vCPU (parallel default doubles the memory/CPU pressure)
docker compose -f compose.prod.yml --env-file .env.prod build api
docker compose -f compose.prod.yml --env-file .env.prod build workers
docker compose -f compose.prod.yml --env-file .env.prod up -d
sleep 25
docker compose -f compose.prod.yml --env-file .env.prod ps
curl -s http://localhost:3001/api/health    # expect {"status":"ok",...}
```
**Gotcha that bit us:** `--env-file .env.prod` is needed on EVERY compose invocation — even
`ps` and `logs` — because compose re-interpolates the file each time and the `:?` guards fail
without it. (Alternative: `export COMPOSE_ENV_FILES=.env.prod` once per session.)

## The two real bugs (and what they teach)

**Bug 1 — `prisma generate` demanded DATABASE_URL at build time.**
`prisma.config.ts` used `env("DATABASE_URL")`, which throws when unset. Locally it always
worked because `.env` sat next to it — the Docker builder (correctly) has no secrets.
*Fix:* fall back to a dummy URL for config loading; anything touching a real DB gets the real
URL from runtime env. *Lesson:* *"works locally" often means "accidentally depends on local
state" — clean-room builds are how you find out.*

**Bug 2 — workers crashed with `Cannot find module 'ioredis'`.**
npm workspaces HOIST most deps to the root `node_modules`, but exact-version pins that
conflict with another workspace's resolution get NESTED under `apps/workers/node_modules`.
The Dockerfile copied only the root. *Fix:* also copy the workspace-nested node_modules.
*Lesson:* monorepo runtime images must ship BOTH layers of node_modules; whether a dep hoists
is an npm implementation detail you don't control.

## Post-deploy (steps 13-14)

### 13. First-boot data
The prod database starts empty. In order: register user → upload resume (from the machine
that has the PDF, against the public API) → `POST /crawl/seed {source:'yc', limit:...}` →
schedulers take over forever.

### 14. Verify + observe
```bash
curl -s -H "Authorization: Bearer <token>" http://<ip>:3001/api/admin/health
docker stats --no-stream       # real memory per container
docker compose -f compose.prod.yml --env-file .env.prod logs -f workers   # watch it hunt
```

## Update procedure (forever after)

```bash
cd ~/careeros && git pull
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

## Backups

```bash
mkdir -p /root/backups
crontab -e   # add:
0 3 * * * docker exec careeros-prod-postgres-1 pg_dump -U careeros careeros | gzip > /root/backups/careeros-$(date +\%u).sql.gz
```
Seven rotating daily dumps. Postgres is the only irreplaceable data — Redis rebuilds itself,
MinIO holds re-uploadable PDFs.
