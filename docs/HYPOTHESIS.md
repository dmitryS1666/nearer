# Product hypotheses — Ближе V0

Внутренние критерии после 10–20 тестеров (не industry benchmarks).

## Hypotheses

| ID | Hypothesis |
|----|------------|
| H1 | Пользователь понимает механику без объяснений. |
| H2 | Waiting создаёт ожидание, а не раздражение. |
| H3 | Reveal создаёт эмоциональную ценность. |
| H4 | Garden усиливает желание вернуться. |
| H5 | Пользователь хочет пригласить реального партнёра. |
| H6 | После первой сессии есть желание открыть приложение завтра. |
| H7 | Хотя бы часть пользователей понимает ценность Couple Plus. |

## Success criteria (internal)

After 10–20 testers:

- ≥ 80% проходят onboarding
- ≥ 70% отправляют первый answer
- ≥ 60% доходят до reveal
- ≥ 50% открывают garden/history
- ≥ 30% самостоятельно интересуются продолжением или партнёром

## Qualitative north star

> «Я бы реально попробовал(а) это со своим партнёром».

## Local metrics

Events logged on-device (`analytics`):

`app_open`, `onboarding_*`, `question_viewed`, `answer_*`, `waiting_viewed`, `reveal_viewed`, `reaction_sent`, `day_completed`, `garden_viewed`, `history_viewed`, `plus_*`, `notification_*`, `app_reset`

Export via Test Lab (answers excluded by default).
