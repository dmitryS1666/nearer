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
  if (error?.code === 'rate_limited') return 'Слишком много попыток. Подождите немного.';
  if (error?.code === 'code_invalid') return 'Код не подошёл или уже истёк.';
  if (error?.code === 'unauthorized') return 'Связь с этого телефона уже не действует.';
  if (error?.code === 'public_key_required' || error?.code === 'crypto_unavailable') {
    return 'Этот телефон не может установить защищённую связь.';
  }
  if (error?.code === 'decrypt_failed') return 'Не удалось расшифровать данные пары. Пересоздайте связь.';
  if (error?.code === 'sync_circle_mismatch') {
    return 'Снимок синхронизации принадлежит другой паре. Локальный архив не изменён; сервер не перезаписан.';
  }
  if (error?.code === 'sync_conflict') return 'Синхронизация не успела. Попробуйте ещё раз.';
  if (error?.code === 'client_outdated') {
    return 'Партнёр уже на новой версии. Обновите приложение, чтобы синхронизировать сад.';
  }
  if (error?.code === 'too_large') return 'Слишком много данных для синхронизации (уберите тяжёлые фото с телефона).';
  return 'Сервер связи сейчас недоступен. Ответы на телефоне в безопасности.';
}
