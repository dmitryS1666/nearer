import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlusIntentMessage, PLUS_PLANS } from '../../server/plusPlans.js';
import { createPlusIntentService } from '../../server/plusIntent.js';
import { createPlusIntentStore } from '../../server/plusIntentStore.js';
import { createPlusMailer, smtpDeliver } from '../../server/plusMail.js';
import { PLUS_COPY } from '../components/plus/plusCopy.js';
import { renderPlus } from '../components/plus/plusView.js';
import { createPlusIntentController, plusIntentPayload, postPlusIntent } from '../components/plus/plusIntent.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const PRIVATE = ['Катя Секрет', 'наш тайный ответ', 'device-token-secret', 'recovery-seed-secret', 'список пикник'];

function request(body, { headers = {}, ip = '203.0.113.8' } = {}) {
  return {
    method: 'POST',
    path: '/api/plus/intent',
    rawBody: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'x-blizhe-intent': '1', host: '127.0.0.1:4173', ...headers },
    ip
  };
}

function validBody(extra = {}) {
  return {
    plan: 'month',
    source: 'settings',
    requestId: ID,
    price: 1,
    currency: 'USD',
    partnerName: 'Катя Секрет',
    answers: 'наш тайный ответ',
    deviceToken: 'device-token-secret',
    recovery: 'recovery-seed-secret',
    lists: 'список пикник',
    ...extra
  };
}

function harness({ filePath, limit = 6, failTimes = 0 } = {}) {
  const sent = [];
  let failuresLeft = failTimes;
  const logs = [];
  const mailer = {
    configured: true,
    async send(message) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        const error = new Error('smtp_rejected');
        error.code = 'smtp_rejected';
        throw error;
      }
      sent.push(message);
      return { accepted: true };
    }
  };
  const store = createPlusIntentStore({ filePath, limit });
  const service = createPlusIntentService({
    store,
    mailer,
    now: () => new Date('2026-10-29T10:30:00.000Z'),
    logger: {
      info(code) { logs.push(code); },
      error(code) { logs.push(code); }
    }
  });
  return { service, sent, logs, store };
}

describe('plus intent screen', () => {
  it('shows both tariffs, selects the month by default, and keeps the purchase warning above the button', () => {
    const html = renderPlus({ plan: 'month', phase: 'idle' });
    assert.match(html, /Больше поводов быть ближе/);
    assert.match(html, /Готовим к запуску/);
    assert.match(html, /9,90 BYN за пару/);
    assert.match(html, /79 BYN за пару/);
    assert.match(html, /aria-checked="true"[^>]*data-plus-plan="month"/);
    assert.match(html, /aria-checked="false"[^>]*data-plus-plan="year"/);
    const note = html.indexOf(PLUS_COPY.purchaseNote);
    const button = html.indexOf(PLUS_COPY.buy);
    assert.ok(note > -1 && note < button);
    assert.equal(html.includes('Плюс активен'), false);
    assert.equal(html.includes('type="card"'), false);
  });

  it('switches the selected tariff without treating Plus as already purchased', () => {
    const controller = createPlusIntentController({ post: async () => ({ ok: true }) });
    assert.equal(controller.snapshot().plan, 'month');
    controller.selectPlan('year');
    const html = renderPlus(controller.snapshot());
    assert.match(html, /aria-checked="true"[^>]*data-plus-plan="year"/);
    assert.match(html, /aria-checked="false"[^>]*data-plus-plan="month"/);
    assert.equal(controller.snapshot().plus, undefined);
  });

  it('shows the thanks block only after a successful send and does not activate Plus', async () => {
    const posts = [];
    const controller = createPlusIntentController({
      post: async (body) => {
        posts.push(body);
        return { ok: true };
      },
      uuid: () => ID
    });
    assert.equal(controller.startSubmit(), 'started');
    const sending = renderPlus(controller.snapshot());
    assert.match(sending, /Отправляем запрос…/);
    assert.match(sending, /disabled/);
    const done = await controller.finishSubmit('settings');
    assert.equal(done.phase, 'sent');
    assert.equal(done.notice, true);
    assert.equal(done.plus, undefined);
    assert.deepEqual(Object.keys(posts[0]).sort(), ['plan', 'requestId', 'source']);
    const html = renderPlus(done);
    assert.match(html, new RegExp(PLUS_COPY.thanksTitle));
    assert.match(html, /Ничего не списано, подписка не оформлена/);
    assert.match(html, /Запрос отправлен/);
    assert.equal(html.includes('Плюс активен'), false);
    controller.dismissNotice();
    assert.equal(renderPlus(controller.snapshot()).includes(PLUS_COPY.thanksTitle), false);
    assert.match(renderPlus(controller.snapshot()), /Запрос отправлен/);
  });

  it('keeps the same request id when mail fails, then succeeds on retry', async () => {
    const ids = [];
    let fail = true;
    const controller = createPlusIntentController({
      post: async (body) => {
        ids.push(body.requestId);
        if (fail) {
          fail = false;
          const error = new Error('mail_failed');
          error.code = 'mail_failed';
          throw error;
        }
        return { ok: true };
      },
      uuid: () => ID
    });
    assert.equal(controller.startSubmit(), 'started');
    const failed = await controller.finishSubmit('ours');
    assert.equal(failed.phase, 'error');
    assert.equal(failed.error, PLUS_COPY.error);
    assert.equal(renderPlus(failed).includes(PLUS_COPY.thanksTitle), false);
    assert.match(renderPlus(failed), /Не удалось отправить запрос/);
    assert.equal(controller.startSubmit(), 'started');
    const sent = await controller.finishSubmit('ours');
    assert.equal(sent.phase, 'sent');
    assert.deepEqual(ids, [ID, ID]);
  });

  it('does not queue an intent while offline', async () => {
    let calls = 0;
    const controller = createPlusIntentController({
      post: async () => { calls += 1; },
      online: () => false
    });
    assert.equal(controller.startSubmit(), 'offline');
    assert.equal(calls, 0);
    assert.equal(controller.snapshot().error, PLUS_COPY.offline);
    assert.match(renderPlus(controller.snapshot()), /Для отправки запроса нужен интернет/);
    assert.equal(controller.snapshot().phase === 'sent', false);
  });

  it('ignores a second click while the first request is in flight', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const controller = createPlusIntentController({
      post: () => {
        calls += 1;
        return gate;
      },
      uuid: () => ID
    });
    assert.equal(controller.startSubmit(), 'started');
    const pending = controller.finishSubmit('other');
    assert.equal(controller.startSubmit(), 'blocked');
    release({ ok: true });
    await pending;
    assert.equal(calls, 1);
    assert.equal(controller.startSubmit(), 'blocked');
  });

  it('posts only plan, source and request id', async () => {
    let body = '';
    let headers = {};
    await postPlusIntent({
      plan: 'year',
      source: 'ours',
      requestId: ID,
      price: 0,
      partnerName: 'Катя Секрет'
    }, {
      online: () => true,
      fetchImpl: async (_url, options) => {
        body = options.body;
        headers = options.headers;
        return { ok: true, json: async () => ({ ok: true }) };
      }
    });
    assert.deepEqual(JSON.parse(body), { plan: 'year', source: 'ours', requestId: ID });
    assert.equal(headers['x-blizhe-intent'], '1');
    assert.equal(plusIntentPayload({ plan: 'month', source: 'settings', requestId: ID, answers: 'секрет' }).answers, undefined);
  });
});

describe('plus intent endpoint', () => {
  it('sends one letter with the server price and no private couple data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blizhe-plus-'));
    try {
      const { service, sent, logs } = harness({ filePath: join(dir, 'intents.json') });
      const result = await service.handle(request(validBody()));
      assert.equal(result.status, 200);
      assert.equal(result.json.ok, true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].subject, 'Ближе Plus — намерение покупки');
      assert.match(sent[0].text, /Тариф: Месяц/);
      assert.match(sent[0].text, /Предварительная цена: 9,90 BYN/);
      assert.match(sent[0].text, /Валюта: BYN/);
      assert.match(sent[0].text, /Источник: настройки/);
      assert.match(sent[0].text, /Europe\/Minsk/);
      assert.match(sent[0].text, new RegExp(ID));
      const packed = `${sent[0].text}\n${logs.join('\n')}\n${readFileSync(join(dir, 'intents.json'), 'utf8')}`;
      for (const secret of PRIVATE) assert.equal(packed.includes(secret), false);
      assert.equal(packed.includes('USD'), false);
      assert.equal(packed.includes('"price"'), false);
      const again = await service.handle(request(validBody()));
      assert.equal(again.status, 200);
      assert.equal(again.json.duplicate, true);
      assert.equal(sent.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a bad tariff and ignores a client-supplied price', async () => {
    const { service, sent } = harness();
    const invalid = await service.handle(request(validBody({ plan: 'lifetime', requestId: ID_2 })));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, 'invalid_plan');
    const year = await service.handle(request(validBody({ plan: 'year', requestId: ID_3, price: 0, currency: 'USD' }), { ip: '203.0.113.9' }));
    assert.equal(year.status, 200);
    assert.match(sent[0].text, /Предварительная цена: 79 BYN/);
    assert.equal(sent[0].text.includes('USD'), false);
    assert.equal(PLUS_PLANS.month.display, '9,90 BYN');
  });

  it('rate-limits new requests but still dedupes an already sent one', async () => {
    const { service, sent } = harness({ limit: 2 });
    assert.equal((await service.handle(request(validBody(), { ip: '198.51.100.4' }))).status, 200);
    assert.equal((await service.handle(request(validBody({ requestId: ID_2 }), { ip: '198.51.100.4' }))).status, 200);
    const limited = await service.handle(request(validBody({ requestId: ID_3 }), { ip: '198.51.100.4' }));
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error, 'rate_limited');
    const duplicate = await service.handle(request(validBody(), { ip: '198.51.100.4' }));
    assert.equal(duplicate.json.duplicate, true);
    assert.equal(sent.length, 2);
  });

  it('does not report success when mail fails, and a retry of the same id sends once', async () => {
    const { service, sent } = harness({ failTimes: 1 });
    const failed = await service.handle(request(validBody({ source: 'ours' })));
    assert.equal(failed.status, 502);
    assert.equal(failed.json.error, 'mail_failed');
    assert.equal(sent.length, 0);
    const retried = await service.handle(request(validBody({ source: 'ours' })));
    assert.equal(retried.status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Источник: наше/);
  });

  it('lets a second overlapping attempt wait instead of sending two letters', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const mailer = {
      configured: true,
      send() {
        calls += 1;
        return gate;
      }
    };
    const service = createPlusIntentService({
      store: createPlusIntentStore(),
      mailer,
      now: () => new Date('2026-10-29T10:30:00.000Z')
    });
    const first = service.handle(request(validBody({ source: 'other' })));
    const second = await service.handle(request(validBody({ source: 'other' })));
    assert.equal(second.status, 409);
    assert.equal(calls, 1);
    release({ accepted: true });
    assert.equal((await first).status, 200);
    const third = await service.handle(request(validBody({ source: 'other' })));
    assert.equal(third.json.duplicate, true);
    assert.equal(calls, 1);
  });

  it('blocks cross-site calls, a mismatched origin, and an unconfigured mailbox', async () => {
    const { service } = harness();
    assert.equal((await service.handle(request(validBody(), { headers: { 'x-blizhe-intent': '' } }))).status, 403);
    assert.equal((await service.handle(request(validBody(), { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
    assert.equal((await service.handle(request(validBody(), { headers: { origin: 'https://evil.example' } }))).status, 403);
    const sameOrigin = await service.handle(request(validBody({ requestId: ID_2 }), {
      headers: { origin: 'http://127.0.0.1:4173' },
      ip: '203.0.113.20'
    }));
    assert.equal(sameOrigin.status, 200);

    const silent = createPlusIntentService({
      store: createPlusIntentStore(),
      mailer: createPlusMailer({ env: {} }),
      now: () => new Date('2026-10-29T10:30:00.000Z')
    });
    const notConfigured = await silent.handle(request(validBody({ requestId: ID_3 })));
    assert.equal(notConfigured.status, 503);
    assert.equal(notConfigured.json.error, 'email_not_configured');
    assert.equal(createPlusMailer({ env: { PLUS_MAIL_MODE: 'test', NODE_ENV: 'production' } }).configured, false);
  });

  it('builds a message that cannot carry couple content', () => {
    const message = buildPlusIntentMessage({
      plan: 'month',
      source: 'other',
      requestId: ID,
      at: new Date('2026-10-29T10:30:00.000Z')
    });
    assert.equal(message.subject, 'Ближе Plus — намерение покупки');
    assert.match(message.text, /Источник: другое/);
    assert.equal(message.text.includes('Катя'), false);
  });
});

describe('plus mail adapter', () => {
  it('talks SMTP to a local script and never puts couple text into the envelope', async () => {
    const replies = ['250 ok\r\n', '334\r\n', '334\r\n', '235\r\n', '250 ok\r\n', '250 ok\r\n', '354\r\n', '250 queued\r\n'];
    const socket = scriptedSocket(() => replies.shift() || '');
    const pending = smtpDeliver({
      socket,
      user: 'smtp-user',
      pass: 'smtp-pass-secret',
      from: 'nearer@example.com',
      to: 'dsuschinsky@gmail.com',
      subject: 'Ближе Plus — намерение покупки',
      text: 'Тариф: Месяц\nПредварительная цена: 9,90 BYN'
    });
    socket.emit('data', Buffer.from('220 ready\r\n'));
    await pending;
    assert.match(socket.transcript, /AUTH LOGIN/);
    assert.match(socket.transcript, /RCPT TO:<dsuschinsky@gmail.com>/);
    assert.match(socket.transcript, /9,90 BYN/);
    assert.equal(socket.transcript.includes('Катя Секрет'), false);
    assert.equal(socket.transcript.includes('наш тайный ответ'), false);
  });
});

function scriptedSocket(onWrite) {
  const handlers = { data: new Set(), error: new Set() };
  return {
    transcript: '',
    on(event, fn) { handlers[event].add(fn); return this; },
    off(event, fn) { handlers[event].delete(fn); return this; },
    emit(event, payload) { for (const fn of handlers[event]) fn(payload); },
    write(chunk) {
      this.transcript += String(chunk);
      const reply = onWrite(String(chunk));
      if (reply) queueMicrotask(() => this.emit('data', Buffer.from(reply)));
      return true;
    },
    end() {}
  };
}

describe('plus screen wiring', () => {
  it('does not turn on the demo Plus flag from the purchase request', () => {
    const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert.equal(app.includes('setDemoPlus'), false);
    assert.match(app, /data-plus-source="settings"/);
    assert.match(app, /Ближе Plus/);
  });
});
