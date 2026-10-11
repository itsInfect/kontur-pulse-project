# Kontur Pulse

Учебный командный проект сервиса видеоконференций с опросами и голосованиями.

## Документы

- [Актуальное техническое задание](TZ_Kontyr_Pulse_MVP_v2.docx) — версия 2 от 9 октября 2026 года.
- [Исходный черновик ТЗ](Kratkoe_TZ_MVP_Videokonferencii.docx) — сохранён для истории решений.

## Стек

- Frontend: Vue 3, TypeScript, Vite, Pinia, Vuetify.
- Backend: NestJS, TypeScript, Prisma, PostgreSQL.
- Медиа: LiveKit и WebRTC.
- Бизнес-события: NestJS WebSocket; при нескольких экземплярах backend события передаются через Redis.

Сервер находится в [backend](backend/README.md). Там описаны запуск, API, события в реальном времени и тесты. Фронтенд подключён к API, Socket.IO и LiveKit.

Порядок публичного размещения полного сервиса описан в [DEPLOYMENT.md](DEPLOYMENT.md).

## Frontend

Адаптивный интерфейс находится в [frontend](frontend/README.md).

## Запуск без Docker на этом компьютере

PostgreSQL, Mailpit и LiveKit уже подготовлены в `.local/` для локальной разработки. Из PowerShell в корне проекта:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

Подождите до минуты, затем откройте сайт `http://127.0.0.1:5173`. Письма для подтверждения аккаунта и сброса пароля доступны в Mailpit на `http://127.0.0.1:8025`. API и Swagger: `http://127.0.0.1:3000/api`. Данные локальной базы и письма сохраняются в `.local/`; этот каталог не добавляется в Git.

Чтобы остановить только процессы проекта:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

На другом компьютере сначала понадобятся Node.js, PostgreSQL 16 и Windows-сборки Mailpit и LiveKit; приведённый скрипт запуска использует уже подготовленный каталог `.local/`.

## Запуск через Docker

Из корня проекта: `docker compose up --build`.
