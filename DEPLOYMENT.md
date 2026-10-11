# Размещение Kontur Pulse

Публичный сайт собирается из `frontend` и `backend` в одном проекте Vercel по конфигурации [vercel.json](vercel.json). Все запросы сайта идут на один HTTPS-домен: страницы — во frontend, `/api/*` и `/socket.io/*` — в backend. Видео передаётся через LiveKit Cloud. Vercel Services и WebSocket на Vercel пока находятся в beta, поэтому публичную сборку нужно проверить до демонстрации преподавателю.

## Что понадобится

1. Аккаунт Vercel с доступом к репозиторию GitHub. При импорте проекта выбрать **корень репозитория**, а не папку `frontend`. Для проекта с `services` выбрать пресет **Services**.
2. База PostgreSQL, например бесплатный проект Neon. Сохранить строку подключения как `DATABASE_URL`.
3. Redis с доступом по TLS/TCP, например бесплатный Upstash. Сохранить `rediss://...` как `REDIS_URL`. Он нужен, чтобы опросы, голосования и завершение встречи доходили до пользователей на разных экземплярах backend.
4. Проект LiveKit Cloud: адрес `wss://...`, API key и API secret. Локальный LiveKit из `docker compose` нельзя использовать по публичной ссылке.
5. Почтовый сервис. Для Resend нужен API key и подтверждённый домен отправителя; вместо него можно использовать SMTP с логином и паролем. Тестовый Mailpit письма в интернет не отправляет.

Секреты вводятся только в настройки окружения Vercel. Не добавляйте их в Git, `vercel.json`, скриншоты или сообщения. Файл `backend/.env` исключён из Git.

## Переменные окружения Vercel

| Имя | Значение |
| --- | --- |
| `DATABASE_URL` | Строка подключения PostgreSQL с пулом соединений (для Prisma) |
| `REDIS_URL` | TLS-адрес Redis вида `rediss://...` |
| `JWT_SECRET` | Случайная строка длиной не менее 32 символов; отдельная от локального проекта |
| `LIVEKIT_URL` | Публичный адрес LiveKit Cloud вида `wss://...` |
| `LIVEKIT_API_KEY` | API key того же проекта LiveKit |
| `LIVEKIT_API_SECRET` | API secret того же проекта LiveKit |
| `RESEND_API_KEY` | API key Resend, если используется Resend |
| `MAIL_FROM` | Адрес с подтверждённого домена, например `Kontur Pulse <no-reply@example.com>` |
| `FRONTEND_ORIGIN` | Основной адрес сайта вида `https://имя.vercel.app`, без слеша в конце |

Если вместо Resend используется SMTP, задайте `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` и `MAIL_FROM` вместо `RESEND_API_KEY`. Порт 465 использует TLS. `AUTH_COOKIE_PATH` по умолчанию `/api/auth`; `LIVEKIT_INTERNAL_URL` для LiveKit Cloud не нужен. На Vercel `NODE_ENV` должен быть `production`, чтобы cookies отправлялись только по HTTPS.

## Порядок запуска

1. Создать внешние ресурсы и добавить их ключи в Vercel для Production и Preview. `FRONTEND_ORIGIN` для Preview оставить пустым: тогда почтовые ссылки используют адрес конкретной сборки.
2. Применить миграции из `backend/prisma/migrations` к новой базе командой `npm run db:deploy` из папки `backend` с `DATABASE_URL` этой базы. Это однократный шаг для новой базы; после изменений схемы миграции повторяются. Строку подключения не вставлять в команду, которая попадёт в историю PowerShell; её можно временно записать в исключённый из Git файл `backend/.env`.
3. Импортировать репозиторий в Vercel и выполнить Preview deployment. Проверить, что открываются `/login` и гостевая ссылка `/join/...`, а `/api/auth/me` отдаёт ответ API, а не HTML страницы.
4. Настроить в LiveKit Cloud подписанный webhook на `https://<адрес-сайта>/api/webhooks/livekit` для событий входа и выхода участника. Ключ и секрет webhook должны соответствовать `LIVEKIT_API_KEY` и `LIVEKIT_API_SECRET` в backend.
5. После проверки Preview выполнить Production deployment и задать `FRONTEND_ORIGIN` его HTTPS-адресом. Повторно развернуть проект после изменения переменной.
6. Проверить регистрацию и письмо, вход, создание встречи, вход гостя из второго браузера, камеру, микрофон, показ экрана, опрос, голосование и завершение для всех.

Локальный `docker compose` продолжает работать отдельно и использует свои тестовые PostgreSQL, Mailpit и LiveKit.
