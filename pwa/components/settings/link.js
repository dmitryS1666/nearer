import { escapeHtml } from '../../ui/escapeHtml.js';
import { canSync } from '../../domain/sync/coupleSync.js';

function formatCode(code) {
  const clean = String(code || '').replace(/[^A-Za-z0-9]/g, '');
  if (clean.length < 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}

function syncLabel(link) {
  if (!canSync(link)) return '';
  if (link.syncError) {
    return `<p class="microcopy">Не удалось обновить — на телефоне всё на месте. Можно нажать «Обновить» ещё раз.</p>`;
  }
  if (link.lastSyncAt) {
    const when = new Date(link.lastSyncAt).toLocaleString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short'
    });
    return `<p class="microcopy">Обновлялись: ${escapeHtml(when)}</p>`;
  }
  return `<p class="microcopy">Связь есть. Данные шифруются на ваших телефонах.</p>`;
}

export function renderDeviceLink(state) {
  const link = state.deviceLink || {};
  const waiting = link.status === 'waiting' && link.inviteCode;
  const linked = link.status === 'linked';
  return `
    <section class="settings-card" id="settings-link">
      <h2>Два телефона</h2>
      <p>На сервере лежит только зашифрованный снимок. Ключ — у вас на телефонах, чужие ответы отсюда не прочитать.</p>
      ${linked ? `<p><b>Телефоны связаны.</b> Списки, моменты и ответы подтягиваются друг к другу.</p>${syncLabel(link)}` : ''}
      ${waiting ? `<p class="microcopy">Покажите код на втором телефоне. Он действует до ${escapeHtml(new Date(link.inviteExpiresAt).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }))}.</p><div class="pair-code">${escapeHtml(formatCode(link.inviteCode))}</div>` : ''}
      ${linked || waiting ? '' : `
        <label class="setting-field">Код с другого телефона
          <input id="pair-code" inputmode="text" autocomplete="off" maxlength="7" placeholder="ABC-DEF">
        </label>`}
      <div class="button-row wrap">
        ${linked ? `<button class="secondary" id="pair-sync-now" type="button">Обновить</button>` : waiting ? `<button class="secondary" id="pair-refresh" type="button">Проверить</button>` : `<button class="primary" id="pair-create" type="button">Создать код</button><button class="secondary" id="pair-join" type="button">Присоединиться</button>`}
        ${linked || waiting ? `<button class="danger" id="pair-leave" type="button">Отвязать</button>` : ''}
      </div>
    </section>`;
}

export function renderLocalBackup() {
  return `
    <section class="settings-card">
      <h2>Копия содержимого</h2>
      <p>Файл вернёт ответы, сад, списки и моменты. Ключи связи в обычную копию не попадают — для них нужен отдельный recovery-файл.</p>
      <div class="button-row wrap">
        <button class="secondary" id="backup-download" type="button">Скачать копию</button>
        <button class="secondary" id="backup-restore" type="button">Вернуть из файла</button>
      </div>
      <input id="backup-file" type="file" accept="application/json,.json" hidden>
    </section>`;
}

export function renderPairRecovery(state) {
  const linked = state.deviceLink?.status === 'linked' || state.deviceLink?.status === 'waiting';
  return `
    <section class="settings-card" id="settings-recovery">
      <h2>Восстановление связи</h2>
      <p>Отдельный файл с паролем хранит ключи пары. Без него при смене телефона придётся связаться заново. Если пропали оба телефона и оба файла — вернуть данные уже нельзя.</p>
      <label class="setting-field">Пароль для recovery (мин. 8 символов)
        <input id="recovery-passphrase" type="password" autocomplete="new-password" minlength="8" placeholder="••••••••">
      </label>
      <div class="button-row wrap">
        <button class="secondary" id="recovery-download" type="button" ${linked ? '' : 'disabled'}>Скачать recovery</button>
        <button class="secondary" id="recovery-restore" type="button">Восстановить связь из файла</button>
      </div>
      <input id="recovery-file" type="file" accept="application/json,.json" hidden>
      <p class="microcopy">Копия — про содержание. Recovery — про связь. Не держите оба файла в одном открытом чате.</p>
    </section>`;
}
