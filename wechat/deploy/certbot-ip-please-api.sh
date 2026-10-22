#!/bin/sh
set -eu

# Certbot invokes deploy hooks for every successfully renewed lineage.
# Touch Nginx only for this project's dedicated certificate.
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/ip-please-api|/etc/letsencrypt/live/ip-please-api/)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    ;;
  *) exit 0 ;;
esac
