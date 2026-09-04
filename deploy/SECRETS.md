# GitHub Actions secrets (Settings → Secrets and variables → Actions)

## Required (deploy will fail without these)

| Secret | Example |
|--------|---------|
| `EC2_HOST` | `108.130.89.241` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Full private key PEM (`-----BEGIN … KEY-----` …) |
| `GH_USERNAME` | `impana9991` |
| `GH_PAT` | Classic PAT with **repo** scope |

`GH_USERNAME` + `GH_PAT` are used to sync the repo on the server.  
`EC2_*` is how Actions SSHs into the box (PAT alone cannot replace SSH).

## Optional

| Secret | Default |
|--------|---------|
| `EC2_DOMAIN` | `demo.stadepassgn.com` |
| `EC2_WEB_ROOT` | `/var/www/html/parts_books` |
| `EC2_SSH_PORT` | `22` |
| `GITHUB_PAT` | alias for `GH_PAT` |

## Server env (manual, once)

`/var/www/html/parts_books_api/.env`:

```env
PORT=4100
STADEPASS_BASE_URL=https://book.stadepassgn.com
STADEPASS_PARTNER_CODE=PARTSBOOKING
STADEPASS_PARTNER_ID=2
STADEPASS_API_KEY=spk_...
STADEPASS_API_SECRET=sps_...
STADEPASS_EVENT_ACCESS_CODE=...
```

## After secrets are saved

1. Actions → **CI and deploy** → Run workflow  
   or push to `main`
2. Cloudflare SSL for `demo` = **Full**
3. Open https://demo.stadepassgn.com — must show **Demo Booking**, not `ticket_back_app`
