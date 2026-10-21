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
    throw error;
  }
  return json;
}

export function createPair() {
  return pairRequest('api/pairs', { method: 'POST', body: {} });
}

export function joinPair(code) {
  return pairRequest('api/pairs/join', { method: 'POST', body: { code } });
}

export function fetchPairStatus(token) {
  return pairRequest('api/pairs/me', { token });
}

export function leavePair(token) {
  return pairRequest('api/pairs/me', { method: 'DELETE', token });
}

export function pairErrorCopy(error) {
  if (error?.code === 'rate_limited') return 'Слишком много попыток. Подождите немного.';
  if (error?.code === 'code_invalid') return 'Код не подошёл или уже истёк.';
  if (error?.code === 'unauthorized') return 'Связь с этого телефона уже не действует.';
  return 'Сервер связи сейчас недоступен. Ответы на телефоне в безопасности.';
}
