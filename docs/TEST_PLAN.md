# PWA smoke test

## Core product loop

- onboarding сохраняется;
- роли в двух вкладках независимы через `sessionStorage`;
- общее state синхронизируется через IndexedDB/BroadcastChannel;
- первый партнёр не видит ответ второго до собственного submit;
- после двух ответов появляется Reveal;
- завершение переносит вопрос в History;
- streak и garden progression обновляются;
- следующий вопрос открывается.

## Offline

- service worker установлен;
- app shell открывается после отключения сети;
- уже сохранённый state доступен из IndexedDB;
- draft сохраняется локально.

## Notifications

- permission запрашивается только по кнопке;
- test notification показывается через service worker;
- click открывает экран today;
- unsupported API корректно отображаются.

## Installability

- manifest доступен;
- icons 192/512 доступны;
- `display: standalone`;
- Chrome/Edge получают installable PWA;
- на iOS показана инструкция Add to Home Screen.
