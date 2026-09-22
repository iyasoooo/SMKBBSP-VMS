# Hosting SMKBBSP VisitorPass

How to put this application on the internet. Written for whoever inherits the
project, not just for the FYP demo.

## The short answer

This repo is a **self-contained Docker Compose stack**. Production uses
`docker-compose.dokploy.yml`: the application, PostgreSQL, a one-shot
migration step, and **Ollama with the card-reading model**, all on one VPS.
[Dokploy](https://dokploy.com) runs that file, puts the app behind Traefik with
a Let's Encrypt certificate, and redeploys it from the repository.

That means you do **not** want a serverless host (Vercel, Netlify, Cloudflare
Pages). Those cannot run this compose file, bundle their own Postgres, keep a
long-lived process, or host a model. You want **one Linux server (a VPS) that
runs Docker.**

Card reading decides how big that server must be. The vision model runs on the
same machine as everything else, on CPU, so the server needs the memory to hold
it beside the app and the database. **The school's deployment uses an 8 GB
VPS.** A 2 GB server runs the rest of the system, but not the model - see
[Card reading: Ollama inside the stack](#card-reading-ollama-inside-the-stack).

`docker-compose.yml` is the local development stack. It has no Ollama service;
it expects a model running on the developer's own machine.

## DigitalOcean vs IONOS vs the rest

| Host | Fit | Cost/mo | Notes |
|------|-----|---------|-------|
| **DigitalOcean Droplet** (recommended) | Excellent | ~$12 (2 GB) | Singapore region = lowest latency to Malaysia. Best Docker docs, 1-click snapshots, easy backups. The safe default. |
| **IONOS VPS** | Good | ~EUR 2-6 | Cheapest. Full root + Docker works fine. But rougher tooling, fewer tutorials, EU-centric data centres (higher latency). Choose only if budget is the top priority. |
| Hetzner Cloud | Good | ~EUR 4 | Great price/performance, but EU/US regions -> higher latency to Malaysia. |
| DO App Platform / Render / Railway | Awkward | varies | They build from a Dockerfile, but this is a *multi-service compose* stack. You'd have to split out Postgres as a managed add-on and rewire env vars. More work, not less. |
| Vercel + Neon | Needs rework | free tier exists | Would require dropping the compose stack, moving Postgres to Neon, and running the vision model somewhere the functions can reach privately. Only if you specifically want serverless. |
| **Local + Cloudflare Tunnel** | Demo only | free | For a viva/presentation you may not need a paid host at all - see "Cheapest: no server" below. |

Prices are for the 2 GB tier, which runs everything except card reading. The
8 GB size the deployment uses costs roughly four times as much at each
provider. Dokploy itself is free and self-hosted, and installs on any of them.

### Why not IONOS by default

IONOS is genuinely cheaper and Docker runs fine on it. The downsides for *this*
project: no nearby (SEA) region so the guard tablet feels slower, thinner
documentation when something breaks, and a snapshot/backup workflow that is less
smooth than DigitalOcean's. For an FYP those are minor; for a real school
handover, DO's tooling pays for itself.

## Two things this app forces you to get right

1. **HTTPS is mandatory.** The guard scanner uses the device camera
   (`getUserMedia`), which every browser blocks on plain `http://`. Your
   `next.config.ts` also enables HSTS and secure cookies in production. So the
   site must be served over TLS with a real domain. Dokploy handles this
   with Traefik, which fetches and renews Let's Encrypt certificates
   automatically; the plain-Compose alternative uses **Caddy** for the same job.

2. **There is no email to configure.** The system sends nothing to anyone, so
   there is no mail server, SMTP account or provider to set up. Visitors are
   shown their private link on screen when they submit, and staff are notified
   in-app. See "No email".

## Deploy with Dokploy (how this project is deployed)

### 1. Create the server and install Dokploy

Create a VPS with **Ubuntu 24.04 LTS** and **8 GB RAM**, in a region close to
Malaysia (Singapore is the usual choice), and add your SSH key. Point a domain's
DNS `A` record at its IP (e.g. `vms.yourschool.edu.my`). HTTPS needs a real
domain; a free one such as DuckDNS works for a demo.

Install Dokploy on the server as its documentation describes:

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Then open the Dokploy panel, create its administrator, and secure the panel as
Dokploy's documentation describes.

### 2. Create the Compose service

In Dokploy, create a project and, inside it, a **Compose** service. Connect it
to this repository and set the compose path to `docker-compose.dokploy.yml`.

### 3. Fill the Environment tab

Dokploy writes these into a `.env` beside the compose file. A required key that
is missing fails the deploy with a message naming it, rather than starting the
app with a placeholder.

Required:

| Key | Value |
|-----|-------|
| `APP_DOMAIN` | The bare hostname, e.g. `vms.yourschool.edu.my` |
| `APP_URL` | The full origin, e.g. `https://vms.yourschool.edu.my` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `IDENTITY_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `IDENTITY_HMAC_KEY` | `openssl rand -base64 32` |
| `SEED_ADMIN_PASSWORD`, `SEED_GUARD_PASSWORD`, `SEED_TEACHER_PASSWORD` | `openssl rand -base64 12` each |

Optional: `OCR_OLLAMA_MODEL` (default `qwen3.5:0.8b`), `OCR_TIMEOUT_MS`
(default `120000`), `OCR_OLLAMA_URL` (default `http://ollama:11434`; set it
empty to switch card reading off), `POSTGRES_USER` and `POSTGRES_DB` (both
default `visitorpass`), and `APP_TIMEZONE` (default `Asia/Kuala_Lumpur`).

Get `APP_URL` right: QR passes and visitors' private links are generated from
it. Keep a copy of the two identity keys somewhere other than the server. Every
stored IC number is encrypted and matched with them, so losing them makes those
numbers unreadable and the blacklist unable to match.

### 4. Deploy

Press **Deploy**. Compose brings up Postgres, runs the one-shot `migrate`
service (`prisma migrate deploy`, then `npm run map:sync` to write the school's
floor plan), and starts the app. Alongside it, `ollama` starts and the one-shot
`ollama-pull` service downloads the model into the `ollama_models` volume.

The app does not wait for the model. The download takes several minutes, and
card reading reports itself unavailable until it lands. That is expected, not a
fault. The model is downloaded once; later deploys reuse the volume.

### 5. Create the first accounts

A fresh database has no users. The demonstration seed creates the staff
accounts, visit types and destinations, and it refuses to run under
`NODE_ENV=production` because it also invents visitors and appointments. Run it
once, explicitly, from the VPS shell. Find the app container's name with
`docker ps --format '{{.Names}}'` (it ends in `-app-1`), then:

```bash
docker exec -e NODE_ENV=development YOUR_APP_CONTAINER npm run db:seed
```

Log in at your domain with the admin account (email from the seed output,
password from `SEED_ADMIN_PASSWORD`). **Change that password**, and delete the
demonstration visitors from the admin console before the school starts using
the system for real.

### 6. Lock down the firewall

Allow only SSH and web traffic:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Postgres (5432) and Ollama (11434) are never published by this compose file, so
they are unreachable from the internet whatever the firewall says. Keep it that
way: never add a `ports:` entry or Traefik labels to either service.

## Card reading: Ollama inside the stack

Card reading calls a vision model through Ollama. In production the model runs
**on the same VPS as the application**, as the `ollama` service in
`docker-compose.dokploy.yml`:

```
  visitor's or guard's browser
        |  HTTPS, public internet
        v
  Traefik (Dokploy) --> app container --- POST /api/ocr
                              |  Docker network "internal", never published
                              v
                        ollama container: vision model on CPU
```

The browser never talks to Ollama. It posts the photograph to the app's own
`/api/ocr`, and the app calls `http://ollama:11434` across the stack's private
Docker network. The photograph does not leave the server and does not reach a
third party. It is held for that one request and never written to disk.

**The rule that matters most: Ollama has no authentication.** There is no
password, no token and no account. Anything that can open a socket to port
11434 can use the model and read whatever is sent to it. Here, only another
container on the `internal` network can, because the `ollama` service has no
`ports:` entry and no Traefik labels. Never add either. A published port or a
domain would put an unauthenticated model, and every card sent to it, on the
internet.

### The model

`ollama-pull` fetches `OCR_OLLAMA_MODEL` (default `qwen3.5:0.8b`) on deploy.
`ollama` is installed only inside the container, not on the VPS, so to check
what is installed or to pull by hand, go through Docker:

```bash
docker exec -it "$(docker ps --filter name=ollama --format '{{.Names}}' | head -1)" ollama list
```

The application checks the installed models and refuses a name it does not
find, so a typo shows as "card reading unavailable" rather than a different
model being used.

### What running it on the VPS costs

- **Memory.** The model has to fit beside the app and Postgres. This is why the
  deployment uses an 8 GB server rather than 2 GB.
- **Speed.** There is no GPU, so the model runs on CPU and a read takes far
  longer than on a GPU machine. `OCR_TIMEOUT_MS` defaults to 120 seconds for
  that reason. The first read after an idle period is slower again, while
  Ollama loads the model back into memory.
- **Shared processor.** A read keeps the CPU busy while it runs, and the gate
  screens are served by the same machine. Card reading is therefore
  rate-limited to ten reads per ten minutes per client.

In return, card reading is available whenever the rest of the system is, with
no second machine to keep switched on.

### When the model is not answering

This is a normal, handled state rather than an outage. If Ollama is down or the
model is missing, the scan panel reports that card reading is unavailable and
the form is typed in, as it always could be. Nothing queues, nothing retries in
the background, and no visit is blocked. In Compose, the app deliberately does
not depend on the `ollama` service, so a model that fails to start cannot take
the gate down with it.

To switch the feature off entirely, set `OCR_OLLAMA_URL` to empty in the
Environment tab and redeploy. The scan panel then disappears instead of
appearing and failing when somebody tries to use it.

### Never point this at a hosted model

An Ollama install can carry cloud-routed tags, which proxy to ollama.com.
Ollama publishes them with a `-cloud` suffix — `gpt-oss:120b-cloud` — and the
bare `:cloud` form appears too. Pointing `OCR_OLLAMA_MODEL` at either would send
a photograph of a child's parent's identity card to a third-party company.

This is now refused rather than merely discouraged:

- **The application will not start.** `isCloudRoutedModel` in `lib/env.ts`
  rejects both spellings during environment validation, naming the risk in the
  error. A typo is a boot failure, not a quiet leak.
- **The production stack will not download one.** The `ollama-pull` service in
  `docker-compose.dokploy.yml` refuses a cloud tag before pulling it.
- **A loose name still cannot drift.** `lib/ocr/ollama.ts` checks the host's
  installed model list and refuses a name it does not find. Note that this
  check alone cannot catch a cloud tag — it is installed on the host, so it
  passes — which is precisely why the startup guard exists.

Keep it a local tag.

## Alternative: plain Docker Compose behind Caddy

Without Dokploy, the same kind of server can run the stack by hand. This path
uses `docker-compose.yml`, which has **no Ollama service**, so card reading is
unavailable on it and the form is typed in. For card reading, use the Dokploy
stack above, or copy its `ollama` and `ollama-pull` services across and point
`OCR_OLLAMA_URL` at `http://ollama:11434`.

### 1. Create the server

- DigitalOcean: create a Droplet, **Ubuntu 24.04 LTS**, **Singapore**, the
  **2 GB / 1 vCPU** plan (the 1 GB plan is too small for `next build`). Add your
  SSH key. 2 GB is enough because this path runs no model.
- IONOS: create a **VPS** (at least 2 GB RAM), Ubuntu 24.04, add your SSH key.

Point a domain's DNS `A` record at the server's IP (e.g. `vms.yourschool.edu.my`).
You need a domain for HTTPS - a free one (e.g. DuckDNS) works for a demo.

### 2. Install Docker on the server

```bash
curl -fsSL https://get.docker.com | sh
```

Run that after `ssh root@YOUR_SERVER_IP`.

### 3. Get the code onto the server

```bash
git clone YOUR_REPO_URL smkbbsp-vms
```

Then `cd smkbbsp-vms`.

### 4. Create the `.env` file (secrets are never baked into the image)

Generate strong secrets and write them into `.env`. Run this on the server:

```bash
cat > .env <<ENV
POSTGRES_USER=visitorpass
POSTGRES_PASSWORD=$(openssl rand -base64 24)
POSTGRES_DB=visitorpass

APP_URL=https://vms.yourschool.edu.my
APP_TIMEZONE=Asia/Kuala_Lumpur

SESSION_SECRET=$(openssl rand -base64 32)
IDENTITY_ENCRYPTION_KEY=$(openssl rand -base64 32)
IDENTITY_HMAC_KEY=$(openssl rand -base64 32)
IDENTITY_KEY_VERSION=1

SEED_ADMIN_PASSWORD=$(openssl rand -base64 12)
SEED_GUARD_PASSWORD=$(openssl rand -base64 12)
SEED_TEACHER_PASSWORD=$(openssl rand -base64 12)
ENV
```

Then run `cat .env`, note the seeded passwords, and keep the file private. Set
`APP_URL` to your real HTTPS domain - QR passes and visitors' private links
are generated from it, so it must be correct.

### 5. Add HTTPS with Caddy

Create a `Caddyfile` (replace the domain):

```bash
cat > Caddyfile <<CADDY
vms.yourschool.edu.my {
    reverse_proxy app:3000
}
CADDY
```

Create `docker-compose.override.yml` - Compose merges it automatically, so you
never edit the original file. This adds Caddy and stops exposing the app port
directly to the internet:

```bash
cat > docker-compose.override.yml <<OVR
services:
  app:
    ports: []
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
OVR
```

The `ports: []` on `app` removes its public `3000` mapping; only Caddy stays
public and reaches the app over Compose's internal network.

### 6. Start everything

```bash
docker compose up -d --build
```

Follow the logs with `docker compose logs -f app` (Ctrl-C to stop watching).
Compose brings up Postgres, runs the migration to completion, writes
the school map, then starts the app. Caddy gets a TLS certificate on first
request.

The one-shot `migrate` container does two things, in order:

1. `prisma migrate deploy` - creates and updates the tables.
2. `npm run map:sync` - writes the school map into them.

The second step exists because migrations create the map's tables but do not
fill them, and the map is the school's own floor plan rather than invented
data, so it belongs in production. It is safe to re-run and is idempotent.

### 6a. Create the first accounts

A fresh database has no users, so there is nobody to log in as. The
demonstration seed creates the staff accounts, visit types and the curated
destinations, and it deliberately refuses to run against `NODE_ENV=production`
because it also invents visitors and appointments. Run it once, explicitly:

```bash
docker compose run --rm -e NODE_ENV=development migrate npm run db:seed
```

Then visit `https://vms.yourschool.edu.my` and log in with the admin account
(email from the seed output, password from step 4). **Change that password**,
and delete the demonstration visitors from the admin console before the school
starts using the system for real.

### 7. Lock down the firewall

Allow only SSH and web:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Do **not** expose Postgres (5432) to the internet. With
the override above, the app port is no longer public either - only Caddy is.

Do not open 11434 either, on this or any other path. Ollama has no
authentication, and that port must never appear in a `ufw allow`.

## No email

The system sends no email, by design, so there is nothing to configure: no mail
server, no SMTP account, no provider. When a visitor submits a request they are
taken to their private page and told to save the link; that link later becomes
their QR pass. Staff are notified in-app.

This makes a deployment simpler, but it moves one job onto the school office:
**a visitor who loses their link before approval cannot get it back.** They
resubmit, or the guard registers them as a walk-in. Once a visit is approved, an
administrator can open the appointment, choose **Replace with a new pass**, and
hand the new link over in person (the visitor can scan the QR shown on screen).

**Upgrading a deployment that had email.** Any `SMTP_*` or `MAIL_FROM_*`
variables left in the Dokploy Environment tab are now ignored and can be
deleted. The Mailpit service is gone from both compose files; an existing
Mailpit container is left running by a plain redeploy, so remove it with:

```bash
docker compose up -d --remove-orphans
```

Old email rows in the notifications table are kept as history and never shown.

## Backups (the Postgres volume is NOT a backup)

The named volume survives `docker compose down`, but it dies with the server.
Take real dumps and copy them off the box:

```bash
docker compose exec -T postgres pg_dump -U visitorpass visitorpass | gzip > backup-$(date +%F).sql.gz
```

On Dokploy, run it with `docker exec -i` against the Postgres container instead
(its name, ending in `-postgres-1`, is in `docker ps`).

Automate it with cron and `scp`/object storage. On DigitalOcean, also enable
Droplet Backups (weekly snapshots) for a whole-server safety net.

## Updating a running deployment

On Dokploy, press **Deploy** again, or turn on its auto-deploy so a push to the
branch redeploys. By hand:

```bash
git pull && docker compose up -d --build
```

The migrate step re-runs automatically; only new migrations apply.

## Cheapest option: no server (demo only)

For a viva/presentation, run the stack on your own laptop and expose it
temporarily with a free Cloudflare Tunnel - you get HTTPS and a public URL
without paying for hosting:

```bash
cloudflared tunnel --url http://localhost:3000
```

Run that (after `docker compose up -d --build` and installing `cloudflared`) in
a second terminal. Set `APP_URL` in `.env` to the URL the tunnel prints, then
restart the app container. Good for a live demo; not for a real, always-on
deployment.
