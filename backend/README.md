# Kontur Pulse backend

NestJS API с PostgreSQL, Prisma, Socket.IO и LiveKit. Реализованы регистрация и подтверждение почты, вход и обновление сессии, сброс пароля, встречи, гостевые сессии, модераторы, управление участниками, опросы, голосования, аудит событий и выдача медиа-токенов.

## Запуск

Из корня репозитория:

```powershell
docker compose up --build
```

Нужен работающий Docker Desktop с поддержкой WSL 2/виртуализации. Адреса: frontend — `http://127.0.0.1:5173`, API и Swagger — `http://127.0.0.1:3000/api`, тестовая почта Mailpit — `http://127.0.0.1:8025`. Frontend обращается к API через Vite proxy и подключается к LiveKit на порту 7880.

Для проверки полного сценария зарегистрируйтесь во frontend, откройте письмо в Mailpit и перейдите по ссылке подтверждения. После входа создайте встречу, запустите её и откройте гостевую ссылку в другом браузере. Для камеры и микрофона браузер запросит доступ к устройствам.

Для отдельного запуска backend скопируйте `.env.example` в `.env`, запустите PostgreSQL, LiveKit и SMTP, затем:

```powershell
cd backend
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

Секреты в `docker-compose.yml` подходят только для локальной разработки. Для внешнего доступа задайте отдельные `JWT_SECRET`, `LIVEKIT_API_SECRET`, пароль БД, HTTPS и отправку почты через Resend API или SMTP. Порядок публичного запуска описан в корневом `DEPLOYMENT.md`.

## Проверка основного сценария

1. `POST /auth/register` принимает `email`, `name`, `password`. Скопируйте токен из письма в Mailpit и отправьте `POST /auth/verify-email` с `{ "token": "..." }`.
2. `POST /auth/login` возвращает `accessToken` и устанавливает HttpOnly refresh cookie. Передавайте `Authorization: Bearer <accessToken>` в защищённых запросах. `POST /auth/refresh` меняет refresh cookie, повторное использование старого токена запрещено.
3. `POST /conferences` создаёт встречу. Владелец может заранее создать черновики через `POST /conferences/:id/polls` и `/votes`, назначить модераторов через `/conferences/:id/moderators`, затем начать встречу через `POST /conferences/:id/start`.
4. `GET /join/:slug` показывает сведения о приглашении. `POST /join/:slug` с `{ "displayName": "Гость" }` создаёт гостевую сессию и устанавливает HttpOnly cookie встречи. Повторный вход с этой cookie сохраняет участника и его историю.
5. `POST /conferences/:id/media-token` выдаёт короткоживущий LiveKit JWT только участнику идущей встречи. `GET /conferences/:id/state` возвращает снимок состояния.
6. Организатор или модератор публикует опрос через `POST /polls/:id/publish`; участник отвечает через `POST /polls/:id/responses`. Повторный ответ заменяет предыдущий. Опрос может показывать текущие результаты.
7. Организатор или модератор открывает голосование через `POST /votes/:id/open`. Список допущенных фиксируется в этот момент. `POST /votes/:id/ballots` принимает один бюллетень на участника; итоги недоступны до `POST /votes/:id/close`.

Варианты выбираются по индексам от нуля: опрос — `{ "selected": [0, 2] }`, голосование — `{ "selected": 1 }`. У модератора право завершить встречу задаётся отдельно (`canEnd`). Удалённый из встречи участник не может войти с прежней сессией или получить медиа-токен. Модератор может выключить микрофон участника через `POST /conferences/:id/participants/:pid/mute`; включить его за участника нельзя.

## События в реальном времени

Socket.IO namespace: `http://127.0.0.1:3000/events`, транспорт `websocket`. Передавайте `auth: { conferenceId, accessToken }` для пользователя или `auth: { conferenceId }` с гостевой cookie и `withCredentials: true` для гостя. Подключиться может только присутствующий участник идущей встречи.

При подключении приходит `state.snapshot` с `version`, данными встречи, участников, опросов и голосований. При пропуске события клиент может запросить новый снимок событием `state.snapshot`. События `conference.started`, `conference.ended`, `participant.joined`, `participant.left`, `participant.updated`, `participant.removed`, `poll.published`, `poll.results.updated`, `poll.closed`, `vote.opened`, `vote.closed` содержат `{ conferenceId, version, type, data, at }`. Доступный участнику снимок голосования содержит только признак допуска и факт собственного бюллетеня; промежуточные итоги не передаются.

LiveKit отправляет подписанный webhook на `POST /webhooks/livekit`. Сервер проверяет подпись, обновляет `mediaConnected` и удаляет из медиа-комнаты участника, утратившего право присутствовать. Адрес для вызовов LiveKit из контейнера задаётся `LIVEKIT_INTERNAL_URL`, публичный WebSocket адрес клиента — `LIVEKIT_URL`.

## Тесты

```powershell
cd backend
$env:INTEGRATION_DATABASE_URL = 'postgresql://pulse:pulse@localhost:5432/pulse_test?schema=public'
$env:DATABASE_URL = $env:INTEGRATION_DATABASE_URL
npm run db:deploy
npm test
```

Нужна отдельная тестовая база с применёнными миграциями. Без `INTEGRATION_DATABASE_URL` интеграционный набор пропускается. В `.github/workflows/backend.yml` PostgreSQL запускается как сервис, после чего выполняются миграции и тесты.
