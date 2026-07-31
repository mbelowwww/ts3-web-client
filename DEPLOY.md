# Деплой ts3web на прод-сервер

Общий сценарий: Linux-сервер с Docker, доступ по SSH root/sudo. TS3-сервер
и гейтвей поднимаются одной командой через `docker-compose.prod.yml`; шаги
1–3 одинаковы независимо от домена, дальше — развилка:

- **Сценарий А — своего домена нет, только IP.** TLS терминирует nginx
  внутри docker (тот же `docker-compose.prod.yml`), сертификат
  самоподписанный, генерируется автоматически при первом старте.
- **Сценарий Б — домен и HTTPS уже настроены, nginx на хосте уже есть.**
  Свой nginx-в-docker не поднимаем — просто добавляем один `location` в уже
  существующий конфиг хостового nginx.

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

## Шаг 2. Поднять TS3 и гейтвей

**Сценарий А** (нет домена — сразу вместе с nginx, одной командой на всё):
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

**Сценарий Б** (домен/HTTPS/nginx уже есть — без своего nginx-в-docker):
```bash
docker compose -f docker-compose.prod.yml up -d --build ts3server ts3web
```

Это поднимает `ts3web-server` (сам TS3) и `ts3web-gateway` (наш Node-гейтвей;
в сценарии А ещё и `ts3web-nginx` — TLS-терминация + реверс-прокси,
самоподписанный сертификат генерируется автоматически при первом старте).

**Проверить:**

```bash
docker compose -f docker-compose.prod.yml ps
```
нужные сервисы должны быть `running` (в сценарии Б `nginx` в списке быть не должно — он не поднимался).

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

## Дальше — по сценарию

### Сценарий А. nginx-в-docker (self-signed)

#### Шаг 4а. Проверить фаервол

Публично должны быть открыты только: `80`/`443` (сайт) и `9987/udp` (голос
TS3 для обычных TeamSpeak-клиентов, если они тоже нужны). Порт `3000`
(гейтвей, опубликован только на `127.0.0.1`) и `10011` (ServerQuery) наружу
не смотрят вообще.

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
должен ответить (401 без пароля — нормально, значит nginx достучался до гейтвея).

#### Шаг 5а. Финальная проверка в браузере

1. Открыть `https://<IP_СЕРВЕРА>/`.
2. Браузер покажет предупреждение о самоподписанном сертификате —
   "Дополнительно" → "Перейти на сайт" (ожидаемо, принять один раз).
3. Дальше — как в общем шаге проверки ниже (см. «Финальная проверка»).

---

### Сценарий Б. Свой домен, HTTPS и nginx уже есть

#### Шаг 4б. Добавить location в существующий nginx

Взять сниппет [`deploy/nginx-location.conf.example`](./deploy/nginx-location.conf.example)
и вставить `location / { ... }` внутрь уже существующего `server { listen 443 ssl; ... }`
блока для вашего домена (не отдельный `server{}` — именно `location` в тот, что уже
терминирует TLS):

```bash
nano /etc/nginx/sites-available/<ваш_конфиг>
nginx -t && systemctl reload nginx
```

**Проверить:**
```bash
nginx -t
```
должно вывести `syntax is ok` и `test is successful`.

```bash
curl -k -u x:<TS3_SERVER_PASSWORD_из_.env> https://<ваш_домен>/
```
должен вернуть HTML главной страницы.

#### Шаг 5б. Проверить фаервол

Порты `80`/`443` у вас уже открыты (раз HTTPS работал раньше). Дополнительно
открыть только голосовой TS3: `9987/udp` (если TS3 только что подняли на
этом сервере, см. шаг 2). Порт `3000` наружу не публикуется (только
`127.0.0.1:3000` — см. `docker-compose.prod.yml`).

```bash
ufw allow 9987/udp
```

#### Шаг 6б. Финальная проверка в браузере

1. Открыть `https://<ваш_домен>/` — сертификат уже доверенный, предупреждений быть не должно.
2. Дальше — как в общем шаге проверки ниже.

---

## Финальная проверка (общая для обоих сценариев)

1. Окно логина (HTTP Basic Auth) — логин любой, пароль — `TS3_SERVER_PASSWORD` из `.env`.
2. Дерево каналов TS3 в админке (пока только "Default Channel", если TS3 только что подняли с нуля).
3. "Подключиться к голосу" → разрешить микрофон (сработает — секьюр-контекст
   есть в обоих сценариях: HTTPS с self-signed или с доверенным сертификатом)
   → сказать/услышать → проверить кнопку выключения микрофона.

Если голос/микрофон не работают, а админка работает — проверить в логах
гейтвея (`docker compose -f docker-compose.prod.yml logs ts3web`), что
WebSocket `/ws/voice` подключается. Причина обычно в отсутствующих
заголовках `Upgrade`/`Connection` на прокси — в `deploy/nginx.conf.example`
и `deploy/nginx-location.conf.example` они уже есть, проверить, что не
потерялись при копировании в свой конфиг (сценарий Б).

---

## Обновление в будущем

```bash
cd ts3-web-client
git pull
docker compose -f docker-compose.prod.yml up -d --build   # сценарий А
docker compose -f docker-compose.prod.yml up -d --build ts3server ts3web   # сценарий Б
```
(TS3 и его данные не пересоздаются — volume `ts3_data` сохраняется между запусками.)

---

## Если TS3 у вас уже работает на другом сервере/контейнере

Уберите сервис `ts3server` из `docker-compose.prod.yml` и укажите в `.env`
реальные `TS3_HOST`/`TS3_VOICE_HOST` (адрес того сервера) — блок
`environment:` в сервисе `ts3web`, который сейчас подставляет `ts3server`,
тоже нужно убрать, чтобы не перебивал значения из `.env`.
