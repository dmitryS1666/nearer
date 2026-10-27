import { createId } from '../ids.js';
import { newEntity, touch } from '../syncMeta.js';
import { getMoment } from '../moments/model.js';
import { currentCircleId } from '../garden/ownership.js';

export const PHOTO_STORAGE_MODES = ['links', 'preview', 'original'];
export const MEDIA_PROVIDERS = ['local', 'wfolio', 'external'];
export const MEDIA_TYPES = ['image', 'video', 'gallery'];

export function normalizePhotoStorage(mode) {
  return PHOTO_STORAGE_MODES.includes(mode) ? mode : 'preview';
}

export function setPhotoStorage(state, mode) {
  state.photoStorage = normalizePhotoStorage(mode);
  return state.photoStorage;
}

export function mediaForMoment(state, momentId) {
  return (state.mediaAttachments || []).filter((media) => media.momentId === momentId);
}

export function attachMedia(state, momentId, input, { now = new Date().toISOString(), idFactory = createId } = {}) {
  const moment = getMoment(state, momentId);
  if (!moment || !input) return null;
  if (!Array.isArray(state.mediaAttachments)) state.mediaAttachments = [];
  const media = newEntity(
    {
      id: idFactory(),
      circleId: moment.circleId || currentCircleId(state) || state.circleId || null,
      momentId,
      type: MEDIA_TYPES.includes(input.type) ? input.type : 'image',
      provider: MEDIA_PROVIDERS.includes(input.provider) ? input.provider : 'external',
      providerId: input.providerId || null,
      sourceUrl: input.sourceUrl || '',
      previewUrl: input.previewUrl || '',
      width: input.width || null,
      height: input.height || null,
      takenAt: input.takenAt || null,
      metadata: { ...(input.metadata || {}) }
    },
    now
  );
  state.mediaAttachments.push(media);
  if (!Array.isArray(moment.media)) moment.media = [];
  moment.media.push(media.id);
  if (!moment.coverImage) moment.coverImage = media.previewUrl || media.metadata?.cover || media.sourceUrl || '';
  touch(moment, now);
  return media;
}

export function removeMedia(state, mediaId, { now = new Date().toISOString() } = {}) {
  const media = (state.mediaAttachments || []).find((item) => item.id === mediaId);
  if (!media) return false;
  state.mediaAttachments = state.mediaAttachments.filter((item) => item.id !== mediaId);
  const moment = getMoment(state, media.momentId);
  if (moment) {
    moment.media = (moment.media || []).filter((id) => id !== mediaId);
    if (moment.coverImage && (moment.coverImage === media.previewUrl || moment.coverImage === media.sourceUrl)) {
      const next = mediaForMoment(state, moment.id)[0];
      moment.coverImage = next?.previewUrl || next?.metadata?.cover || next?.sourceUrl || '';
    }
    touch(moment, now);
  }
  return true;
}

export function setCoverFromMedia(state, momentId, mediaId, now = new Date().toISOString()) {
  const moment = getMoment(state, momentId);
  const media = (state.mediaAttachments || []).find((item) => item.id === mediaId && item.momentId === momentId);
  if (!moment || !media) return null;
  moment.coverImage = media.previewUrl || media.metadata?.cover || media.metadata?.thumbnail || media.sourceUrl || '';
  touch(moment, now);
  return moment;
}

/**
 * Local phone photos are stored according to the explicit strategy.
 * "links" keeps external galleries only — phone originals are not written.
 */
export function buildLocalAttachmentInput({ variants, mode, takenAt = null }) {
  const storage = normalizePhotoStorage(mode);
  if (storage === 'links') return { error: 'links_mode' };
  if (!variants?.previewUrl && !variants?.thumbnail) return { error: 'empty' };
  const metadata = {};
  if (variants.thumbnail) metadata.thumbnail = variants.thumbnail;
  if (storage === 'original' && variants.originalDataUrl) metadata.originalDataUrl = variants.originalDataUrl;
  return {
    type: 'image',
    provider: 'local',
    sourceUrl: '',
    previewUrl: variants.previewUrl || variants.thumbnail || '',
    width: variants.width || null,
    height: variants.height || null,
    takenAt,
    metadata
  };
}

export function dataUrlBytes(value) {
  if (!value || typeof value !== 'string') return 0;
  const comma = value.indexOf(',');
  if (!value.startsWith('data:') || comma === -1) return 0;
  const payload = value.slice(comma + 1).replace(/\s/g, '');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function estimatePhotoBytes(state) {
  let bytes = 0;
  for (const media of state.mediaAttachments || []) {
    bytes += dataUrlBytes(media.previewUrl);
    bytes += dataUrlBytes(media.metadata?.thumbnail);
    bytes += dataUrlBytes(media.metadata?.originalDataUrl);
  }
  return bytes;
}

export function formatStorage(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return '0 МБ';
  const mb = size / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} МБ`;
}

/** Drops local photo bytes. Moments, titles and external links stay. */
export function clearLocalPhotoCache(state, now = new Date().toISOString()) {
  const before = estimatePhotoBytes(state);
  for (const media of state.mediaAttachments || []) {
    if (media.provider !== 'local') continue;
    media.previewUrl = '';
    media.metadata = { ...(media.metadata || {}), cacheCleared: true };
    delete media.metadata.thumbnail;
    delete media.metadata.originalDataUrl;
    touch(media, now);
  }
  for (const moment of state.moments || []) {
    const still = (moment.coverImage || '').startsWith('data:');
    if (!still) continue;
    const next = (state.mediaAttachments || []).find((media) => media.momentId === moment.id && (media.previewUrl || media.sourceUrl || media.metadata?.cover));
    moment.coverImage = next?.previewUrl || next?.metadata?.cover || next?.sourceUrl || '';
    touch(moment, now);
  }
  return { freed: Math.max(0, before - estimatePhotoBytes(state)), used: estimatePhotoBytes(state) };
}
