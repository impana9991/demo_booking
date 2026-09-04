# Deploy: demo.stadepassgn.com → EC2 (no GHCR)

Push to `main` will:

1. Build the Vite SPA  
2. Rsync to `/var/www/html/parts_books`  
3. Install nginx **HTTPS** for `demo.stadepassgn.com` (certbot) so Cloudflare does **not** fall through to `ticket_back_app`  
4. Build/run partner API on **:4100** (`/api` → 4100 only, never :8000)

## GitHub secrets

| Secret | Value |
|---|---|
| `EC2_HOST` | `108.130.89.241` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | PEM private key |
| `EC2_DOMAIN` | `demo.stadepassgn.com` (optional) |
| `EC2_WEB_ROOT` | `/var/www/html/parts_books` (optional) |

## Server `.env` (once, manual)

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

## Cloudflare

SSL/TLS for `demo` = **Full** (certbot creates the origin cert on deploy).

## Manual fix (if needed before first push)

```bash
cd /path/to/repo/deploy
sudo bash bootstrap-demo-site.sh
```
