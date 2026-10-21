import { escapeHtml } from '../../ui/escapeHtml.js';

function formatCode(code) {
  const clean = String(code || '').replace(/[^A-Za-z0-9]/g, '');
  if (clean.length < 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}

export function renderDeviceLink(state) {
  const link = state.deviceLink || {};
  const waiting = link.status === 'waiting' && link.inviteCode;
  const linked = link.status === 'linked';
  return `
    <section class="settings-card" id="settings-link">
      <h2>Два телефона</h2>
      <p>Сервер запоминает только то, что это одна пара. Ответы, моменты и сад остаются на этом телефоне.</p>
      ${linked ? `<p><b>Телефоны связаны.</b> История по-прежнему хранится здесь.</p>` : ''}
      ${waiting ? `<p class="microcopy">Покажите код на втором телефоне. Он действует до ${escapeHtml(new Date(link.inviteExpiresAt).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }))}.</p><div class="pair-code">${escapeHtml(formatCode(link.inviteCode))}</div>` : ''}
      ${linked || waiting ? '' : `
        <label class="setting-field">Код с другого телефона
          <input id="pair-code" inputmode="text" autocomplete="off" maxlength="7" placeholder="ABC-DEF">
        </label>`}
      <div class="button-row wrap">
        ${linked ? '' : waiting ? `<button class="secondary" id="pair-refresh" type="button">Проверить</button>` : `<button class="primary" id="pair-create" type="button">Создать код</button><button class="secondary" id="pair-join" type="button">Присоединиться</button>`}
        ${linked || waiting ? `<button class="danger" id="pair-leave" type="button">Отвязать</button>` : ''}
      </div>
    </section>`;
}

export function renderLocalBackup() {
  return `
    <section class="settings-card">
      <h2>Копия перед обновлением</h2>
      <p>Обновление приложения на том же адресе не стирает ответы: они лежат в памяти телефона, а не в кэше. Файл копии пригодится, если телефон сменят.</p>
      <div class="button-row wrap">
        <button class="secondary" id="backup-download" type="button">Скачать копию</button>
        <button class="secondary" id="backup-restore" type="button">Вернуть из файла</button>
      </div>
      <input id="backup-file" type="file" accept="application/json,.json" hidden>
    </section>`;
}
