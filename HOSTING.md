# Hosting SMKBBSP VisitorPass

How to put this application on the internet. Written for whoever inherits the
project, not just for the FYP demo.

## The short answer

This repo is a **self-contained Docker Compose stack** (`docker-compose.yml`):
application + PostgreSQL + Mailpit + a one-shot migration step. The whole thing
starts with one command:

```bash
docker compose up -d --build
```

That means you do **not** want a serverless host (Vercel, Netlify, Cloudflare
Pages). Those cannot run this compose file, bundle their own Postgres, or keep a
long-lived process. You want **one small Linux server (a VPS / "Droplet") that
runs Docker.**

Card reading does not change that. The vision model runs on a separate machine
the server reaches over a private network - see [Card reading: a model host on
the tailnet](#card-reading-a-model-host-on-the-tailnet) - so the VPS never needs
the RAM to load a model.

**Recommendation: a DigitalOcean Droplet in the Singapore region, 2 GB RAM,
running Docker Compose behind Caddy for HTTPS.** ~USD 12/month.

## DigitalOcean vs IONOS vs the rest

| Host | Fit | Cost/mo | Notes |
|------|-----|---------|-------|
| **DigitalOcean Droplet** (recommended) | Excellent | ~$12 (2 GB) | Singapore region = lowest latency to Malaysia. Best Docker docs, 1-click snapshots, easy backups. The safe default. |
| **IONOS VPS** | Good | ~EUR 2-6 | Cheapest. Full root + Docker works fine. But rougher tooling, fewer tutorials, EU-centric data centres (higher latency). Choose only if budget is the top priority. |
| Hetzner Cloud | Good | ~EUR 4 | Great price/performance, but EU/US regions -> higher latency to Malaysia. |
| DO App Platform / Render / Railway | Awkward | varies | They build from a Dockerfile, but this is a *multi-service compose* stack. You'd have to split out Postgres as a managed add-on and rewire env vars. More work, not less. |
| Vercel + Neon | Needs rework | free tier exists | Would require dropping the compose stack, moving Postgres to Neon, and giving the functions a route onto the tailnet to reach the model host. Only if you specifically want serverless. |
| **Local + Cloudflare Tunnel** | Demo only | free | For a viva/presentation you may not need a paid host at all - see "Cheapest: no server" below. |

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
   site must be served over TLS with a real domain. The setup below uses
   **Caddy**, which fetches and renews Let's Encrypt certificates automatically.

2. **Mailpit does not send real email.** It is a local mail *catcher* - approval
   emails and visitor links only appear in its web UI, they never leave the
   server. That is fine for a demo. For a real deployment, point SMTP at a real
   provider (Brevo, Resend, SendGrid, or even Gmail SMTP). See "Real email".

## Step-by-step: deploy on a Droplet (DigitalOcean or IONOS)

### 1. Create the server

- DigitalOcean: create a Droplet, **Ubuntu 24.04 LTS**, **Singapore**, the
  **2 GB / 1 vCPU** plan (the 1 GB plan is too small for `next build`). Add your
  SSH key. You do not need to size this for the vision model: it runs on the
  model host, not here.
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

MAIL_FROM_NAME=SMKBBSP VisitorPass
MAIL_FROM_ADDRESS=visitorpass@yourschool.edu.my

SEED_ADMIN_PASSWORD=$(openssl rand -base64 12)
SEED_GUARD_PASSWORD=$(openssl rand -base64 12)
SEED_TEACHER_PASSWORD=$(openssl rand -base64 12)
ENV
```

Then run `cat .env`, note the seeded passwords, and keep the file private. Set
`APP_URL` to your real HTTPS domain - QR passes, badge codes, and email links
are all generated from it, so it must be correct.

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
Compose brings up Postgres and Mailpit, runs the migration to completion, writes
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

Do **not** expose Postgres (5432) or Mailpit (8025/1025) to the internet. With
the override above, the app port is no longer public either - only Caddy is.

Do not open 11434 either. The model host is reached over the tailnet, described
next, and that port must never appear in a `ufw allow`.

## Card reading: a model host on the tailnet

Card reading calls a vision model through Ollama. The model does not run on the
VPS and is not expected to: a 2 GB droplet cannot hold one, and paying for a
machine that could would cost more than the rest of the deployment combined.

Instead a laptop at the school runs Ollama, and the VPS reaches it over a
**Tailscale** private network. The photograph travels from the application
server to the laptop inside the tailnet's WireGuard tunnel and no further. It
does not cross the public internet, and it does not reach a third party.

```
  visitor's browser
        |  HTTPS, public internet
        v
  VPS: app container  --- POST /api/ocr
        |  tailnet (WireGuard), private
        v
  laptop: Ollama on 11434, vision model
```

**The rule that matters most: Ollama has no authentication.** There is no
password, no token and no account. Anything that can open a socket to port
11434 can use the model and read whatever is sent to it. The tailnet is not a
convenience here, it is the entire access control. Never publish that port, never
forward it through a router, and never bind it to a public interface.

### 1. Join both machines to one tailnet

Install Tailscale on the laptop and on the VPS, and sign both into the same
account:

```bash
curl -fsSL https://tailscale.com/install.sh | sh && tailscale up
```

Note the laptop's tailnet address - `tailscale ip -4` prints it, and it looks
like `100.x.y.z`.

### 2. Bind Ollama to the tailnet

By default Ollama listens only on `127.0.0.1`, so the VPS cannot reach it. Bind
it to the laptop's tailnet address specifically - **not** `0.0.0.0`, which would
also expose it to whatever café or hotel Wi-Fi the laptop is on:

```bash
OLLAMA_HOST=100.x.y.z:11434 ollama serve
```

On a Windows laptop, set `OLLAMA_HOST` as a system environment variable to the
same value and restart Ollama from the tray.

### 3. Restrict who may reach it

Tailscale's default policy lets every device reach every other one. Narrow it in
the admin console so only the application server may touch the model port:

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:vms-server"], "dst": ["tag:ocr-host:11434"] }
  ]
}
```

Tag the VPS `vms-server` and the laptop `ocr-host`. Without this, any device you
ever add to the tailnet - a phone, a friend's machine - can query the model.

### 4. Point the application at it

In the VPS `.env`:

```bash
OCR_OLLAMA_URL=http://100.x.y.z:11434
OCR_OLLAMA_MODEL=qwen3.5:0.8b
OCR_TIMEOUT_MS=90000
```

Use the **numeric `100.x.y.z` address, not the MagicDNS name.** The app runs in a
container, which resolves names through Docker's DNS rather than the host's, so
a MagicDNS name usually fails to resolve there even though it works fine in the
host's own shell. The numeric address needs no resolution and always works.

The timeout is raised from the local default because the image now crosses a
network, and because a laptop that has not been asked for a while has to load
the model into memory first - the first read after an idle period is much slower
than the ones following it.

Then `docker compose up -d` to restart the app with the new values.

### 5. Verify from inside the container

Not from the VPS shell - the container is what actually makes the call, and it
has its own network namespace:

```bash
docker compose exec app node -e "fetch('http://100.x.y.z:11434/api/tags').then(r=>r.json()).then(d=>console.log(d.models.map(m=>m.name)))"
```

That should print the model list including `qwen3.5:0.8b`. If the VPS shell can
reach the laptop but the container cannot, the problem is Docker networking, not
Tailscale.

### When the laptop is off

This is a normal, handled state rather than an outage. The application detects
that the model host is unreachable, the scan panel reports that card reading is
unavailable, and the form is typed in as it always could be. Nothing queues,
nothing retries in the background, and no visit is blocked. Card reading is
assistance with typing; the system has never depended on it.

Two consequences worth being deliberate about:

- **Availability follows the laptop.** If it is asleep, on another network, or
  simply shut, there is no card reading that day. A school that wants the
  feature reliably needs the machine awake and online during gate hours.
- **The feature can be switched off cleanly.** Leave `OCR_OLLAMA_URL` empty and
  the panel disappears entirely rather than appearing and then failing when
  somebody tries to use it.

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

## Real email (production, not demo)

Mailpit only catches mail locally. To actually deliver approval/visitor emails,
add a real SMTP provider by overriding the app's SMTP env in
`docker-compose.override.yml`. Example with Brevo (free tier ~300 emails/day):

```yaml
services:
  app:
    environment:
      SMTP_HOST: smtp-relay.brevo.com
      SMTP_PORT: 587
      SMTP_SECURE: 'false'
      SMTP_USER: your-brevo-login
      SMTP_PASS: your-brevo-smtp-key
```

Then run `docker compose up -d`. You can drop the `mailpit` service once real
mail works. (Confirm the exact SMTP env var names your `lib` mailer reads before
relying on this.)

## Backups (the Postgres volume is NOT a backup)

The named volume survives `docker compose down`, but it dies with the server.
Take real dumps and copy them off the box:

```bash
docker compose exec -T postgres pg_dump -U visitorpass visitorpass | gzip > backup-$(date +%F).sql.gz
```

Automate it with cron and `scp`/object storage. On DigitalOcean, also enable
Droplet Backups (weekly snapshots) for a whole-server safety net.

## Updating a running deployment

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
