async function pairRequest(path, { method = 'GET', token = '', body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
    error.status = response.status;
    error.payload = json;
    throw error;
  }
  return json;
}

export function createPair(publicKey) {
  return pairRequest('api/pairs', { method: 'POST', body: { publicKey } });
}

export function joinPair(code, publicKey) {
  return pairRequest('api/pairs/join', { method: 'POST', body: { code, publicKey } });
}

export function fetchPairStatus(token) {
  return pairRequest('api/pairs/me', { token });
}

export function leavePair(token) {
  return pairRequest('api/pairs/me', { method: 'DELETE', token });
}

export function fetchPairSync(token) {
  return pairRequest('api/pairs/sync', { token });
}

export function putPairSync(token, body) {
  return pairRequest('api/pairs/sync', { method: 'PUT', token, body });
}

export function pairErrorCopy(error) {
  if (error?.code === 'rate_limited') return 'Слишком много попыток подряд. Подождите чуть-чуть.';
  if (error?.code === 'code_invalid') return 'Код не подошёл или уже просрочен.';
  if (error?.code === 'unauthorized') return 'Связь с этого телефона уже не действует.';
  if (error?.code === 'public_key_required' || error?.code === 'crypto_unavailable') {
    return 'На этом телефоне защищённую связь сейчас не собрать.';
  }
  if (error?.code === 'decrypt_failed') return 'Не получилось прочитать данные пары. Свяжитесь заново.';
  if (error?.code === 'sync_circle_mismatch') {
    return 'Пришли данные другой пары. У вас на телефоне ничего не трогали, сервер тоже не перезаписывали.';
  }
  if (error?.code === 'sync_conflict') return 'Не успели обновиться. Попробуйте ещё раз.';
  if (error?.code === 'client_outdated') {
    return 'У партнёра уже новая версия. Обновите приложение, чтобы сад снова сходился.';
  }
  if (error?.code === 'too_large') return 'Слишком много данных для обновления — уберите тяжёлые фото с телефона.';
  return 'Связь сейчас недоступна. Ответы на телефоне на месте.';
}
