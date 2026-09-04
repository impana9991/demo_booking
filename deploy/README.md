# Deploy: demo.stadepassgn.com → EC2

## Layout on the server (does not touch existing apps)

| Path / port | App |
|---|---|
| `/var/www/html/ticket_front_app` | Existing office frontend |
| `/var/www/html/ticket_back_app` + **:8000** | StadePass Core |
| `/var/www/html/parts_books` | **This** Demo Booking SPA |
| **:4100** (`parts_books_api`) | **This** partner API → proxies to Core :8000 |
| `demo.stadepassgn.com` | DNS A → EC2 (already set) |

## One-time on EC2

```bash
sudo mkdir -p /var/www/html/parts_books /var/www/html/parts_books_api
sudo chown -R ubuntu:ubuntu /var/www/html/parts_books_api

# Partner secrets (Live mode). Never commit this file.
nano /var/www/html/parts_books_api/.env
# copy from backend/.env.example — set STADEPASS_* and PORT=4100
# STADEPASS_BASE_URL=http://172.17.0.1:8000
```

Optional TLS after first HTTP deploy:

```bash
sudo certbot --nginx -d demo.stadepassgn.com
```

## GitHub Actions secrets

| Secret | Example |
|---|---|
| `EC2_HOST` | `108.130.89.241` (or public DNS) |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | private key PEM |
| `EC2_SSH_PORT` | `22` (optional) |
| `EC2_DOMAIN` | `demo.stadepassgn.com` |
| `EC2_WEB_ROOT` | `/var/www/html/parts_books` |

Push to `main` (or run **CI and deploy**) builds the Vite app, rsyncs to `parts_books`, reloads nginx SPA, and updates the API container on **4100**.
