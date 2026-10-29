import net from 'node:net';
import tls from 'node:tls';

export const PLUS_NOTIFY_DEFAULT = 'dsuschinsky@gmail.com';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function encodeMailSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

export function dotStuff(text) {
  return String(text)
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export function buildDataPayload({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMailSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(text),
    '.'
  ].join('\r\n');
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.endsWith('\n')) return;
      const complete = buf.split(/\r?\n/).filter((line) => line.length);
      const last = complete[complete.length - 1] || '';
      if (last.length < 3 || last[3] === '-') return;
      cleanup();
      const code = Number(last.slice(0, 3));
      if (!Number.isFinite(code)) {
        reject(fail('smtp_rejected'));
        return;
      }
      resolve(code);
    };
    const onError = () => {
      cleanup();
      reject(fail('smtp_unavailable'));
    };
    const cleanup = () => {
      socket.off?.('data', onData);
      socket.off?.('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function expectCode(socket, accepted) {
  const code = await readResponse(socket);
  if (!accepted(code)) throw fail('smtp_rejected');
}

function writeLine(socket, line) {
  socket.write(`${line}\r\n`);
}

export async function smtpDeliver({ socket, user, pass, from, to, subject, text, startTls = false, upgrade }) {
  await expectCode(socket, (code) => code === 220);
  writeLine(socket, 'EHLO blizhe');
  await expectCode(socket, (code) => code === 250);
  let channel = socket;
  if (startTls) {
    writeLine(channel, 'STARTTLS');
    await expectCode(channel, (code) => code === 220);
    if (typeof upgrade !== 'function') throw fail('smtp_unavailable');
    channel = await upgrade(channel);
    writeLine(channel, 'EHLO blizhe');
    await expectCode(channel, (code) => code === 250);
  }
  writeLine(channel, 'AUTH LOGIN');
  await expectCode(channel, (code) => code === 334);
  writeLine(channel, Buffer.from(String(user), 'utf8').toString('base64'));
  await expectCode(channel, (code) => code === 334);
  writeLine(channel, Buffer.from(String(pass), 'utf8').toString('base64'));
  await expectCode(channel, (code) => code === 235);
  writeLine(channel, `MAIL FROM:<${from}>`);
  await expectCode(channel, (code) => code === 250);
  writeLine(channel, `RCPT TO:<${to}>`);
  await expectCode(channel, (code) => code === 250);
  writeLine(channel, 'DATA');
  await expectCode(channel, (code) => code === 354);
  channel.write(`${buildDataPayload({ from, to, subject, text })}\r\n`);
  await expectCode(channel, (code) => code === 250);
  writeLine(channel, 'QUIT');
  return { accepted: true };
}

function openSmtpSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    const onError = () => {
      socket.destroy();
      reject(fail('smtp_unavailable'));
    };
    socket.once('error', onError);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.off('error', onError);
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

function upgradeStartTls(host) {
  return (plain) => new Promise((resolve, reject) => {
    const secure = tls.connect({ socket: plain, servername: host });
    const onError = () => {
      secure.destroy();
      reject(fail('smtp_unavailable'));
    };
    secure.once('error', onError);
    secure.once('secureConnect', () => {
      secure.off('error', onError);
      secure.on('error', () => {});
      resolve(secure);
    });
  });
}

/**
 * PLUS_MAIL_MODE=smtp sends mail.
 * PLUS_MAIL_MODE=test records mail in-process and is refused when NODE_ENV=production.
 * Anything else is not configured: the endpoint must not pretend the letter was sent.
 */
export function createPlusMailer({ env = process.env, deliver = smtpDeliver, openSocket = openSmtpSocket } = {}) {
  const mode = String(env.PLUS_MAIL_MODE || '').trim().toLowerCase();
  const to = String(env.PLUS_NOTIFY_TO || PLUS_NOTIFY_DEFAULT).trim();
  if (!to.includes('@')) return { configured: false, reason: 'recipient_missing', mode };
  if (mode === 'test') {
    if (env.NODE_ENV === 'production') return { configured: false, reason: 'test_mode_blocked', mode };
    const sent = [];
    return {
      configured: true,
      mode: 'test',
      sent,
      async send(message) {
        sent.push({ to, subject: message.subject, text: message.text });
        return { accepted: true, id: `test-${sent.length}` };
      }
    };
  }
  if (mode === 'smtp') {
    const host = String(env.SMTP_HOST || '').trim();
    const port = Number(env.SMTP_PORT || 587);
    const user = String(env.SMTP_USER || '');
    const pass = String(env.SMTP_PASS || '');
    const from = String(env.PLUS_MAIL_FROM || '').trim();
    if (!host || !user || !pass || !from || !Number.isFinite(port)) {
      return { configured: false, reason: 'smtp_incomplete', mode };
    }
    const secure = env.SMTP_SECURE === '1' || port === 465;
    return {
      configured: true,
      mode: 'smtp',
      async send(message) {
        const socket = await openSocket({ host, port, secure });
        try {
          await deliver({
            socket,
            user,
            pass,
            from,
            to,
            subject: message.subject,
            text: message.text,
            startTls: !secure,
            upgrade: upgradeStartTls(host)
          });
        } finally {
          socket.end?.();
        }
        return { accepted: true };
      }
    };
  }
  return { configured: false, reason: 'not_configured', mode };
}
