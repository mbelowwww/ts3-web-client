# Деплой ts3web на прод-сервер

Всё — TS3-сервер, гейтвей и nginx с TLS — поднимается **одной командой**
через `docker-compose.prod.yml`. Сценарий: чистый Linux-сервер с Docker,
доступ по SSH root/sudo, **своего домена нет — только IP** (поэтому TLS —
самоподписанный сертификат, генерируется автоматически при первом запуске
контейнера nginx, без Let's Encrypt).

---

## Шаг 1. Склонировать репозиторий и настроить `.env`

```bash
ssh root@<IP_СЕРВЕРА>
git clone https://github.com/mbelowwww/ts3-web-client.git
cd ts3-web-client
cp .env.example .env
```

`TS3_HOST`/`TS3_VOICE_HOST` в `.env` можно не трогать — `docker-compose.prod.yml`
сам подставит правильный адрес (`ts3server`, имя сервиса внутри docker-сети).
`TS3_QUERY_PASSWORD` и `TS3_SERVER_PASSWORD` пока тоже можно оставить как есть
в `.env.example` — реальный пароль ServerQuery TS3 сгенерирует сам при первом
запуске (шаг 2), впишем его в шаге 3.

---

## Шаг 2. Поднять всё одной командой

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Это поднимает три контейнера: `ts3web-server` (сам TS3), `ts3web-gateway`
(наш Node-гейтвей) и `ts3web-nginx` (TLS-терминация + реверс-прокси,
самоподписанный сертификат генерируется автоматически при первом старте).

**Проверить:**

```bash
docker compose -f docker-compose.prod.yml ps
```
все три сервиса должны быть `running`.

---

## Шаг 3. Достать реальный пароль ServerQuery и вписать в `.env`

```bash
docker logs ts3web-server 2>&1 | grep -A2 "Server Query Admin"
```

Появится блок вида:

```
Server Query Admin Account created
loginname= "serveradmin", password= "<сгенерированный пароль>"
```

Впишите его в `.env` (`TS3_QUERY_PASSWORD=...`), и перезапустите только
гейтвей, чтобы он подхватил новый пароль:

```bash
nano .env
docker compose -f docker-compose.prod.yml up -d ts3web
```

`TS3_SERVER_PASSWORD` — по умолчанию у этого TS3 нет пароля подключения,
поэтому это значение используется только как единственный пароль входа на
сайт (HTTP Basic Auth) — оставьте своё или впишите любое строгое.

**Проверить:**

```bash
docker compose -f docker-compose.prod.yml logs ts3web
```

Ожидаемо: `Server listening at http://...:3000` и `connected to server` (это
ServerQuery успешно подключился). Если видите `invalid loginname or
password` — пароль неверный, вернитесь к началу шага.

---

## Шаг 4. Проверить фаервол

Публично должны быть открыты только: `80`/`443` (сайт) и `9987/udp` (голос
TS3 для обычных TeamSpeak-клиентов, если они тоже нужны). Порт `3000`
(гейтвей) и `10011` (ServerQuery) наружу не публикуются вообще — ни в
`docker-compose.prod.yml`, ни в системном фаерволе за них можно не
переживать.

```bash
ufw status
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 9987/udp
```

**Проверить снаружи** (со своего компьютера, не с сервера):
```bash
curl -k https://<IP_СЕРВЕРА>/
```
должен ответить (401 без пароля — нормально, значит nginx достучался до
гейтвея).

---

## Шаг 5. Финальная проверка в браузере

1. Открыть `https://<IP_СЕРВЕРА>/`.
2. Браузер покажет предупреждение о самоподписанном сертификате —
   "Дополнительно" → "Перейти на сайт" (ожидаемо, принять один раз).
3. Окно логина (HTTP Basic Auth) — логин любой, пароль — `TS3_SERVER_PASSWORD` из `.env`.
4. Дерево каналов TS3 в админке (пока только "Default Channel" — сервер только что поднят с нуля).
5. "Подключиться к голосу" → разрешить микрофон (сработает — HTTPS даёт
   секьюр-контекст даже с self-signed) → сказать/услышать → проверить
   кнопку выключения микрофона.

---

## Обновление в будущем

```bash
cd ts3-web-client
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
(TS3 и его данные не пересоздаются — volume `ts3_data` сохраняется между запусками.)

---

## Если TS3 у вас уже работает на другом сервере/контейнере

Уберите сервис `ts3server` из `docker-compose.prod.yml` и укажите в `.env`
реальные `TS3_HOST`/`TS3_VOICE_HOST` (адрес того сервера) — блок
`environment:` в сервисе `ts3web`, который сейчас подставляет `ts3server`,
тоже нужно убрать, чтобы не перебивал значения из `.env`.
