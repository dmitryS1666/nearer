// App config for hypothesis / PWA builds.
// Put secrets only in local env files — never commit real signing credentials.
export const config = {
  appName: 'Ближе',
  appId: 'app.blizhe.couple',
  versionName: '0.1.0',
  versionCode: 1,
  buildLabel: 'Hypothesis Build',
  // Feedback destination. Prefer email; optional form URL overrides mailto.
  TEST_FEEDBACK_EMAIL: 'dsuschinsky@gmail.com',
  TEST_FEEDBACK_URL: '',
  demoPartner: {
    // Default delay range (ms) when auto-answer is enabled
    minDelayMs: 10000,
    maxDelayMs: 20000,
    defaultDelayMs: 15000
  },
  push: {
    // Web Push only (PWA). Native uses Capacitor Local Notifications.
    vapidPublicKey: '',
    subscriptionEndpoint: ''
  }
};
