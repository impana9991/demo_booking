#!/usr/bin/env bash
# Run ON the EC2 box (once) so demo.stadepassgn.com is NOT the default ticket_back_app.
# Usage:
#   sudo bash bootstrap-demo-site.sh
set -eu

DOMAIN="demo.stadepassgn.com"
WEB_ROOT="/var/www/html/parts_books"
API_PORT="4100"
CONF="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

mkdir -p "$WEB_ROOT"

# Placeholder until CI rsyncs the real SPA (so you don't see Core's default page)
if [ ! -f "$WEB_ROOT/index.html" ]; then
  cat > "$WEB_ROOT/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Demo Booking</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem; color: #122018; background: #f3f7f4; }
    a { color: #0f6b4c; }
  </style>
</head>
<body>
  <h1>Demo Booking</h1>
  <p>Site is wired. Deploy the frontend build (GitHub Actions) to replace this page.</p>
</body>
</html>
HTML
fi

chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true

cat > "$CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    root ${WEB_ROOT};
    index index.html;

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
}
EOF

ln -sfn "$CONF" "$ENABLED"

# Make sure this host is NOT served by the default / Core catch-all
# (common cause of "Stadium Ticket API is running")
if [ -f /etc/nginx/sites-enabled/default ]; then
  echo "Note: /etc/nginx/sites-enabled/default exists — ${DOMAIN} has its own server_name so it should win."
fi

nginx -t
systemctl reload nginx

echo ""
echo "OK: http://${DOMAIN} → ${WEB_ROOT}"
echo "    /api → 127.0.0.1:${API_PORT} (partner API; Core stays on :8000)"
echo "Next: put STADEPASS_* in /var/www/html/parts_books_api/.env and run CI deploy."
