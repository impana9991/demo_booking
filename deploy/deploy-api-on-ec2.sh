#!/usr/bin/env bash
# Build & run partner API on EC2 port 4100 (Core stays on 8000).
set -eu

SSH_PORT="${EC2_SSH_PORT:-22}"
COMPOSE_DIR="${EC2_API_DIR:-/var/www/html/parts_books_api}"
IMAGE_LOCAL="demo-booking-api:local"

KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s\n' "$SSH_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

SSH_BASE=(ssh -i "$KEY_FILE" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null)
RSYNC_SSH="ssh -i ${KEY_FILE} -p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"

echo "Syncing backend → ${USER}@${HOST}:${COMPOSE_DIR}"
"${SSH_BASE[@]}" "${USER}@${HOST}" "sudo mkdir -p '${COMPOSE_DIR}/src' && sudo chown -R ${USER}:${USER} '${COMPOSE_DIR}'"

rsync -az -e "$RSYNC_SSH" \
  --exclude node_modules \
  --exclude .env \
  backend/Dockerfile \
  backend/package.json \
  backend/package-lock.json \
  backend/docker-compose.yml \
  "${USER}@${HOST}:${COMPOSE_DIR}/"

rsync -az -e "$RSYNC_SSH" \
  --exclude node_modules \
  backend/src/ \
  "${USER}@${HOST}:${COMPOSE_DIR}/src/"

"${SSH_BASE[@]}" "${USER}@${HOST}" bash -s <<EOF
set -eu
cd '${COMPOSE_DIR}'
if [ ! -f .env ]; then
  cat > .env <<'ENV'
PORT=4100
STADEPASS_BASE_URL=http://172.17.0.1:8000
STADEPASS_PARTNER_CODE=PARTSBOOKING
STADEPASS_PARTNER_ID=2
STADEPASS_API_KEY=replace_me
STADEPASS_API_SECRET=replace_me
ENV
  echo "Created placeholder ${COMPOSE_DIR}/.env — edit STADEPASS_* for Live"
fi
docker build -t '${IMAGE_LOCAL}' .
export DEMO_BOOKING_IMAGE='${IMAGE_LOCAL}'
export STADEPASS_BASE_URL="\${STADEPASS_BASE_URL:-http://172.17.0.1:8000}"
DEMO_BOOKING_IMAGE='${IMAGE_LOCAL}' docker compose up -d --force-recreate
docker ps --filter name=parts_books_api
curl -sf http://127.0.0.1:4100/api/health || true
EOF

echo "Partner API listening on :4100"
