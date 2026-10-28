import {
  startPeriod,
  pausePeriod,
  resumePeriod,
  submitPeriodAnswer,
  setChallengeDone,
  getActivePeriod,
  getPeriodById
} from '../../domain/garden/period.js';
import { derivePeriodProgress } from '../../domain/garden/progress.js';
import { todayPeriodMode } from './todayPeriod.js';

/**
 * Wire garden + period-today DOM. Callbacks keep app.js as state owner.
 */
export function bindPeriodTodayHandlers({
  getState,
  saveState,
  scheduleCoupleSync,
  track,
  toast,
  render,
  triggerPeriodAnim
}) {
  const form = document.getElementById('period-answer-form');
  const textarea = document.getElementById('period-answer-text');
  if (textarea) {
    const updateCount = () => {
      const el = document.getElementById('period-char-count');
      if (el) el.textContent = `${textarea.value.length} / 700`;
    };
    textarea.addEventListener('input', updateCount);
    updateCount();
  }
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const state = getState();
    const period = getActivePeriod(state);
    const ctx = todayPeriodMode(state);
    if (!period || !ctx.question) return;
    const text = (textarea?.value || '').trim();
    if (text.length < 2) return toast('Напиши хотя бы пару слов', 'warn');
    const prevStage = derivePeriodProgress(period).stage.id;
    let result;
    try {
      result = submitPeriodAnswer(state, period.id, ctx.question.id, state.currentRole, text);
    } catch (err) {
      return toast(err.code === 'question_locked' ? 'Этот вопрос ещё закрыт' : 'Не получилось сохранить', 'warn');
    }
    await saveState();
    scheduleCoupleSync();
    await track('period_answer_submitted', { periodId: period.id, questionId: ctx.question.id });
    if (result.mutualIncreased) {
      triggerPeriodAnim(period, prevStage, result);
      toast(result.bloomEvent ? 'Тема завершена — растение расцвело 🌸' : 'Оба ответили — растение подросло');
    } else {
      toast('Отправлено');
    }
    render();
  });
  document.querySelectorAll('[data-toggle-challenge]').forEach((el) =>
    el.addEventListener('click', async () => {
      const state = getState();
      const id = el.dataset.toggleChallenge;
      const period = getPeriodById(state, id);
      if (!period) return toast('Эта тема сейчас недоступна', 'warn');
      const done = !period?.challenge?.[state.currentRole]?.done;
      setChallengeDone(state, id, state.currentRole, done);
      await saveState();
      scheduleCoupleSync();
      toast(done ? 'Отметили' : 'Отметку сняли');
      render();
    })
  );
}

export function bindGardenHandlers({
  getState,
  route,
  saveState,
  scheduleCoupleSync,
  toast,
  render,
  nav
}) {
  document.querySelectorAll('[data-start-theme]').forEach((el) =>
    el.addEventListener('click', async () => {
      const state = getState();
      try {
        const { period } = startPeriod(state, el.dataset.startTheme, {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        });
        await saveState();
        scheduleCoupleSync();
        toast(`Тема «${period.contentSnapshot.name}» началась`);
        route.periodId = null;
        nav('today');
      } catch (err) {
        toast(err.code === 'active_period_exists' ? 'Сначала отложите текущую тему' : 'Не получилось начать', 'warn');
      }
    })
  );
  document.querySelectorAll('[data-pause-period]').forEach((el) =>
    el.addEventListener('click', async () => {
      if (!confirm('Отложить тему? Ответы сохранятся — можно вернуться позже или выбрать другую.')) {
        return;
      }
      pausePeriod(getState(), el.dataset.pausePeriod);
      await saveState();
      scheduleCoupleSync();
      toast('Отложили');
      route.periodId = null;
      render();
    })
  );
  document.querySelectorAll('[data-resume-period]').forEach((el) =>
    el.addEventListener('click', async () => {
      try {
        resumePeriod(getState(), el.dataset.resumePeriod);
        await saveState();
        scheduleCoupleSync();
        toast('Снова в деле');
        route.periodId = null;
        render();
      } catch (err) {
        toast(err.code === 'active_period_exists' ? 'Сначала закончите или отложите текущую' : 'Не получилось вернуть', 'warn');
      }
    })
  );
  document.querySelectorAll('[data-period-history]').forEach((el) =>
    el.addEventListener('click', () => {
      route.periodId = el.dataset.periodHistory;
      render();
    })
  );
  document.querySelectorAll('[data-garden-back]').forEach((el) =>
    el.addEventListener('click', () => {
      route.periodId = null;
      render();
    })
  );
  document.querySelectorAll('[data-show-themes]').forEach((el) =>
    el.addEventListener('click', () => {
      const panel = document.getElementById('theme-picker-panel');
      if (panel) panel.hidden = !panel.hidden;
    })
  );
  document.querySelectorAll('[data-toggle-challenge]').forEach((el) =>
    el.addEventListener('click', async () => {
      const state = getState();
      const id = el.dataset.toggleChallenge;
      const period = getPeriodById(state, id);
      if (!period) return;
      const done = !period?.challenge?.[state.currentRole]?.done;
      setChallengeDone(state, id, state.currentRole, done);
      await saveState();
      scheduleCoupleSync();
      render();
    })
  );
}
