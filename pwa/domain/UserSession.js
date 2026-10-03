import { getValue, setValue } from '../platform/storage.js';

/**
 * Current: anonymous local install
 * Future: Supabase Auth (replace LocalUserSession)
 */
const KEY = 'user_session';

export class LocalUserSession {
  async get() {
    const saved = await getValue(KEY, null);
    if (saved) return saved;
    const session = {
      mode: 'anonymous-local',
      createdAt: new Date().toISOString()
    };
    await setValue(KEY, session);
    return session;
  }

  async clear() {
    await setValue(KEY, null);
  }
}

export const userSession = new LocalUserSession();
