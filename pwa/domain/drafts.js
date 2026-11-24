/**
 * Local answer drafts. Never included in the E2E pair payload.
 * Writes are ordered per key so an older put cannot land after a newer one.
 * A late read cannot replace text typed while that read was in flight.
 */

export const ANSWER_FIELD_IDS = ['answer-text', 'period-answer-text'];

export function draftKey({ circleId, role, periodId, questionId } = {}) {
  const circle = safeToken(circleId || 'solo');
  const who = role === 'b' ? 'b' : 'a';
  const period = safeToken(periodId || 'daily');
  const question = safeToken(questionId || 'day');
  return `draft:${circle}:${who}:${period}:${question}`;
}

/** 0.1.0 daily drafts: `draft-${circle}-${role}-${day}`. */
export function legacyDailyDraftKey(circleId, role, dayKey) {
  const who = role === 'b' ? 'b' : 'a';
  return `draft-${circleId || 'solo'}-${who}-${dayKey || ''}`;
}

export function backgroundRenderWouldDismissKeyboard(activeElementId) {
  return ANSWER_FIELD_IDS.includes(activeElementId);
}

function safeToken(value) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return clean || 'x';
}

export function createDraftController({ getValue, setValue }) {
  const memory = new Map();
  const chains = new Map();
  let ticketSeq = 0;

  function ticket(key) {
    return memory.get(key)?.ticket || 0;
  }

  function remember(key, value) {
    const ticketNo = ++ticketSeq;
    memory.set(key, { value: value == null ? '' : String(value), ticket: ticketNo });
    const prev = chains.get(key) || Promise.resolve();
    const job = prev
      .catch(() => {})
      .then(async () => {
        const current = memory.get(key);
        if (!current || current.ticket !== ticketNo) return;
        await setValue(key, current.value);
      });
    const settled = job.catch(() => {});
    chains.set(key, settled);
    return ticketNo;
  }

  async function load(key, { legacyKey } = {}) {
    const seen = ticket(key);
    let stored = await getValue(key, '');
    if ((stored == null || stored === '') && legacyKey) {
      stored = await getValue(legacyKey, '');
    }
    const current = memory.get(key);
    if (current && current.ticket !== seen) {
      return { value: current.value, superseded: true };
    }
    if (current && current.ticket > 0) {
      return { value: current.value, superseded: false };
    }
    return { value: stored == null ? '' : String(stored), superseded: false };
  }

  function flush(key) {
    return chains.get(key) || Promise.resolve();
  }

  function flushAll() {
    return Promise.all([...chains.values()].map((job) => job.catch(() => {})));
  }

  return { remember, load, ticket, flush, flushAll };
}
