# Kontur Pulse — фронтенд

Адаптивный интерфейс сервиса видеоконференций по макету Figma. Стек: Vue 3, TypeScript, Vite, Vue Router, Pinia, Vuetify, LiveKit Client и Socket.IO Client.

## Запуск

```powershell
docker compose up --build
```

Команду выполните из корня проекта. Откройте `http://127.0.0.1:5173`. Для ручного запуска без Docker нужны работающие PostgreSQL, backend, LiveKit и SMTP: `corepack pnpm install` и `corepack pnpm dev` в каталоге `frontend`. Vite проксирует API и Socket.IO на `http://127.0.0.1:3000` либо на `VITE_API_TARGET`. Проверка сборки: `corepack pnpm build`.

## Экраны

- `/login`, `/register`, `/forgot-password`, `/verify-email`, `/reset-password` — вход и связанные состояния.
- `/conferences` — кабинет, статусы встреч, запуск, отмена, завершение и ссылка для гостей.
- `/conferences/create`, `/conferences/:id/edit` — форма встречи.
- `/join/:slug` — гостевая ссылка и экран перед входом.
- `/conference/:id` — комната, роли, участники, опросы и голосования.
- `/polls`, `/polls/create` — список, создание и результаты опросов.
- `/settings` — профиль и настройки устройств.

Аккаунты, встречи, участники, опросы и голосования хранятся на сервере. Вход использует короткоживущий access token и HttpOnly cookie для обновления сессии. Гость входит по ссылке; камера, микрофон и показ экрана подключаются через LiveKit, события встречи приходят через Socket.IO. Обычный опрос допускает изменение ответа, голосование принимает один бюллетень и скрывает итоги до закрытия. Поля «должность», «команда» и «о себе» сохраняются только в текущем браузере.
