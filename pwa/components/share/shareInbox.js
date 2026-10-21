import { escapeHtml, safeHttpUrl } from '../../ui/escapeHtml.js';
import { createListItem } from '../../domain/lists/model.js';
import { applyProductMetadata, normalizeWishPatch } from '../../domain/wishlist/model.js';
import { isWfolioUrl } from '../../integrations/wfolio/wfolio.js';

export function renderShare(ctx) {
  const incoming = ctx.shareHandler.handle({
    url: ctx.route.shareUrl,
    title: ctx.route.shareTitle,
    text: ctx.route.shareText
  });
  const lists = ctx.state.lists || [];
  return `
    <section class="page-head">
      <div class="dashboard-copy">
        <div class="eyebrow">Поделиться в Ближе</div>
        <h1>${incoming.suggestMoment ? 'Галерея для момента' : 'Куда сохранить?'}</h1>
        <p>${incoming.url ? escapeHtml(incoming.title || incoming.url) : 'Вставьте ссылку — подскажем список.'}</p>
      </div>
    </section>
    <form id="share-form" class="settings-card">
      <label class="setting-field">Ссылка<input name="url" value="${escapeHtml(incoming.url || '')}" placeholder="https://"></label>
      <label class="setting-field">Название<input name="title" value="${escapeHtml(incoming.title || '')}" maxlength="180"></label>
      <div class="chip-row" id="share-lists">
        ${lists.map((list) => `<label class="chip-check"><input type="radio" name="listId" value="${escapeHtml(list.id)}" ${list.id === incoming.listId ? 'checked' : ''}>${escapeHtml(list.icon)} ${escapeHtml(list.name)}</label>`).join('')}
        <label class="chip-check"><input type="radio" name="listId" value="moment" ${incoming.suggestMoment ? 'checked' : ''}>❤️ Новый момент</label>
      </div>
      <p class="microcopy" id="share-status">${hint(incoming)}</p>
      <button class="primary" type="submit">Сохранить</button>
    </form>`;
}

export function bindShare(ctx) {
  document.getElementById('share-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const url = String(data.get('url') || '').trim();
    const title = String(data.get('title') || '').trim();
    const listId = String(data.get('listId') || '');
    const status = document.getElementById('share-status');
    if (listId === 'moment' || isWfolioUrl(url)) {
      let pending = null;
      if (url && isWfolioUrl(url)) {
        if (status) status.textContent = 'Смотрим галерею…';
        try { pending = await ctx.wfolio.importMedia({ galleryUrl: url }); } catch { pending = null; }
      }
      ctx.ui.momentDraft = { title: title || pending?.metadata?.title || 'Новый момент', description: '', coverImage: pending?.previewUrl || '' };
      ctx.ui.pendingMedia = pending ? [{ ...pending, id: `pending-${Date.now()}` }] : [];
      ctx.ui.armDraft = true;
      ctx.nav('moment', { momentId: 'new' });
      return;
    }
    const list = (ctx.state.lists || []).find((item) => item.id === listId);
    if (!list) return ctx.toast('Выберите список', 'warn');
    let meta = null;
    if (url && list.type === 'wishlist') {
      if (status) status.textContent = 'Получаем информацию о товаре…';
      try { meta = await ctx.metadataProvider.fetch(url); } catch { meta = null; }
    }
    const patch = applyProductMetadata(normalizeWishPatch({
      title: title || meta?.title || url || 'Ссылка',
      url,
      description: meta?.description || ''
    }), meta);
    const item = createListItem(ctx.state, { ...patch, listId: list.id, title: patch.title || title || 'Ссылка' }, { actorRole: ctx.role });
    if (!item) return ctx.toast('Не удалось сохранить', 'warn');
    await ctx.commit();
    ctx.toast(`Добавили в «${list.name}»`);
    ctx.nav('list', { listId: list.id });
  });
  const href = safeHttpUrl(ctx.route.shareUrl || '');
  if (href) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'ghost share-open';
    link.textContent = 'Открыть ссылку';
    document.getElementById('share-form')?.appendChild(link);
  }
}

function hint(incoming) {
  if (incoming.suggestMoment) return 'Похоже на галерею Wfolio. Её можно прикрепить к моменту.';
  if (incoming.listName) return `Предлагаем список «${incoming.listName}». Можно выбрать другой.`;
  if (!incoming.url) return 'Ссылки пока нет — вставьте её вручную.';
  return 'Сохраните ссылку в подходящий список.';
}
