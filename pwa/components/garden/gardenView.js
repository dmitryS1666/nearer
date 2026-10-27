import { escapeHtml } from '../../ui/escapeHtml.js';
import { GARDEN_THEMES } from '../../domain/garden/themes.js';
import { derivePeriodProgress, nextQuestionScheduleInfo, periodDayNumber } from '../../domain/garden/progress.js';
import {
  getActivePeriod,
  getPeriodById,
  listCompletedPeriods,
  listPausedPeriods
} from '../../domain/garden/period.js';
import { gardenFromCompletedDays } from '../../domain/LocalCoupleRepository.js';
import { renderPlantSvg } from '../../domain/garden/plantSvg.js';
import { periodConclusions } from '../../domain/garden/progress.js';

function formatDate(isoOrDay) {
  if (!isoOrDay) return '—';
  const d = String(isoOrDay).length <= 10 ? `${isoOrDay}T12:00:00` : isoOrDay;
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
  } catch {
    return String(isoOrDay);
  }
}

export function renderGardenHome(state, { gardenAnim = null, selectedPeriodId = null } = {}) {
  if (selectedPeriodId) {
    const period = getPeriodById(state, selectedPeriodId);
    if (period) return renderFlowerHistory(state, period, { gardenAnim });
  }

  const active = getActivePeriod(state);
  const completed = listCompletedPeriods(state);
  const paused = listPausedPeriods(state);
  const memorial = (state.completedDays || 0) > 0 ? gardenFromCompletedDays(state.completedDays) : null;

  let hero = '';
  if (active) {
    const progress = derivePeriodProgress(active);
    const next = nextQuestionScheduleInfo(active);
    const anim =
      gardenAnim?.periodId === active.id
        ? gardenAnim.type === 'bloom'
          ? 'plant-bloom'
          : gardenAnim.type === 'stage-up'
            ? 'plant-stage-up'
            : 'plant-grow'
        : '';
    hero = `
      <section class="garden-hero glass-card terrace">
        <div class="terrace-sky" aria-hidden="true"></div>
        <div class="plant-stage-wrap ${anim}">
          ${renderPlantSvg(progress.stage.id, active.contentSnapshot.palette, {
            plantType: active.contentSnapshot.plantType,
            bloomAnim: gardenAnim?.type === 'bloom' && gardenAnim?.periodId === active.id
          })}
        </div>
        <div class="pill soft-earth">${escapeHtml(active.contentSnapshot.plantType)}</div>
        <h2>${escapeHtml(active.contentSnapshot.name)}</h2>
        <p>${escapeHtml(progress.stage.name)} · ${progress.mutualCount} из ${progress.required} взаимных ответов</p>
        <div class="progress-track"><div class="progress-bar garden-bar" style="width:${progress.progressPercent}%"></div></div>
        ${
          active.conflictNote === 'dual_active_paused'
            ? `<p class="microcopy">После синхронизации эта тема осталась активной; другая отложена без потери ответов.</p>`
            : ''
        }
        <p class="microcopy">${
          next?.unlocked
            ? 'Есть открытый вопрос — продолжите на экране «Сегодня».'
            : next
              ? next.waitingOnPrevious
                ? 'Сначала завершите предыдущий вопрос вдвоём.'
                : `Следующий вопрос — с дня ${next.scheduleDay} периода (сейчас день ${next.periodDay}).`
              : 'Все вопросы периода открыты.'
        }</p>
        <div class="button-row wrap" style="justify-content:center;margin-top:14px">
          <button class="primary" data-nav="today">К вопросу</button>
          <button class="secondary" data-period-history="${escapeHtml(active.id)}">История</button>
          <button class="ghost" data-pause-period="${escapeHtml(active.id)}">Отложить тему</button>
        </div>
      </section>`;
  } else {
    hero = `
      <section class="garden-hero glass-card terrace">
        <div class="terrace-sky" aria-hidden="true"></div>
        <div class="plant-stage-wrap empty-pot">${renderPlantSvg('seed', { pot: '#8B7355', leaf: '#6A8F6A', accent: '#C5D4A8', soil: '#5C4A3A', bloom: '#E8F0D8' })}</div>
        <h2>Выберите тему</h2>
        <p>Один период — одно растение. Растение растёт только от взаимных ответов.</p>
      </section>
      <section class="theme-picker">
        <h3>Темы для нового периода</h3>
        <div class="theme-grid">
          ${GARDEN_THEMES.map(
            (t) => `
            <button type="button" class="theme-card" data-start-theme="${escapeHtml(t.id)}">
              <div class="theme-mini">${renderPlantSvg('leaves', t.palette, { plantType: t.plantType, className: 'mini' })}</div>
              <b>${escapeHtml(t.plantType)}</b>
              <span>${escapeHtml(t.name)}</span>
              <small>${escapeHtml(t.description)}</small>
            </button>`
          ).join('')}
        </div>
      </section>`;
  }

  const collection = [...completed, ...paused];
  const collectionHtml =
    collection.length === 0 && !memorial
      ? `<p class="microcopy garden-hint">Завершённые и отложенные растения появятся здесь. Лимита на коллекцию нет.</p>`
      : `<section class="garden-collection">
          <h3>Коллекция</h3>
          <div class="plant-slots">
            ${
              memorial
                ? `<button type="button" class="plant-slot memorial" disabled title="Памятный сад ранних дней">
                    <span class="memorial-emoji">${memorial.stage.icon}</span>
                    <b>Памятный сад</b>
                    <small>${state.completedDays} совместных дней · не тематический период</small>
                  </button>`
                : ''
            }
            ${collection
              .map((p) => {
                const progress = derivePeriodProgress(p);
                return `<button type="button" class="plant-slot ${p.status}" data-period-history="${escapeHtml(p.id)}">
                  ${renderPlantSvg(progress.stage.id, p.contentSnapshot.palette, {
                    plantType: p.contentSnapshot.plantType,
                    className: 'slot-plant'
                  })}
                  <b>${escapeHtml(p.contentSnapshot.plantType)}</b>
                  <small>${escapeHtml(p.contentSnapshot.name)} · ${
                    p.status === 'completed' ? 'завершён' : 'отложен'
                  }</small>
                </button>`;
              })
              .join('')}
          </div>
          ${
            paused.length && !active
              ? `<div class="paused-actions">
                  <p class="microcopy">Отложенные можно возобновить, если нет активного периода.</p>
                  ${paused
                    .map(
                      (p) =>
                        `<button class="secondary" data-resume-period="${escapeHtml(p.id)}">Возобновить «${escapeHtml(p.contentSnapshot.name)}»</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }
          ${
            !active && completed.length
              ? `<div class="button-row wrap" style="margin-top:12px"><button class="primary" data-show-themes>Новый период</button></div>`
              : ''
          }
        </section>`;

  const startExtra =
    !active && completed.length
      ? `<section class="theme-picker" id="theme-picker-panel" hidden>
        <h3>Новая тема</h3>
        <div class="theme-grid">
          ${GARDEN_THEMES.map(
            (t) => `
            <button type="button" class="theme-card" data-start-theme="${escapeHtml(t.id)}">
              <div class="theme-mini">${renderPlantSvg('sprout', t.palette, { plantType: t.plantType, className: 'mini' })}</div>
              <b>${escapeHtml(t.plantType)}</b>
              <span>${escapeHtml(t.name)}</span>
            </button>`
          ).join('')}
        </div>
      </section>`
      : '';

  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <div class="eyebrow">Сад отношений</div>
        <h1>Наша терраса</h1>
        <p>Каждый период становится растением — визуальной памятью ваших ответов.</p>
      </div>
    </section>
    ${hero}
    ${collectionHtml}
    ${startExtra}
  `;
}

export function renderFlowerHistory(state, period, { gardenAnim = null } = {}) {
  const progress = derivePeriodProgress(period);
  const conclusions = periodConclusions(period);
  const day = periodDayNumber(period);
  const questions = period.contentSnapshot?.questions || [];

  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <button type="button" class="ghost" data-garden-back>← К саду</button>
        <div class="eyebrow">История растения</div>
        <h1>${escapeHtml(period.contentSnapshot.plantType)}</h1>
        <p>${escapeHtml(period.contentSnapshot.name)} · ${
          period.status === 'completed' ? 'завершён' : period.status === 'paused' ? 'отложен' : 'активен'
        }</p>
      </div>
    </section>
    <section class="garden-hero glass-card terrace">
      <div class="plant-stage-wrap ${gardenAnim?.periodId === period.id && gardenAnim?.type === 'bloom' ? 'plant-bloom' : ''}">
        ${renderPlantSvg(progress.stage.id, period.contentSnapshot.palette, {
          plantType: period.contentSnapshot.plantType,
          bloomAnim: period.status === 'completed'
        })}
      </div>
      <div class="milestones">
        <span>Начало: <b>${escapeHtml(formatDate(period.startDate))}</b></span>
        <span>${period.completedAt ? `Завершение: <b>${escapeHtml(formatDate(period.completedAt))}</b>` : `День периода: <b>${day}</b>`}</span>
      </div>
      <p>${escapeHtml(progress.stage.name)} · ${progress.mutualCount}/${progress.required}</p>
    </section>
    <section class="flower-qa">
      <h3>Вопросы и ответы</h3>
      ${questions
        .map((q) => {
          const slot = period.answers?.[q.id] || {};
          return `<article class="flower-q glass-card">
            <div class="pill">${q.kind === 'final' ? 'Финал' : `Вопрос ${q.order}`}</div>
            <h4>${escapeHtml(q.text)}</h4>
            <div class="answers-grid">
              <div class="answer-card violet"><span>${escapeHtml(state.profile.name)}</span><p>${escapeHtml(slot.a?.text || '—')}</p></div>
              <div class="answer-card rose"><span>${escapeHtml(state.profile.partnerName)}</span><p>${escapeHtml(slot.b?.text || '—')}</p></div>
            </div>
          </article>`;
        })
        .join('')}
    </section>
    <section class="settings-card">
      <h2>Выводы периода</h2>
      <p class="microcopy">Из финальных ответов каждого — текст партнёра не перезаписывается.</p>
      <div class="answers-grid">
        <div class="answer-card violet"><span>${escapeHtml(state.profile.name)}</span><p>${escapeHtml(conclusions.a?.text || 'Ещё нет')}</p></div>
        <div class="answer-card rose"><span>${escapeHtml(state.profile.partnerName)}</span><p>${escapeHtml(conclusions.b?.text || 'Ещё нет')}</p></div>
      </div>
    </section>
    <section class="settings-card">
      <h2>Мини-челлендж</h2>
      <p>${escapeHtml(period.contentSnapshot.challenge?.text || '')}</p>
      <p class="microcopy">Добровольно · не влияет на рост растения</p>
      <div class="milestones">
        <span>${escapeHtml(state.profile.name)}: <b>${period.challenge?.a?.done ? 'сделано' : 'пока нет'}</b></span>
        <span>${escapeHtml(state.profile.partnerName)}: <b>${period.challenge?.b?.done ? 'сделано' : 'пока нет'}</b></span>
      </div>
      <button class="secondary" data-toggle-challenge="${escapeHtml(period.id)}" style="margin-top:12px">${
        period.challenge?.[state.currentRole]?.done ? 'Снять отметку' : 'Отметить челлендж'
      }</button>
    </section>
  `;
}
