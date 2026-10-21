import { detectStore } from '../metadata/stores.js';
import { isWfolioUrl } from '../../integrations/wfolio/wfolio.js';

/**
 * IncomingShareHandler
 *
 * PWA: Web Share Target opens /?screen=share&url=&title=&text=
 * Capacitor: a future iOS Share Extension or Android intent should deliver
 * the same { url, title, text } payload into handle().
 * Native share extensions are not bundled in this PWA pass.
 */
const PLACE_HOSTS = [/google\.[a-z.]+\/maps/i, /maps\.google\./i, /yandex\.[a-z.]+\/maps/i, /(^|\.)2gis\./i, /tripadvisor\./i, /(^|\.)zoon\./i];
const FILM_HOSTS = [/kinopoisk\.ru/i, /(^|\.)imdb\.com/i, /letterboxd\.com/i, /(^|\.)ivi\.ru/i, /(^|\.)okko\.tv/i];
const TRIP_HOSTS = [/aviasales\./i, /(^|\.)tutu\.ru/i, /booking\.com/i, /ostrovok\.ru/i, /airbnb\./i];

export function extractFirstUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return '';
  return match[0].replace(/[),.;]+$/, '');
}

export function classifyShare({ url, title, text } = {}) {
  const resolved = extractFirstUrl(url) || extractFirstUrl(text) || extractFirstUrl(title);
  const haystack = `${resolved} ${title || ''} ${text || ''}`;
  if (resolved && isWfolioUrl(resolved)) {
    return { url: resolved, title: title || '', text: text || '', kind: 'gallery', listType: null, suggestMoment: true };
  }
  if (resolved && detectStore(resolved)) {
    return { url: resolved, title: title || '', text: text || '', kind: 'product', listType: 'wishlist', suggestMoment: false };
  }
  if (PLACE_HOSTS.some((pattern) => pattern.test(haystack))) {
    return { url: resolved, title: title || '', text: text || '', kind: 'place', listType: 'places', suggestMoment: false };
  }
  if (FILM_HOSTS.some((pattern) => pattern.test(haystack))) {
    return { url: resolved, title: title || '', text: text || '', kind: 'film', listType: 'watch', suggestMoment: false };
  }
  if (TRIP_HOSTS.some((pattern) => pattern.test(haystack))) {
    return { url: resolved, title: title || '', text: text || '', kind: 'trip', listType: 'trips', suggestMoment: false };
  }
  return { url: resolved, title: title || '', text: text || '', kind: 'link', listType: null, suggestMoment: false };
}

export class IncomingShareHandler {
  constructor({ getLists } = {}) {
    this.getLists = getLists || (() => []);
  }

  handle(payload = {}) {
    const classification = classifyShare(payload);
    const lists = this.getLists() || [];
    const list = classification.listType ? lists.find((item) => item.type === classification.listType) || null : null;
    return {
      ...classification,
      listId: list?.id || null,
      listName: list?.name || '',
      listIcon: list?.icon || ''
    };
  }
}
