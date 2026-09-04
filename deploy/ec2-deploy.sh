#!/usr/bin/env bash
# Called from GitHub Actions. Requires:
#   EC2_HOST, EC2_USER, EC2_SSH_KEY
#   GH_USERNAME, GH_PAT  (git pull on server — optional if only rsyncing build/)
# Optional: EC2_SSH_PORT, EC2_DOMAIN, EC2_WEB_ROOT
set -eu

SSH_PORT="${EC2_SSH_PORT:-22}"
DEST="${EC2_WEB_ROOT:-/var/www/html/parts_books}"
DOMAIN="${EC2_DOMAIN:-demo.stadepassgn.com}"
API_DIR="${EC2_API_DIR:-/var/www/html/parts_books_api}"
REPO_DIR="${EC2_REPO_DIR:-/var/www/html/demo_booking_src}"
STAGING_DIR="${STAGING_DIR:-ci_deploy_build}"
IMAGE_LOCAL="demo-booking-api:local"

# Accept common secret name aliases
GH_USERNAME="${GH_USERNAME:-${GITHUB_USERNAME:-}}"
GH_PAT="${GH_PAT:-${GITHUB_PAT:-${PAT:-}}}"

missing=()
[ -z "${HOST:-}" ] && missing+=("EC2_HOST")
[ -z "${USER:-}" ] && missing+=("EC2_USER")
[ -z "${SSH_KEY:-}" ] && missing+=("EC2_SSH_KEY")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing required GitHub Actions secrets: ${missing[*]}"
  echo "Also set GH_USERNAME + GH_PAT for server git pull (recommended)."
  exit 1
fi

if [ ! -f build/index.html ]; then
  echo "build/index.html missing — CI build step must run first"
  exit 1
fi

KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s\n' "$SSH_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

SSH_BASE=(ssh -i "$KEY_FILE" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null)
RSYNC_SSH="ssh -i ${KEY_FILE} -p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"

echo "==> Ensure remote dirs"
"${SSH_BASE[@]}" "${USER}@${HOST}" "sudo mkdir -p '${DEST}' '${API_DIR}' '${REPO_DIR}' /var/www/certbot ~/demo_booking_deploy && sudo chown -R ${USER}:${USER} '${API_DIR}' '${REPO_DIR}' ~/demo_booking_deploy"

echo "==> Upload SPA build"
"${SSH_BASE[@]}" "${USER}@${HOST}" "mkdir -p ~/${STAGING_DIR}"
rsync -az --delete -e "$RSYNC_SSH" ./build/ "${USER}@${HOST}:~/${STAGING_DIR}/"

echo "==> Upload deploy scripts + backend"
rsync -az -e "$RSYNC_SSH" \
  deploy/apply-spa-on-server.sh \
  deploy/bootstrap-demo-site.sh \
  deploy/nginx-demo.stadepassgn.com.conf \
  "${USER}@${HOST}:~/demo_booking_deploy/"

rsync -az -e "$RSYNC_SSH" \
  --exclude node_modules \
  --exclude .env \
  backend/Dockerfile \
  backend/package.json \
  backend/package-lock.json \
  backend/docker-compose.yml \
  "${USER}@${HOST}:${API_DIR}/"

rsync -az -e "$RSYNC_SSH" \
  --exclude node_modules \
  backend/src/ \
  "${USER}@${HOST}:${API_DIR}/src/"

REPO_SLUG="${GITHUB_REPOSITORY:-impana9991/demo_booking}"

echo "==> Install SPA + HTTPS nginx + API on :4100"
"${SSH_BASE[@]}" "${USER}@${HOST}" \
  DEST="$DEST" DOMAIN="$DOMAIN" API_DIR="$API_DIR" REPO_DIR="$REPO_DIR" \
  STAGING_DIR="$STAGING_DIR" IMAGE_LOCAL="$IMAGE_LOCAL" \
  GH_USERNAME="$GH_USERNAME" GH_PAT="$GH_PAT" REPO_SLUG="$REPO_SLUG" \
  bash -s <<'REMOTE'
set -eu

sudo rsync -a --delete ~/${STAGING_DIR}/ "${DEST}/"
sudo chown -R www-data:www-data "${DEST}"
test -f "${DEST}/index.html"
rm -rf ~/${STAGING_DIR}

# Optional: keep a git checkout on the server with PAT (for debugging / future pulls)
if [ -n "${GH_USERNAME:-}" ] && [ -n "${GH_PAT:-}" ]; then
  echo "Syncing git checkout with GH_PAT…"
  AUTH_URL="https://${GH_USERNAME}:${GH_PAT}@github.com/${REPO_SLUG}.git"
  if [ -d "${REPO_DIR}/.git" ]; then
    git -C "${REPO_DIR}" remote set-url origin "$AUTH_URL"
    git -C "${REPO_DIR}" fetch --depth 1 origin main
    git -C "${REPO_DIR}" reset --hard origin/main
  else
    rm -rf "${REPO_DIR}"
    git clone --depth 1 -b main "$AUTH_URL" "${REPO_DIR}"
  fi
  # scrub token from remote URL after pull
  git -C "${REPO_DIR}" remote set-url origin "https://github.com/${REPO_SLUG}.git"
else
  echo "GH_USERNAME/GH_PAT not set — skipped server git sync (SPA still deployed from Actions artifact)"
fi

cd ~/demo_booking_deploy
chmod +x apply-spa-on-server.sh bootstrap-demo-site.sh
export EC2_DOMAIN="${DOMAIN}"
export EC2_WEB_ROOT="${DEST}"
export EC2_API_PORT=4100
sudo -E bash apply-spa-on-server.sh

cd "${API_DIR}"
if [ ! -f .env ]; then
  cat > .env <<'ENV'
PORT=4100
STADEPASS_BASE_URL=https://book.stadepassgn.com
STADEPASS_PARTNER_CODE=PARTSBOOKING
STADEPASS_PARTNER_ID=2
STADEPASS_API_KEY=replace_me
STADEPASS_API_SECRET=replace_me
ENV
  echo "Created ${API_DIR}/.env — edit STADEPASS_* for Live"
fi

docker build -t "${IMAGE_LOCAL}" .
DEMO_BOOKING_IMAGE="${IMAGE_LOCAL}" docker compose up -d --force-recreate
docker ps --filter name=parts_books_api
curl -sf http://127.0.0.1:4100/api/health || echo "API health check pending"

echo "DONE: https://${DOMAIN} → ${DEST} · /api → :4100"
REMOTE

echo "==> Deploy finished"
