import { escapeHtml } from '../../ui/escapeHtml.js';

export function renderFeedbackForm(draft = {}) {
  const type = draft.type || 'bug';
  return `
    <section class="settings-card" id="feedback-card">
      <h2>Отзыв</h2>
      <p>Напишите, что случилось. Тексты ответов и воспоминания сами не прикладываются.</p>
      <form id="feedback-form">
        <label class="setting-field">Тип
          <select id="feedback-type" name="type">
            <option value="bug" ${type === 'bug' ? 'selected' : ''}>Ошибка</option>
            <option value="idea" ${type === 'idea' ? 'selected' : ''}>Предложение</option>
            <option value="impression" ${type === 'impression' ? 'selected' : ''}>Впечатление</option>
            <option value="other" ${type === 'other' ? 'selected' : ''}>Другое</option>
          </select>
        </label>
        <label class="setting-field">Сообщение
          <textarea id="feedback-text" name="message" maxlength="4000" rows="5" required placeholder="Что произошло?">${escapeHtml(draft.message || '')}</textarea>
        </label>
        <label class="setting-field">Удобство, если хотите
          <select id="feedback-rating" name="rating">
            <option value="">Не оценивать</option>
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(draft.rating || '') === String(n) ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label class="setting-field">Почта для ответа, если нужна
          <input id="feedback-contact" name="contact" type="email" maxlength="120" value="${escapeHtml(draft.contact || '')}" placeholder="you@example.com">
        </label>
        <label class="toggle-row"><span><b>Можно отправить этот отзыв</b><small>Версия приложения, платформа и анонимный номер установки уйдут вместе с текстом.</small></span><input id="feedback-consent" type="checkbox" ${draft.consent ? 'checked' : ''}><i></i></label>
        <button class="primary" type="submit">Отправить отзыв</button>
      </form>
    </section>`;
}
