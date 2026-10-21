# Развёртывание Ближе / Nearer (Docker + TLS)

Стек: **Caddy** (HTTPS, опционально) → **nginx** (PWA).  
Backend нет: local-first приложение, данные только на устройстве (IndexedDB).

## Требования к серверу

- Docker Engine 24+ и Docker Compose v2
- Открыты порты **80** и **443** (если TLS на этом хосте) или доступ к `APP_PORT` через внешний reverse proxy
- Для Let's Encrypt: публичный **DNS A/AAAA** на IP сервера

## Быстрый старт

```bash
git clone https://github.com/dmitryS1666/nearer.git
cd nearer
cp .env.example .env
# заполните DOMAIN, ACME_EMAIL, APP_PORT при необходимости

docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:${APP_PORT:-3007}/health
```

Клиенту на тест: **`https://<DOMAIN>/`** (после настройки TLS).

- Android Chrome → «Установить приложение»
- iOS Safari → Поделиться → «На экран „Домой“»

## Переменные `.env`

| Переменная | Назначение |
| --- | --- |
| `DOMAIN` | Имя сайта. Для LE — реальный DNS |
| `ACME_EMAIL` | Email для Let's Encrypt (если включён Caddy) |
| `APP_PORT` | Порт frontend на сервере, по умолчанию `3007` |

Не коммитьте секреты. Корневой `.env` для деплоя не содержит ключей API.

## Сертификаты

### 1. Let's Encrypt (рекомендуется)

1. Раскомментируйте сервис `caddy` и volumes в `docker-compose.yml`
2. `DOMAIN=app.example.com`, `ACME_EMAIL=ops@example.com`
3. DNS A/AAAA → сервер
4. `docker compose up -d --build`
5. Caddy сам получит и продлит сертификат (данные в volume `caddy_data`)

Проверка: браузер без предупреждения, `https://DOMAIN` открывается, PWA ставится.

### 2. Свои сертификаты (корпоративный CA / купленный)

1. Положите файлы в `deploy/certs/`:
   - `fullchain.pem`
   - `privkey.pem`
2. В `deploy/Caddyfile` раскомментируйте:

   ```caddy
   tls /certs/fullchain.pem /certs/privkey.pem
   ```

3. В `docker-compose.yml` у сервиса `caddy` раскомментируйте volume:

   ```yaml
   - ./deploy/certs:/certs:ro
   ```

4. Перезапуск: `docker compose up -d`

### 3. Внешний TLS reverse proxy (текущий CI/CD по умолчанию)

В Compose Caddy закомментирован, frontend слушает `APP_PORT` по HTTP. Настройте OpenResty/nginx/Caddy на хосте на этот порт. HTTPS нужен для installability PWA.

### 4. Локально / без публичного DNS

```env
DOMAIN=localhost
ACME_EMAIL=
APP_PORT=3007
```

Caddy выдаст **internal** CA. Браузер/телефон покажет предупреждение.

## Полезные команды

```bash
docker compose logs -f frontend
docker compose pull
docker compose up -d --build
docker compose down
```

Обновление с git:

```bash
git pull
docker compose up -d --build
```

## Архитектура

```
Phone/Browser
    │ HTTPS :443
    ▼
  Caddy / внешний TLS proxy
    │ HTTP
    ▼
  frontend (nginx) ── static PWA, SW, manifest
```

Installability PWA требует **HTTPS** (или localhost).

## Production на regiuslab-de

- Каталог: **`/regiuslab/nearer`**
- Compose-проект: **`nearer`** (чужие стеки не трогаем)
- Порт: **`3011`** (`3007` занят izokom)
- Ручной деплой только так: `DEPLOY_PATH=/regiuslab/nearer ./scripts/server-deploy.sh`
- Caddy общий (`/home/artem/caddy`) **не правим автоматически** — сниппет в `deploy/caddy.nearer.snippet` для ручного merge

Запрещено при деплое nearer: `docker compose down` без `-p nearer`, `docker system prune`, stop/rm чужих контейнеров, правки чужих compose/Caddyfile.

## CI/CD

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — GitHub-hosted (`ubuntu-latest`): тесты, Vite build, Docker build.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — после CI: push образов в GHCR → Tailscale → SSH → `/regiuslab/nearer` → `scripts/server-deploy.sh` только для проекта `nearer`.

Self-hosted runners org **Regiuslab** (`pool: build`) к личному `dmitryS1666/nearer` не подключены — поэтому Deploy идёт через GitHub-hosted + Tailscale + SSH.

### Secrets (environment `production`)

| Secret | Назначение |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | Tailscale OAuth client с тегом `tag:ci` |
| `NEARER_SSH_HOST` | `100.94.144.13` |
| `NEARER_SSH_USER` | `regius` |
| `NEARER_SSH_KEY` | приватный ключ деплоя (без пароля) |

На сервере публичный ключ — в `~regius/.ssh/authorized_keys`. Пользователь `regius` должен быть в группе `docker`.

### Файл окружения на сервере

`/regiuslab/nearer/.env`:

| Переменная | Значение |
| --- | --- |
| `DOMAIN` | будущий hostname (пока можно placeholder) |
| `APP_PORT` | **`3011`** |
| `FRONTEND_IMAGE` / `LINK_PREVIEW_IMAGE` | пины из GHCR после CI |

Образы: `ghcr.io/<owner>/nearer/frontend:<sha>` и `.../link-preview:<sha>`.

### Edge / OpenResty: не кешируйте Service Worker

Nginx frontend уже отдаёт для `/sw.js`, `/index.html`, `/manifest.webmanifest` и `/offline.html`:

`Cache-Control: no-cache, no-store, must-revalidate`

Если перед контейнером стоит OpenResty/nginx/CDN, **не переопределяйте** эти ответы длинным `max-age`. Иначе после деплоя телефон держит старый SW при новом HTML/CSS.

Пример для OpenResty (прокси на `APP_PORT`):

```nginx
location = /sw.js {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_hide_header Cache-Control;
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    add_header Pragma "no-cache" always;
}
# то же для /index.html, /manifest.webmanifest и /offline.html
```

Деплой ждёт успешного Docker healthcheck и проверяет `/health` через nginx. Не выполняются `compose down` и удаление volumes. Автоматического отката нет. Браузерные данные остаются на устройствах.

## Безопасность (минимум)

- `.env` только на сервере (или безопасный коммит без секретов), права `600` для локальных правок с ключами
- HTTPS обязателен для установки PWA на телефон
- Android/iOS signing credentials не относятся к web-деплою и не должны попадать в Docker context
