#!/usr/bin/env bash
# Install / refresh nginx for demo.stadepassgn.com → SPA at parts_books
# Ensures HTTPS so Cloudflare does NOT fall through to ticket_back_app (:8000).
set -eu

DOMAIN="${EC2_DOMAIN:-demo.stadepassgn.com}"
WEB_ROOT="${EC2_WEB_ROOT:-/var/www/html/parts_books}"
API_PORT="${EC2_API_PORT:-4100}"
CONF_NAME="${DOMAIN}"
AVAILABLE="/etc/nginx/sites-available/${CONF_NAME}"
ENABLED="/etc/nginx/sites-enabled/${CONF_NAME}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

mkdir -p "$WEB_ROOT" /var/www/certbot
chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true

if [ ! -f "$WEB_ROOT/index.html" ]; then
  cat > "$WEB_ROOT/index.html" <<'HTML'
<!DOCTYPE html><html><body><h1>Demo Booking</h1><p>Waiting for deploy…</p></body></html>
HTML
fi

write_http_only() {
  cat > "$AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
}

write_full_ssl() {
  cat > "$AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root ${WEB_ROOT};
    index index.html;

    # Partner Demo Booking API only — NEVER :8000 / ticket_back_app
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }
}
EOF
}

# Remove any old broken demo symlink/conf that proxies to Core
rm -f /etc/nginx/sites-enabled/demo.stadepassgn.com
rm -f /etc/nginx/sites-enabled/${DOMAIN}

if [ -d "$CERT_DIR" ] && [ -f "$CERT_DIR/fullchain.pem" ]; then
  echo "TLS cert exists for ${DOMAIN} — writing full SSL SPA config"
  write_full_ssl
else
  echo "No TLS cert yet — writing HTTP redirect, then certbot"
  write_http_only
  ln -sfn "$AVAILABLE" "$ENABLED"
  nginx -t
  systemctl reload nginx

  if command -v certbot >/dev/null 2>&1; then
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email \
      || certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
           --register-unsafely-without-email --redirect || true
  else
    echo "WARNING: certbot not installed — HTTPS will fail under Cloudflare Full SSL"
  fi

  if [ -d "$CERT_DIR" ] && [ -f "$CERT_DIR/fullchain.pem" ]; then
    write_full_ssl
  else
    # Fallback: serve SPA on :80 only (Cloudflare Flexible) so site is not Core
    cat > "$AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    root ${WEB_ROOT};
    index index.html;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
  fi
fi

ln -sfn "$AVAILABLE" "$ENABLED"
nginx -t
systemctl reload nginx

echo "---- verify (must NOT contain ticket_back_app) ----"
BODY="$(curl -sk --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/" 2>/dev/null || true)"
if [ -z "$BODY" ]; then
  BODY="$(curl -s --resolve "${DOMAIN}:80:127.0.0.1" -H "Host: ${DOMAIN}" "http://127.0.0.1/" 2>/dev/null || true)"
fi
echo "$BODY" | head -5
if echo "$BODY" | grep -qi "ticket_back_app"; then
  echo "ERROR: still serving Core for ${DOMAIN}" >&2
  exit 1
fi
if ! echo "$BODY" | grep -qiE "Demo Booking|root|/assets/|<!DOCTYPE html>"; then
  echo "WARNING: unexpected body for ${DOMAIN} — check ${WEB_ROOT}/index.html" >&2
fi

echo "OK: https://${DOMAIN} → ${WEB_ROOT} · /api → :${API_PORT}"
