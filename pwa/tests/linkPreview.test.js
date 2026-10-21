import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeMetadata,
  fromWildberriesProduct,
  fromOzonHtml,
  fromGoldenAppleHtml,
  isPrivateAddress,
  previewLink,
  handleLinkPreviewRequest,
  metadataFromHtml
} from '../../server/linkPreview.js';

const PUBLIC_LOOKUP = async () => [{ address: '8.8.8.8', family: 4 }];

function htmlResponse(body, { status = 200, type = 'text/html; charset=utf-8', headers = {} } = {}) {
  const bag = { 'content-type': type, ...headers };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => bag[String(name).toLowerCase()] ?? null },
    async text() { return body; }
  };
}

describe('metadata parsers', () => {
  it('prefers JSON-LD and fills gaps from Open Graph', () => {
    const html = `
      <meta property="og:title" content="Из Open Graph">
      <meta property="og:image" content="https://cdn.example/cup.jpg">
      <script type="application/ld+json">
        {"@type":"Product","name":"Кружка","description":"Тёплая","offers":{"price":"12990","priceCurrency":"RUB","highPrice":"15990"},"image":"https://cdn.example/ld.jpg"}
      </script>`;
    const meta = metadataFromHtml(html, 'https://shop.example/cup');
    assert.equal(meta.title, 'Кружка');
    assert.equal(meta.imageUrl, 'https://cdn.example/ld.jpg');
    assert.equal(meta.price, 12990);
    assert.equal(meta.oldPrice, 15990);
    assert.equal(meta.currency, 'RUB');
    assert.equal(meta.source, 'json-ld');
  });

  it('falls back to Open Graph when there is no product schema', () => {
    const html = `
      <meta property="og:title" content="Свеча">
      <meta property="og:description" content="Для вечера">
      <meta property="product:price:amount" content="890">
      <meta property="product:price:currency" content="rub">`;
    const meta = metadataFromHtml(html, 'https://shop.example/candle');
    assert.equal(meta.title, 'Свеча');
    assert.equal(meta.description, 'Для вечера');
    assert.equal(meta.price, 890);
    assert.equal(meta.currency, 'RUB');
    assert.equal(meta.source, 'opengraph');
  });

  it('uses store adapters and a named fallback', () => {
    const wb = fromWildberriesProduct({ id: 12345678, name: 'Плед', brand: 'Home', salePriceU: 1299000, priceU: 1599000 }, 'https://www.wildberries.ru/catalog/12345678/detail.aspx');
    assert.equal(wb.price, 12990);
    assert.equal(wb.oldPrice, 15990);
    assert.match(wb.imageUrl, /12345678/);
    const composed = composeMetadata({
      url: 'https://www.wildberries.ru/catalog/12345678/detail.aspx',
      html: '<meta property="og:title" content="Другое">',
      wbProduct: { id: 12345678, name: 'Плед', salePriceU: 1299000, priceU: 1599000 }
    });
    assert.equal(composed.title, 'Плед');
    assert.equal(composed.store, 'Wildberries');
    assert.equal(composed.source, 'wildberries');

    const ozon = composeMetadata({
      url: 'https://www.ozon.ru/product/cup-1/',
      html: '<html>"finalPrice":9900,"originalPrice":12000</html>'
    });
    assert.equal(ozon.store, 'Ozon');
    assert.equal(fromOzonHtml(ozon ? '<html>"finalPrice":9900</html>' : '').price, 9900);
    assert.equal(ozon.price, 9900);

    const apple = fromGoldenAppleHtml('<meta itemprop="price" content="2490">');
    assert.equal(apple.price, 2490);
    assert.equal(apple.store, 'Золотое Яблоко');

    const fallback = composeMetadata({ url: 'https://www.lamoda.ru/p/1', html: '' });
    assert.equal(fallback.store, 'Lamoda');
    assert.equal(fallback.source, 'fallback');
    assert.equal(fallback.url, 'https://www.lamoda.ru/p/1');
  });
});

describe('link preview safety', () => {
  it('blocks local, private and non-http urls before fetch', async () => {
    assert.equal(isPrivateAddress('127.0.0.1'), true);
    assert.equal(isPrivateAddress('10.1.2.3'), true);
    assert.equal(isPrivateAddress('192.168.0.10'), true);
    assert.equal(isPrivateAddress('172.16.0.1'), true);
    assert.equal(isPrivateAddress('169.254.169.254'), true);
    assert.equal(isPrivateAddress('::1'), true);
    assert.equal(isPrivateAddress('8.8.8.8'), false);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return htmlResponse('<html></html>');
    };
    for (const url of ['file:///etc/passwd', 'ftp://example.com/a', 'http://localhost/admin', 'http://127.0.0.1/', 'http://192.168.1.5/', 'http://10.0.0.8/']) {
      const result = await previewLink(url, { fetchImpl, lookupImpl: PUBLIC_LOOKUP, cache: new Map() });
      assert.equal(result.ok, false, url);
    }
    assert.equal(calls.length, 0);
  });

  it('does not follow a redirect into a private address', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes('shop.example')) {
        return htmlResponse('', { status: 302, headers: { location: 'http://127.0.0.1/secret', 'content-type': 'text/html' } });
      }
      return htmlResponse('<html></html>');
    };
    const result = await previewLink('https://shop.example/item', {
      fetchImpl,
      lookupImpl: async (host) => {
        if (host === 'shop.example') return [{ address: '8.8.8.8', family: 4 }];
        return [{ address: '127.0.0.1', family: 4 }];
      },
      cache: new Map()
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'blocked_ip');
    assert.equal(calls.some((url) => url.includes('127.0.0.1')), false);
  });

  it('rejects a private DNS answer and a non-html body', async () => {
    const fetchImpl = async () => htmlResponse('{}', { type: 'application/json' });
    const dns = await previewLink('https://shop.example/item', {
      fetchImpl,
      lookupImpl: async () => [{ address: '10.0.0.4', family: 4 }],
      cache: new Map()
    });
    assert.equal(dns.error, 'blocked_ip');

    let fetched = 0;
    const image = await previewLink('https://cdn.example/pic.png', {
      fetchImpl: async () => {
        fetched += 1;
        return htmlResponse('png', { type: 'image/png' });
      },
      lookupImpl: PUBLIC_LOOKUP,
      cache: new Map()
    });
    assert.equal(image.error, 'unsupported_type');
    assert.equal(fetched, 1);
  });

  it('returns parsed metadata and caches it', async () => {
    const calls = [];
    const cache = new Map();
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return htmlResponse('<meta property="og:title" content="Лампа"><meta property="product:price:amount" content="4200">');
    };
    const first = await previewLink('https://shop.example/lamp', { fetchImpl, lookupImpl: PUBLIC_LOOKUP, cache, now: 10_000 });
    const second = await previewLink('https://shop.example/lamp', { fetchImpl, lookupImpl: PUBLIC_LOOKUP, cache, now: 20_000 });
    assert.equal(first.data.title, 'Лампа');
    assert.equal(first.data.price, 4200);
    assert.equal(second.data.title, 'Лампа');
    assert.equal(calls.length, 1);

    const api = await handleLinkPreviewRequest(JSON.stringify({ url: 'file:///etc/passwd' }), { cache: new Map() });
    assert.equal(api.status, 400);
    assert.equal(api.json.title, undefined);
  });
});
