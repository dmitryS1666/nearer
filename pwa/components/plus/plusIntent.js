import { PLUS_COPY } from './plusCopy.js';

export function plusIntentPayload(input) {
  return {
    plan: input?.plan,
    source: input?.source,
    requestId: input?.requestId
  };
}

export async function postPlusIntent(input, { fetchImpl = fetch, online = () => navigator.onLine } = {}) {
  if (online() === false) {
    const error = new Error('offline');
    error.code = 'offline';
    throw error;
  }
  let response;
  try {
    response = await fetchImpl('/api/plus/intent', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-blizhe-intent': '1'
      },
      body: JSON.stringify(plusIntentPayload(input)),
      cache: 'no-store'
    });
  } catch {
    const error = new Error('offline');
    error.code = 'offline';
    throw error;
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || 'request_failed');
    error.code = json.error || 'request_failed';
    throw error;
  }
  return json;
}

function knownSource(source) {
  return source === 'settings' || source === 'ours' || source === 'other' ? source : 'other';
}

export function createPlusIntentController({
  post,
  online = () => true,
  uuid = () => crypto.randomUUID(),
  initial = null
} = {}) {
  const restored = initial?.phase === 'sent' && initial.requestId;
  const model = {
    plan: initial?.plan === 'year' ? 'year' : 'month',
    phase: restored ? 'sent' : 'idle',
    error: '',
    requestId: restored ? initial.requestId : null,
    notice: false
  };

  function snapshot() {
    return { ...model };
  }

  return {
    snapshot,
    selectPlan(plan) {
      if (model.phase === 'sending' || model.phase === 'sent') return snapshot();
      if (plan !== 'month' && plan !== 'year') return snapshot();
      if (plan !== model.plan) model.requestId = null;
      model.plan = plan;
      return snapshot();
    },
    dismissNotice() {
      model.notice = false;
      return snapshot();
    },
    startSubmit() {
      if (model.phase === 'sending' || model.phase === 'sent') return 'blocked';
      if (!model.requestId) model.requestId = uuid();
      model.notice = false;
      if (online() === false) {
        model.phase = 'offline';
        model.error = PLUS_COPY.offline;
        return 'offline';
      }
      model.phase = 'sending';
      model.error = '';
      return 'started';
    },
    async finishSubmit(source) {
      try {
        await post(plusIntentPayload({
          plan: model.plan,
          source: knownSource(source),
          requestId: model.requestId
        }));
        model.phase = 'sent';
        model.notice = true;
        model.error = '';
      } catch (error) {
        if (error?.code === 'offline') {
          model.phase = 'offline';
          model.error = PLUS_COPY.offline;
        } else {
          model.phase = 'error';
          model.error = PLUS_COPY.error;
        }
      }
      return snapshot();
    }
  };
}
