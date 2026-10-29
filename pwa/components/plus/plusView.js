import { PLUS_BENEFITS, PLUS_COPY, PLUS_PLAN_CHOICES } from './plusCopy.js';

export function renderPlus(model = {}) {
  const plan = model.plan === 'year' ? 'year' : 'month';
  const phase = model.phase || 'idle';
  const sending = phase === 'sending';
  const sent = phase === 'sent';
  const locked = sending || sent;
  const label = sending ? PLUS_COPY.sending : sent ? PLUS_COPY.sent : PLUS_COPY.buy;
  const alert = phase === 'offline' ? PLUS_COPY.offline : phase === 'error' ? PLUS_COPY.error : '';
  return `
    <section class="plus-page">
      <header class="plus-hero">
        <div class="eyebrow">Ближе Plus</div>
        <h1>${PLUS_COPY.title}</h1>
        <p class="plus-lead">${PLUS_COPY.lead}</p>
        <p class="plus-soon">${PLUS_COPY.soon}</p>
      </header>
      <p class="plus-note">${PLUS_COPY.planned}</p>
      <div class="plus-benefits">
        ${PLUS_BENEFITS.map(([title, body]) => `<article class="plus-benefit"><h2>${title}</h2><p>${body}</p></article>`).join('')}
      </div>
      <section class="plus-keep">
        <h2>${PLUS_COPY.keepTitle}</h2>
        <p>${PLUS_COPY.keepBody}</p>
      </section>
      <section class="plus-offer">
        <div class="plus-plans" role="radiogroup" aria-label="Предварительный тариф">
          ${PLUS_PLAN_CHOICES.map((choice) => `<button type="button" class="plus-plan${choice.id === plan ? ' active' : ''}" role="radio" aria-checked="${choice.id === plan ? 'true' : 'false'}" data-plus-plan="${choice.id}" ${locked ? 'disabled' : ''}><b>${choice.label}</b><span>${choice.price}</span></button>`).join('')}
        </div>
        <p class="plus-note">${PLUS_COPY.priceNote}</p>
        ${model.notice ? `<section class="plus-thanks" id="plus-thanks" role="status"><h2>${PLUS_COPY.thanksTitle}</h2><p>${PLUS_COPY.thanksBody}</p><button class="primary" type="button" id="plus-thanks-ok">${PLUS_COPY.thanksOk}</button></section>` : ''}
        ${alert ? `<p class="plus-alert" role="alert">${alert}</p>` : ''}
        <p class="plus-purchase-note" id="plus-purchase-note">${PLUS_COPY.purchaseNote}</p>
        <button class="primary large" type="button" id="plus-cta" aria-describedby="plus-purchase-note" ${locked ? 'disabled aria-disabled="true"' : ''}${sending ? ' aria-busy="true"' : ''}>${label}</button>
      </section>
    </section>`;
}
