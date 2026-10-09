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

## CI/CD

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) проверяет PR в `main`: unit-тесты, production-сборку Vite и сборку Docker-образа. Этот же workflow вызывается из Deploy перед публикацией.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) запускается на push в `main` или вручную через **Actions → Deploy → Run workflow → main**. После успешного CI собирает и публикует образ в GHCR, делает `compose pull` и обновляет приложение на production runner'е.

### Runner'ы

1. Для CI нужен Linux self-hosted runner в группе **`build`**, с Docker Engine и Compose v2. Node.js 22 устанавливается actions. Нужен доступ к GitHub, npm и registry базовых Docker-образов.
2. Для Deploy тоже группа **`build`**. Runner должен быть установлен **на сервере приложения**, с доступом к Docker и GHCR. Дайте репозиторию доступ к этой группе. Если в группе несколько серверов, ограничьте `runs-on.labels` меткой нужного сервера.
3. Compose должен поддерживать `build --builder`, `COMPOSE_ENV_FILES`, `up --wait` и `--wait-timeout`; используйте актуальный Compose v2. Пользователю runner'а нужен доступ к Docker daemon без `sudo`.
4. Деплои сериализованы; имя Compose-проекта всегда **`nearer`**.

CI не выполняет код PR из fork на self-hosted runner'ах. PR из самого репозитория должны поступать от доверенных разработчиков; CI runner'ы лучше отделять от production-сервера.

CI и Deploy собирают образы через встроенный Docker builder (`compose build --builder default`). CI использует локальный тег `nearer-frontend:ci`.

### Файл окружения

Compose читает `.env` рядом с `docker-compose.yml` в checkout runner'а. Workflow задаёт `COMPOSE_ENV_FILES=.env`. Отсутствие файла останавливает деплой при проверке конфигурации.

| Переменная в `.env` | Значение |
| --- | --- |
| `DOMAIN` | Публичный hostname, например `nearer.example.com` |
| `ACME_EMAIL` | Email для Let's Encrypt (если Caddy включён) |
| `APP_PORT` | Порт frontend на сервере, по умолчанию `3007` |

Для GHCR используется встроенный `GITHUB_TOKEN` с `packages: write` только в deploy job. Отдельный PAT и SSH secrets не нужны. Если packages уже существуют, разрешите этому репозиторию запись в **Manage Actions access**.

Образы публикуются как `ghcr.io/<owner>/nearer/frontend:<commit-sha>`. Namespace приводится к нижнему регистру. Тег — SHA коммита, без `latest`.

В текущем Compose Caddy закомментирован, frontend слушает `APP_PORT` по HTTP. Настройте внешний TLS reverse proxy на этот порт.

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
