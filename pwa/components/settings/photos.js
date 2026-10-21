import { escapeHtml } from '../../ui/escapeHtml.js';
import { estimatePhotoBytes, formatStorage, PHOTO_STORAGE_MODES } from '../../domain/media/model.js';

const OPTIONS = [
  ['links', 'Только ссылки на внешние фото'],
  ['preview', 'Хранить превью'],
  ['original', 'Хранить оригиналы']
];

export function renderPhotoSettings(state) {
  const mode = PHOTO_STORAGE_MODES.includes(state.photoStorage) ? state.photoStorage : 'preview';
  const used = formatStorage(estimatePhotoBytes(state));
  return `<section class="settings-card" id="settings-photos">
    <h2>Фото и память</h2>
    <p class="muted">Моменты не удаляются, если очистить локальный кэш фотографий.</p>
    ${OPTIONS.map(([id, label]) => `<label class="toggle-row photo-choice"><span><b>${label}</b></span><input type="radio" name="photo-storage" value="${id}" ${mode === id ? 'checked' : ''}><i></i></label>`).join('')}
    <p class="storage-used">Использовано приложением: <b>${escapeHtml(used)}</b></p>
    <button class="secondary" type="button" id="clear-photo-cache">Очистить локальный кэш фотографий</button>
  </section>`;
}
