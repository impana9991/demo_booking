#!/usr/bin/env bash
# One-shot on EC2 if CI secrets are not ready yet.
#   sudo bash bootstrap-demo-site.sh
set -eu
export EC2_DOMAIN="${EC2_DOMAIN:-demo.stadepassgn.com}"
export EC2_WEB_ROOT="${EC2_WEB_ROOT:-/var/www/html/parts_books}"
export EC2_API_PORT="${EC2_API_PORT:-4100}"
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/apply-spa-on-server.sh"
