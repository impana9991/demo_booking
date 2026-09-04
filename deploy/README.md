# Deploy: demo.stadepassgn.com

See **[SECRETS.md](./SECRETS.md)** for the exact GitHub Actions secret names (`EC2_*` + `GH_USERNAME` + `GH_PAT`).

Push / workflow_dispatch runs `deploy/ec2-deploy.sh`:

1. Upload SPA → `/var/www/html/parts_books`
2. nginx **HTTPS** for `demo.stadepassgn.com` (certbot) — blocks fallthrough to `ticket_back_app`
3. Optional git sync on server via `GH_PAT`
4. Docker partner API on **:4100** (`/api` only — Core stays on **:8000**)
