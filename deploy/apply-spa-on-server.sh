#!/usr/bin/env bash
# Apply SPA nginx site for demo.stadepassgn.com → /var/www/html/parts_books
set -eu

DOMAIN="${EC2_DOMAIN:-demo.stadepassgn.com}"
WEB_ROOT="${EC2_WEB_ROOT:-/var/www/html/parts_books}"
CONF_SRC="${1:-deploy/nginx-demo.stadepassgn.com.conf}"
CONF_NAME="demo.stadepassgn.com"
AVAILABLE="/etc/nginx/sites-available/${CONF_NAME}"
ENABLED="/etc/nginx/sites-enabled/${CONF_NAME}"

sudo mkdir -p "$WEB_ROOT"
sudo chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true

if [ -f "$CONF_SRC" ]; then
  sudo cp "$CONF_SRC" "$AVAILABLE"
else
  echo "Missing nginx conf: $CONF_SRC" >&2
  exit 1
fi

# Ensure root + server_name match secrets/env
sudo sed -i "s|server_name .*;|server_name ${DOMAIN};|" "$AVAILABLE"
sudo sed -i "s|root .*;|root ${WEB_ROOT};|" "$AVAILABLE"

sudo ln -sfn "$AVAILABLE" "$ENABLED"
sudo nginx -t
sudo systemctl reload nginx
echo "Nginx SPA ready for https://${DOMAIN} → ${WEB_ROOT} (API proxy :4100)"
