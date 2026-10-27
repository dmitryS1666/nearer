import { escapeHtml } from '../../ui/escapeHtml.js';
import {
  currentPeriodQuestion,
  derivePeriodProgress,
  hasNonEmptyAnswer,
  nextQuestionScheduleInfo
} from '../../domain/garden/progress.js';
import { getActivePeriod } from '../../domain/garden/period.js';
import { renderPlantSvg } from '../../domain/garden/plantSvg.js';

/**
 * @returns {'period-answer'|'period-wait'|'period-reveal'|'period-waiting-schedule'|'none'}
 */
export function todayPeriodMode(state, now = new Date()) {
  const period = getActivePeriod(state);
  if (!period) return { mode: 'none', period: null };
  const progress = derivePeriodProgress(period);
  const current = currentPeriodQuestion(period, now);
  if (!current) {
    return { mode: 'period-waiting-schedule', period, progress, next: nextQuestionScheduleInfo(period, now) };
  }
  const role = state.currentRole === 'b' ? 'b' : 'a';
  const partner = role === 'a' ? 'b' : 'a';
  const slot = period.answers?.[current.id] || {};
  const me = hasNonEmptyAnswer(slot[role]);
  const them = hasNonEmptyAnswer(slot[partner]);
  if (!me) return { mode: 'period-answer', period, progress, question: current, slot };
  if (!them) return { mode: 'period-wait', period, progress, question: current, slot };
  return { mode: 'period-reveal', period, progress, question: current, slot };
}

export function renderPeriodTodayBody(state, ctx) {
  const { mode, period, progress, question, next } = ctx;
  if (mode === 'none' || !period) return '';

  const mini = `
    <div class="period-chip">
      ${renderPlantSvg(progress.stage.id, period.contentSnapshot.palette, {
        plantType: period.contentSnapshot.plantType,
        className: 'chip-plant'
      })}
      <div>
        <b>${escapeHtml(period.contentSnapshot.plantType)}</b>
        <small>${escapeHtml(period.contentSnapshot.name)} · ${progress.mutualCount}/${progress.required} · ${escapeHtml(progress.stage.name)}</small>
      </div>
    </div>`;

  if (mode === 'period-waiting-schedule') {
    return `
      <section class="waiting-card glass-card period-today">
        ${mini}
        <div class="pill">Период идёт</div>
        <h2>Следующий вопрос ещё не открыт</h2>
        <p>${
          next?.waitingOnPrevious
            ? 'Дождитесь взаимного ответа на предыдущий вопрос (возможно, на другом телефоне).'
            : next
              ? `Рекомендуемый день вопроса — ${next.scheduleDay}. Сейчас день ${next.periodDay} периода. Пропуск не сжигает вопрос.`
              : 'Все вопросы периода пройдены — растение должно расцвести после sync.'
        }</p>
        <div class="button-row wrap" style="justify-content:center">
          <button class="primary" data-nav="garden">Открыть сад</button>
        </div>
      </section>`;
  }

  if (mode === 'period-answer') {
    return `
      <section class="question-card glass-card period-today">
        ${mini}
        <div class="question-meta">
          <span class="pill">${question.kind === 'final' ? 'Финал периода' : `Вопрос ${question.order} · период`}</span>
          <span>${escapeHtml(period.contentSnapshot.name)}</span>
        </div>
        <h2>${escapeHtml(question.text)}</h2>
        <p class="question-note">Ответ партнёра откроется после вашего. Рост растения — только когда ответите оба.</p>
        <form id="period-answer-form">
          <textarea id="period-answer-text" maxlength="700" rows="4" placeholder="Напишите бережно и по делу…" enterkeyhint="done"></textarea>
          <div class="textarea-footer"><span id="period-char-count">0 / 700</span><span>Не влияет на счётчик дней</span></div>
          <button class="primary large full sticky-cta" type="submit">Отправить ответ <span>♥</span></button>
        </form>
      </section>`;
  }

  if (mode === 'period-wait') {
    return `
      <section class="waiting-card glass-card period-today">
        ${mini}
        <div class="pulse-heart">♥</div>
        <div class="pill">Ответ отправлен</div>
        <h2>Ждём партнёра</h2>
        <p>Растение подрастёт только после взаимного ответа на этот вопрос.</p>
        <div class="waiting-orbit">
          <div>Ты ✓</div><span class="waiting-dots"><i></i><i></i><i></i></span>
          <div>${escapeHtml(state.profile.partnerName)} …</div>
        </div>
        <div class="button-row wrap" style="justify-content:center;margin-top:12px">
          <button class="secondary" data-nav="garden">Сад</button>
        </div>
      </section>`;
  }

  // reveal
  return `
    <section class="reveal-section period-today">
      ${mini}
      <div class="reveal-heading">
        <div class="confetti">✦</div>
        <div><div class="eyebrow">Взаимный ответ</div><h2>${escapeHtml(question.text)}</h2></div>
      </div>
      <div class="answers-grid">
        <article class="answer-card violet"><span>${escapeHtml(state.profile.name)}</span><p>${escapeHtml(ctx.slot.a?.text || '—')}</p></article>
        <article class="answer-card rose"><span>${escapeHtml(state.profile.partnerName)}</span><p>${escapeHtml(ctx.slot.b?.text || '—')}</p></article>
      </div>
      <div class="completion-card">
        <div><span class="completion-icon">🌿</span>
          <div><b>${escapeHtml(progress.stage.name)}</b>
          <small>${progress.mutualCount} из ${progress.required} · переход к следующему, когда он откроется по расписанию</small></div>
        </div>
        <button class="primary" data-nav="garden">В сад</button>
      </div>
      ${
        period.contentSnapshot.challenge
          ? `<div class="settings-card" style="margin-top:14px">
              <h2>Мини-челлендж</h2>
              <p>${escapeHtml(period.contentSnapshot.challenge.text)}</p>
              <button class="secondary" data-toggle-challenge="${escapeHtml(period.id)}">${
                period.challenge?.[state.currentRole]?.done ? 'Снять отметку' : 'Отметить «сделано»'
              }</button>
            </div>`
          : ''
      }
    </section>`;
}

export function renderOptionalLegacyDaily(state, legacyHtml) {
  return `
    <details class="legacy-daily">
      <summary>Дополнительный вопрос дня (не растит сад периода)</summary>
      ${legacyHtml}
    </details>`;
}
