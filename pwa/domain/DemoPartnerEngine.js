import { config } from '../config.js';
import { runtime } from '../platform/runtime.js';
import { NotificationService } from '../platform/notifications.js';

const SAMPLES = [
  'Мне нравится, что рядом с тобой можно быть собой и не объяснять каждую мелочь.',
  'Наверное, тот обычный вечер, когда мы просто гуляли без плана и очень много смеялись.',
  'Мне бы хотелось, чтобы на этой неделе мы выделили один вечер совсем без телефонов.',
  'Давай выберем новое место и поедем туда без большого плана — просто вместе.',
  'Я чувствую тепло, когда мы делимся даже маленькими новостями дня.',
  'Спасибо, что остаёшься рядом в обычные дни — это для меня очень много значит.'
];

/**
 * DemoPartnerEngine — one-device hypothesis testing without backend.
 * Future: replace with RealtimePartnerService (same callbacks, no UI rewrite).
 */
export class DemoPartnerEngine {
  constructor({ getState, saveAnswerForRole, onPartnerAnswered }) {
    this.getState = getState;
    this.saveAnswerForRole = saveAnswerForRole;
    this.onPartnerAnswered = onPartnerAnswered;
    this._timer = null;
    this._visibilityHandler = null;
  }

  getPrefs() {
    const state = this.getState();
    return {
      autoAnswer: state.testLab?.partnerAutoAnswer !== false,
      delayMs: state.testLab?.partnerDelayMs || config.demoPartner.defaultDelayMs
    };
  }

  cancel() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  partnerRole(state) {
    return state.currentRole === 'a' ? 'b' : 'a';
  }

  alreadyAnswered(state, dayKey) {
    const partner = this.partnerRole(state);
    return Boolean(state.answers?.[dayKey]?.[partner]?.text);
  }

  pickText(state) {
    const idx = (state.dayIndex || 0) % SAMPLES.length;
    return SAMPLES[idx];
  }

  /**
   * Schedule auto partner answer after user submits.
   * Does not expose "fake partner" wording to normal UI.
   */
  scheduleAfterUserAnswer(dayKey) {
    const prefs = this.getPrefs();
    if (!prefs.autoAnswer) return;
    this.cancel();
    const delay = Math.max(1000, Number(prefs.delayMs) || config.demoPartner.defaultDelayMs);
    this._timer = setTimeout(() => {
      this.triggerPartnerAnswer(dayKey, { fromTimer: true });
    }, delay);
  }

  async triggerPartnerAnswer(dayKey, { fromTimer = false } = {}) {
    this.cancel();
    const state = this.getState();
    const key = dayKey || state.todayKey;
    if (!key || this.alreadyAnswered(state, key)) return false;

    const partner = this.partnerRole(state);
    const text = this.pickText(state);
    await this.saveAnswerForRole(key, partner, text, { demo: true });

    // Background notification when possible
    if (document.hidden || runtime.isNative()) {
      try {
        // On web, Notification only works if permission granted and page may be backgrounded.
        // On native, local notification can surface if OS allows.
        if (document.hidden || !document.hasFocus?.()) {
          await NotificationService.sendPartnerAnsweredNotification();
        }
      } catch {
        // Documented limitation: reliable background delivery may need FCM later.
      }
    }

    await this.onPartnerAnswered?.({ dayKey: key, fromTimer });
    return true;
  }

  setDelayMs(ms) {
    const state = this.getState();
    if (!state.testLab) state.testLab = {};
    state.testLab.partnerDelayMs = ms;
  }
}
