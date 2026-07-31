#!/bin/sh
# Генерирует самоподписанный TLS-сертификат при первом запуске контейнера
# (сертификат живёт в volume ts3web_ssl, поэтому генерируется один раз),
# затем запускает nginx как обычно. Нужен, т.к. Let's Encrypt не выдаёт
# сертификаты на голый IP (см. README.md → "Деплой на прод").
set -e

if [ ! -f /etc/nginx/ssl/ts3web.crt ]; then
  apk add --no-cache openssl
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/ts3web.key \
    -out /etc/nginx/ssl/ts3web.crt \
    -subj "/CN=ts3web"
fi

exec nginx -g "daemon off;"
