/** Server-owned Plus intent catalogue. The client cannot set the price. */
export const PLUS_PLANS = {
  month: { id: 'month', label: 'Месяц', amount: '9.90', display: '9,90 BYN', currency: 'BYN' },
  year: { id: 'year', label: 'Год', amount: '79', display: '79 BYN', currency: 'BYN' }
};

export const PLUS_SOURCES = {
  settings: 'настройки',
  ours: 'наше',
  other: 'другое'
};

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePlusIntent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_json' };
  if (!Object.prototype.hasOwnProperty.call(PLUS_PLANS, body.plan)) return { error: 'invalid_plan' };
  if (!Object.prototype.hasOwnProperty.call(PLUS_SOURCES, body.source)) return { error: 'invalid_source' };
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!REQUEST_ID_RE.test(requestId)) return { error: 'invalid_request' };
  return { plan: body.plan, source: body.source, requestId };
}

export function formatPlusTime(date) {
  const timeZone = 'Europe/Minsk';
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset'
  }).format(date);
  return `${formatted} (${timeZone})`;
}

export function buildPlusIntentMessage({ plan, source, requestId, at }) {
  const tariff = PLUS_PLANS[plan];
  const text = [
    `Тариф: ${tariff.label}`,
    `Предварительная цена: ${tariff.display}`,
    `Валюта: ${tariff.currency}`,
    `Дата и время: ${formatPlusTime(at)}`,
    `Источник: ${PLUS_SOURCES[source]}`,
    `Идентификатор запроса: ${requestId}`
  ].join('\n');
  return {
    subject: 'Ближе Plus — намерение покупки',
    text,
    requestId
  };
}
