# Deploy: demo.stadepassgn.com → EC2 (no GHCR)

## Why you see "Stadium Ticket API is running (ticket_back_app)"

DNS for `demo.stadepassgn.com` points at the EC2 box, but nginx has **no site** for that host yet, so the **default** server answers — and that default is Core (`ticket_back_app` on :8000).

Fix: add a dedicated nginx `server_name demo.stadepassgn.com` → `/var/www/html/parts_books`.

## One-time on EC2 (SSH in and run)

```bash
cd /tmp
# paste bootstrap-demo-site.sh from this repo, or:
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/deploy/bootstrap-demo-site.sh -o bootstrap-demo-site.sh
sudo bash bootstrap-demo-site.sh
```

Or copy-paste the script from `deploy/bootstrap-demo-site.sh`.

Check:

```bash
curl -sI -H 'Host: demo.stadepassgn.com' http://127.0.0.1/ | head
# should NOT say ticket_back_app
ls /var/www/html/parts_books
sudo nginx -T 2>/dev/null | grep -A2 'server_name demo'
```

## Layout (unchanged apps stay)

| Path / port | App |
|---|---|
| `ticket_front_app` / Core **:8000** | Existing — do not touch |
| `/var/www/html/parts_books` | Demo Booking SPA |
| **:4100** `parts_books_api` | Partner API → Core :8000 |
| `demo.stadepassgn.com` | This SPA + `/api` → :4100 |

## GitHub secrets only (no GHCR)

| Secret | Value |
|---|---|
| `EC2_HOST` | `108.130.89.241` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | PEM private key |
| `EC2_DOMAIN` | `demo.stadepassgn.com` (optional) |
| `EC2_WEB_ROOT` | `/var/www/html/parts_books` (optional) |

Push `main` → build + rsync SPA + docker API on **4100**.
