const STORES = [
  { id: 'wildberries', name: 'Wildberries', domain: 'wildberries.ru', test: /(^|\.)wildberries\.ru$/i },
  { id: 'ozon', name: 'Ozon', domain: 'ozon.ru', test: /(^|\.)ozon\.ru$/i },
  { id: 'goldapple', name: 'Золотое Яблоко', domain: 'goldapple.ru', test: /(^|\.)goldapple\.ru$/i },
  { id: 'lamoda', name: 'Lamoda', domain: 'lamoda.ru', test: /(^|\.)lamoda\.ru$/i },
  { id: 'yandex-market', name: 'Яндекс Маркет', domain: 'market.yandex.ru', test: /(^|\.)market\.yandex\.ru$/i }
];

export function detectStore(rawUrl) {
  let host = '';
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch { return null; }
  return STORES.find((store) => store.test.test(host)) || null;
}

export function wildberriesNm(rawUrl) {
  const match = String(rawUrl || '').match(/\/catalog\/(\d+)/i);
  return match ? match[1] : null;
}
