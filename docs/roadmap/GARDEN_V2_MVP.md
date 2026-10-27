# Garden v2 MVP — «Сад отношений»

**Статус:** implementation target  
**Источник правил:** запрос реализации + `Nearer_Garden_of_Relationships_Concept.docx`  
**Конфликт-матрица:** база анализа; решения ниже имеют приоритет.

## Подтверждённые расхождения с предыдущим анализом

| Было в анализе | Решение MVP |
|---|---|
| Plus gate на слоты растений | **Не** ограничивать сохранённую историю платными слотами |
| 1 растение fully staged, остальные still+bar | **Все 4** темы с 6 SVG-стадиями |
| Recovery «лучше до Phase 1» | Recovery реализуется **в этом же объёме** (минимальный надёжный вариант) |
| `completedDays` → стартовый тематический период | **Запрещено.** Первый настоящий период с нуля; legacy — отдельное «памятное» растение |
| Nav «Сад / Период / История» | Глобальная навигация **без изменений**; период внутри «Сегодня» + «Сад» |

## Продуктовые правила (зафиксировано)

### Период
- 1 период = 1 тема = 1 экземпляр растения (`Period.id`).
- 21 день — рекомендуемый ритм, **не** дедлайн: после дня 21 период не увядает и не штрафуется.
- Расписание вопросов (день от `startDate` в `timeZone` периода): **1, 4, 8, 11, 15, 18**; финальный — с **21**.
- Вопрос доступен, когда наступила его дата **и** предыдущий взаимно завершён. Пропуск не удаляет вопрос.
- Автостарт нового периода **нет**.

### Сегодня
- Точка входа: доступный вопрос периода / ожидание партнёра / reveal / следующий шаг / переход в сад.
- Не два обязательных опроса в день. Legacy daily (банк `QUESTIONS`) — добровольно, если нет доступного period-вопроса (или как доп. активность после закрытия текущего).
- Рост растения **только** от взаимных ответов на вопросы периода.
- Несколько period-вопросов за календарный день **не** крутят `completedDays` / streak.

### Прогресс
- 7 обязательных вопросов (6 + финал).
- Зачёт: оба реальных участника (`a`/`b`) отправили непустой текст на один `questionId` периода.
- `progressPercent = mutualCount / 7 * 100` — **вычисляется**, не хранится как источник истины.
- Стадии: 0 семя · 1 росток · 2–3 стебель · 4–5 листья · 6 бутон · 7 цветение.
- После 7-го взаимного ответа → `completed`; bloom — визуальное событие.
- Повторная отправка / edit / sync не дают доп. прогресс.
- Demo Partner **не** отвечает на period-вопросы и не пишет в настоящие периоды.

### Прерывание
- «Отложить тему» → `paused` (ответы и стадия сохраняются).
- Resume только если нет другого `active`.
- Статусы: `active` | `paused` | `completed`.
- Повтор темы = новый `Period` + новое растение в коллекции.

## Модель данных

```
state.gardenContentVersion   // версия каталога на клиенте (не меняет snapshot периода)
state.periods: Period[]

Period {
  id, circleId,
  themeId,                 // ссылка на каталог (для UI выбора)
  status: active|paused|completed,
  startDate,               // YYYY-MM-DD в timeZone
  timeZone,                // IANA, фиксируется при старте
  completedAt: ISO|null,
  pausedAt: ISO|null,
  contentSnapshot: {       // immutable copy at start
    contentVersion, themeId, name, plantType, description,
    palette, questions[{id,order,weekHint,kind:main|final,text}],
    challenge: { id, text }
  },
  answers: {
    [questionId]: {
      a?: { text, submittedAt, updatedAt },
      b?: { text, submittedAt, updatedAt }
    }
  },
  challenge: {
    a?: { done:bool, updatedAt },
    b?: { done:bool, updatedAt }
  },
  // conflict metadata
  createdAt, updatedAt, version,
  originDeviceId?,         // optional install/device hint
  conflictNote?            // e.g. paused due to dual-start
}
```

Растение в саду = проекция `Period` (отдельной таблицы Plant нет).

Legacy memorial: если `completedDays > 0`, UI показывает отдельную карточку «Памятный сад (ранние дни)» — не `Period`.

## Принадлежность архива (schemaVersion → 4)

**Модель:** entity-level `circleId` на всех общих коллекциях + указатели:
- `activeCircleId` — текущий архив для UI/sync;
- `lastBoundPairId` — последний успешно связанный `pairId` (**переживает leave**);
- `circleStats` — припаркованные счётчики/ритуал по кругу.

| Сценарий | Поведение |
|---|---|
| Solo → первая пара | Один раз: unscoped/solo → remap на `pairId` |
| Leave | Чистит `deviceLink` (доступ к sync), **не** происхождение данных; пишет `lastBoundPairId` |
| Leave → restart → create/join другой пары | `lastBoundPairId !== newPair` → **без** remap; старые сущности остаются с прежним `circleId` |
| Rejoin той же пары | Восстанавливает `activeCircleId`; remap не нужен |
| Backup restore при живой новой паре | Сохраняет текущий `deviceLink`; **не** переименовывает старый архив в архив текущей пары |
| Unscoped / недоказуемая принадлежность | Остаётся локально; **не** уходит в исходящий payload |

Единая политика: `bindStateToPair` / `adoptPairIdentity` → `ownership.js`.

## Миграция

- **v3:** `periods: []`, без вымышленных thematic answers из `completedDays`.
- **v4:** `activeCircleId`, `lastBoundPairId`, `circleStats`; stamp unscoped → active circle; `statusUpdatedAt`/`statusVersion` на periods.
- Идемпотентна; чужие `circleId` не переписываются.

## Sync совместимость

| | |
|--|--|
| `SYNC_VERSION` / `SYNC_FORMAT_VERSION` | **3** (payload только текущего круга: periods + answers/history/reactions/lists/… ) |
| Wire | клиент шлёт `formatVersion` с ciphertext |
| Сервер | reject PUT с меньшим format, если на паре уже лежит более новый (`client_outdated`) |
| Старый клиент (v2) | **не** может затереть v3 snapshot — обход изоляции через старый sync-формат закрыт |
| Исходящий payload | только сущности с `circleId === activeCircleId`; unscoped не отправляются |
| Входящий payload | при linked: `payload.circleId` обязан совпасть с `deviceLink.pairId`, иначе merge no-op |
| Status merge | `statusUpdatedAt`/`statusVersion` (не content clock); order-independent; completed sticky |
| Dual active | меньший `(createdAt, id)` остаётся active; остальные paused; повторный sync не бампает loser |

### Порядок обновления без потери данных

1. Сервер уже принимает `formatVersion` и отклоняет downgrade.
2. Клиенты v3 читают payload v1/v2, пишут `formatVersion: 3`.
3. После первой записи v3 старые клиенты получают `client_outdated`.
4. Оба телефона пары обновляйте в одном окне.

## Recovery — фактическая архитектура

| Артефакт | Содержимое | Шифрование |
|---|---|---|
| Content backup | state без `deviceLink` (periods, answers, lists…) | нет (файл у владельца) |
| Pair recovery | `pairId`, `deviceToken`, role, JWK keys, `peerPublicKey`, `syncRevision`, `circleId` | PBKDF2-SHA256 210k + AES-GCM, random salt+iv |

| Сценарий | Что возможно |
|---|---|
| (а) потерян один телефон, второй жив | Нужен **recovery** потерявшего (или новая пара: leave+create). Partner’s phone alone cannot mint your `deviceToken`. Server snapshot readable only with your private key. |
| (б) оба потеряны, есть content + recovery | Restore content → restore recovery → sync pulls server ciphertext if token still valid. |
| (в) только content backup | Архив/периоды локально; **без** sync keys. Нужна новая пара; серверный blob старой пары недоступен. |
| (г) только recovery | Связь/ключи; контент с сервера если token валиден и snapshot есть. Пустое локальное хранилище заполнится sync. |

**Не требуется**, чтобы *оба* всегда хранили backup+recovery: достаточно, чтобы *каждое* устройство имело способ восстановить *свой* token/key (recovery) и/или контент (backup). Если жив партнёр с валидной парой и вы потеряли recovery — только новая пара.

### Конфликты status (один period id)
1. Сравнение по `statusUpdatedAt` / `statusVersion` (content `updatedAt`/`version` не меняет статус сам по себе).
2. `completed` не оживает от устаревшего active/paused; более новый status-op может сменить статус.
3. При равных status-stamps — детерминированный tie-break (имя статуса, затем id); порядок аргументов merge не влияет.
4. Ответы мержатся независимо (непроигрыш непустых с обеих ролей).

## Recovery (минимальный)

| Сценарий | Что возможно |
|---|---|
| Backup файла (без ключей) | Восстанавливает контент (включая periods). **Не** восстанавливает `deviceLink`. |
| Pair recovery bundle (passphrase) | AES-GCM обёртка: `deviceToken`, keys, `pairId`, role. Нужна для того же серверного pair. |
| Партнёр онлайн, свой телефон потерян | Нужен recovery bundle **или** новая пара (старый pair leave + create). |
| Оба устройства потеряны без backup/bundle | Контент и ключи **невосстановимы** — production blocker без offline backup дисциплины. |

Plain backup **никогда** не содержит `privateKeyJwk` / `deviceToken` в открытом виде.

## Критерии готовности MVP

- [x] Полный цикл одной темы: start → mutual answers → stages → complete → history (unit + encrypted two-store)
- [x] 4 темы в каталоге; повтор темы = новый экземпляр
- [x] Sync двусторонний + dual-start normalize
- [x] Старый клиент не стирает periods (server `formatVersion` / 426)
- [x] Demo Partner не пишет в periods (только legacy dayKey)
- [x] Тесты сценариев 1–19 (unit/integration в `pwa/tests/garden.test.js` + regression suite)
- [x] `npm test` + `npm run build` зелёные
- [x] Recovery: content backup + passphrase pair bundle; ограничения задокументированы

## Не в MVP
AI, биллинг, сезонность, ambient, PDF, фото в периоде, процедурный рост, новая global nav.
