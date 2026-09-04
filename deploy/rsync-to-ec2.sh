#!/usr/bin/env bash
# Rsync frontend build to EC2 web root (parts_books) + apply SPA nginx.
set -eu

SSH_PORT="${EC2_SSH_PORT:-22}"
DEST="${DEST:-/var/www/html/parts_books}"
STAGING_DIR="${STAGING_DIR:-ci_deploy_build}"
DOMAIN="${EC2_DOMAIN:-demo.stadepassgn.com}"

KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s\n' "$SSH_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

SSH_BASE=(ssh -i "$KEY_FILE" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null)
RSYNC_SSH="ssh -i ${KEY_FILE} -p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"

echo "Uploading build → ${USER}@${HOST}:${DEST}"
"${SSH_BASE[@]}" "${USER}@${HOST}" "mkdir -p ~/${STAGING_DIR} ~/demo_booking_deploy && sudo mkdir -p '${DEST}'"

rsync -az --delete -e "$RSYNC_SSH" ./build/ "${USER}@${HOST}:~/${STAGING_DIR}/"

rsync -az -e "$RSYNC_SSH" \
  deploy/nginx-demo.stadepassgn.com.conf \
  deploy/apply-spa-on-server.sh \
  "${USER}@${HOST}:~/demo_booking_deploy/"

"${SSH_BASE[@]}" "${USER}@${HOST}" bash -s <<EOF
set -eu
sudo rsync -a --delete ~/${STAGING_DIR}/ '${DEST}/'
sudo chown -R www-data:www-data '${DEST}'
rm -rf ~/${STAGING_DIR}
cd ~/demo_booking_deploy
chmod +x apply-spa-on-server.sh
export EC2_DOMAIN='${DOMAIN}'
export EC2_WEB_ROOT='${DEST}'
sudo bash apply-spa-on-server.sh "\$HOME/demo_booking_deploy/nginx-demo.stadepassgn.com.conf"
EOF

echo "Deployed static site to ${DEST} for ${DOMAIN}"
