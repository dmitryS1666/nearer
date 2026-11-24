export function adminPageHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Ближе — пилот</title>
  <style>
    :root { color-scheme: light; --ink:#241c38; --muted:#6d657f; --line:#e6def3; --violet:#6d4de0; --bg:#f7f4fc; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.45 "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
    main { max-width: 980px; margin: 0 auto; padding: 28px 18px 64px; }
    h1 { font-size: 28px; margin: 0 0 6px; }
    h2 { font-size: 18px; margin: 0 0 10px; }
    p, li { color: var(--muted); }
    form, section { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 16px; margin: 14px 0; }
    label { display: block; font-weight: 700; margin: 10px 0 4px; }
    input, textarea, select, button { font: inherit; }
    input, textarea, select { width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); }
    textarea { min-height: 90px; }
    button { border: 0; border-radius: 999px; padding: 10px 16px; background: var(--violet); color: white; font-weight: 700; cursor: pointer; }
    button.quiet { background: #efeafc; color: var(--violet); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .kpi { background: #faf8ff; border-radius: 14px; padding: 12px; }
    .kpi b { display: block; font-size: 26px; }
    .tabs button { background: transparent; color: var(--ink); }
    .tabs button.on { background: var(--violet); color: white; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td, th { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .warn { color: #8d2d4a; }
    .hidden { display: none; }
  </style>
</head>
<body>
<main>
  <h1>Пилот Ближе</h1>
  <p>Обезличенная активность, отзывы и объявления. Текстов ответов пар здесь нет.</p>
  <form id="login">
    <h2>Вход</h2>
    <label>Логин<input id="username" autocomplete="username" required></label>
    <label>Пароль<input id="password" type="password" autocomplete="current-password" required></label>
    <div class="row"><button type="submit">Войти</button></div>
    <p id="login-error" class="warn"></p>
  </form>
  <div id="app" class="hidden">
    <div class="row tabs">
      <button type="button" data-tab="dash" class="on">Сводка</button>
      <button type="button" data-tab="activity">Активность</button>
      <button type="button" data-tab="versions">Версии</button>
      <button type="button" data-tab="feedback">Отзывы</button>
      <button type="button" data-tab="push">Объявления</button>
      <button type="button" id="logout" class="quiet">Выйти</button>
    </div>
    <section id="tab-dash"></section>
    <section id="tab-activity" class="hidden"></section>
    <section id="tab-versions" class="hidden"></section>
    <section id="tab-feedback" class="hidden"></section>
    <section id="tab-push" class="hidden"></section>
  </div>
</main>
<script>
  let csrf = '';
  const login = document.getElementById('login');
  const app = document.getElementById('app');
  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.body) headers['content-type'] = 'application/json';
    if (csrf && options.method && options.method !== 'GET') headers['x-csrf-token'] = csrf;
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(json.error || 'request_failed'), { status: response.status, json });
    return json;
  }
  function show(name) {
    for (const id of ['dash', 'activity', 'versions', 'feedback', 'push']) {
      document.getElementById('tab-' + id).classList.toggle('hidden', id !== name);
    }
    document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('on', button.dataset.tab === name));
  }
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => show(button.dataset.tab)));
  function kpi(label, value) {
    return '<div class="kpi"><b>' + value + '</b><span>' + label + '</span></div>';
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  async function loadDash() {
    const data = await api('/api/admin/dashboard');
    const pairs = data.technicalPairs || {};
    document.getElementById('tab-dash').innerHTML =
      '<h2>Сводка</h2><div class="grid">' +
      kpi('Установки', data.installs) +
      kpi('Активны 1 день', data.activeInstalls.d1) +
      kpi('Активны 7 дней', data.activeInstalls.d7) +
      kpi('Активны 30 дней', data.activeInstalls.d30) +
      kpi('Пар в связи', pairs.created ?? '—') +
      kpi('Подключённых пар', pairs.linked ?? '—') +
      kpi('Оба начали', data.bothStarted) +
      kpi('Оба ответили', data.bothFinishedFirst) +
      kpi('Активные пары, 7 дней', data.activePairs.d7) +
      kpi('Совместные ритуалы', data.mutualRituals) +
      kpi('Сад начат', data.gardenStarted) +
      kpi('Сад завершён', data.gardenCompleted) +
      kpi('Интерес к Plus', data.plusViewed) +
      kpi('Запросы Plus', data.plusIntent) +
      kpi('Отзывы', data.feedback) +
      '</div><p>' + esc(data.definitions.installs) + '</p><p>' + esc(data.definitions.activePair) + '</p><p>' + esc(data.definitions.consent) + '</p>';
    const versions = Object.entries(data.versions || {}).map(([name, count]) => '<tr><td>' + esc(name) + '</td><td>' + count + '</td></tr>').join('') || '<tr><td colspan="2">Пока нет открытий с согласием</td></tr>';
    document.getElementById('tab-activity').innerHTML = '<h2>Версии по открытиям</h2><table><tr><th>Платформа</th><th>Открытия</th></tr>' + versions + '</table><p>Удержание смотрите на сводке: активные установки за 1, 7 и 30 дней.</p>';
  }
  async function loadVersions() {
    const data = await api('/api/admin/versions');
    const current = data.versions || {};
    document.getElementById('tab-versions').innerHTML =
      '<h2>Опубликованная версия</h2><p>Случайный файл сюда не ставится: нужны https-адрес, SHA-256 и номер сборки.</p>' +
      '<pre>' + esc(JSON.stringify(current, null, 2)) + '</pre>' +
      '<form id="version-form"><label>Платформа<select name="platform"><option value="android">android</option><option value="web">web</option></select></label>' +
      '<label>versionName<input name="versionName" required placeholder="0.2.0"></label>' +
      '<label>versionCode<input name="versionCode" type="number" min="1" required></label>' +
      '<label>Минимальная сборка<input name="minimumSupportedVersionCode" type="number" min="1" value="1"></label>' +
      '<label>Ссылка на APK<input name="downloadUrl" placeholder="https://"></label>' +
      '<label>SHA-256<input name="sha256" placeholder="64 hex"></label>' +
      '<label>Что изменилось<textarea name="releaseNotes"></textarea></label>' +
      '<label><input type="checkbox" name="mandatory" style="width:auto"> Обязательное</label>' +
      '<div class="row"><button type="submit">Опубликовать</button></div><p id="version-msg"></p></form>';
    document.getElementById('version-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      const body = {
        platform: fd.get('platform'),
        versionName: fd.get('versionName'),
        versionCode: Number(fd.get('versionCode')),
        minimumSupportedVersionCode: Number(fd.get('minimumSupportedVersionCode') || 1),
        downloadUrl: fd.get('downloadUrl') || '',
        sha256: String(fd.get('sha256') || '').trim().toLowerCase(),
        releaseNotes: fd.get('releaseNotes') || '',
        mandatory: fd.get('mandatory') === 'on'
      };
      try {
        await api('/api/admin/versions', { method: 'POST', body: JSON.stringify(body) });
        document.getElementById('version-msg').textContent = 'Опубликовано';
        loadVersions();
      } catch (error) {
        document.getElementById('version-msg').textContent = error.message;
      }
    });
  }
  async function loadFeedback() {
    const data = await api('/api/admin/feedback');
    const rows = (data.feedback || []).map((item) => '<tr><td>' + esc(item.createdAt) + '<br>' + esc(item.type) + '<br>' + esc(item.status) + '</td><td>' + esc(item.message) + '<br><small>' + esc(item.appVersion) + ' · ' + esc(item.platform) + ' · ' + esc(item.contact || 'без контакта') + '</small></td><td><select data-status="' + esc(item.id) + '"><option>new</option><option>doing</option><option>done</option></select><textarea data-note="' + esc(item.id) + '" placeholder="Внутренний комментарий">' + esc(item.note || '') + '</textarea><textarea data-reply="' + esc(item.id) + '" placeholder="Ответ, если есть контакт">' + esc(item.reply || '') + '</textarea><button type="button" data-save="' + esc(item.id) + '">Сохранить</button></td></tr>').join('');
    document.getElementById('tab-feedback').innerHTML = '<h2>Отзывы</h2><table><tr><th>Когда</th><th>Текст</th><th>Статус</th></tr>' + (rows || '<tr><td colspan="3">Пока пусто</td></tr>') + '</table>';
    for (const item of data.feedback || []) {
      const select = document.querySelector('[data-status="' + item.id + '"]');
      if (select) select.value = item.status || 'new';
    }
    document.querySelectorAll('[data-save]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.save;
      await api('/api/admin/feedback/' + encodeURIComponent(id), {
        method: 'POST',
        body: JSON.stringify({
          status: document.querySelector('[data-status="' + id + '"]').value,
          note: document.querySelector('[data-note="' + id + '"]').value,
          reply: document.querySelector('[data-reply="' + id + '"]').value
        })
      });
      button.textContent = 'Сохранено';
    }));
  }
  async function loadPush() {
    const data = await api('/api/admin/pushes');
    const rows = (data.broadcasts || []).slice().reverse().map((item) => '<tr><td>' + esc(item.createdAt) + '</td><td>' + esc(item.title) + '<br><small>' + esc(item.audience) + ' · ' + esc(item.kind) + '</small></td><td>' + esc(item.accepted) + ' / ' + esc(item.failed) + '</td></tr>').join('');
    document.getElementById('tab-push').innerHTML =
      '<h2>Объявления</h2><p>' + esc(data.push.status || '') + '</p>' +
      '<form id="push-form"><label>Заголовок<input name="title" required maxlength="80"></label><label>Текст<textarea name="body" required maxlength="240"></textarea></label>' +
      '<label>Экран<select name="screen"><option value="today">Сегодня</option><option value="settings">Настройки</option><option value="garden">Сад</option><option value="packs">Plus</option></select></label>' +
      '<label>Кому<select name="audience"><option value="all">Все</option><option value="android">Android</option><option value="pwa">PWA</option><option value="version">Версия</option></select></label>' +
      '<label>Версия, если выбрана<input name="versionName" placeholder="0.2.0"></label>' +
      '<label>Вид<select name="kind"><option value="product">Обычное</option><option value="technical">Техническое</option></select></label>' +
      '<label>Своя установка для теста<input name="testInstallId" placeholder="install id"></label>' +
      '<label><input type="checkbox" name="confirm" style="width:auto"> Подтверждаю рассылку не тестом</label>' +
      '<div class="row"><button type="submit" name="mode" value="test" class="quiet">Тест на свою установку</button><button type="submit" name="mode" value="all">Отправить выбранным</button></div><p id="push-msg"></p></form>' +
      '<table><tr><th>Когда</th><th>Текст</th><th>Принято / ошибки</th></tr>' + (rows || '<tr><td colspan="3">Рассылок ещё не было</td></tr>') + '</table>';
    document.getElementById('push-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      const mode = event.submitter?.value || 'test';
      try {
        const result = await api('/api/admin/pushes', {
          method: 'POST',
          body: JSON.stringify({
            title: fd.get('title'),
            body: fd.get('body'),
            screen: fd.get('screen'),
            audience: fd.get('audience'),
            versionName: fd.get('versionName') || '',
            kind: fd.get('kind'),
            testInstallId: fd.get('testInstallId') || '',
            confirm: fd.get('confirm') === 'on',
            test: mode === 'test'
          })
        });
        document.getElementById('push-msg').textContent = 'Принято провайдером: ' + result.accepted + ', ошибок: ' + result.failed + '. Это не значит, что уведомление прочитано.';
        loadPush();
      } catch (error) {
        document.getElementById('push-msg').textContent = error.message;
      }
    });
  }
  async function openApp() {
    login.classList.add('hidden');
    app.classList.remove('hidden');
    await loadDash();
    await loadVersions();
    await loadFeedback();
    await loadPush();
  }
  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    document.getElementById('login-error').textContent = '';
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value }) });
      csrf = result.csrf;
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
      await openApp();
    } catch (error) {
      document.getElementById('login-error').textContent = error.message === 'rate_limited' ? 'Слишком много попыток' : 'Не удалось войти';
    }
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    csrf = '';
    app.classList.add('hidden');
    login.classList.remove('hidden');
  });
  api('/api/admin/session').then((session) => {
    if (!session.authenticated) return;
    csrf = session.csrf;
    openApp();
  }).catch(() => {});
</script>
</body>
</html>`;
}
