/**
 * Current: DemoEntitlementProvider (no billing)
 * Future: RevenueCatProvider
 */
export class DemoEntitlementProvider {
  constructor(getPlusFlag, setPlusFlag) {
    this._get = getPlusFlag;
    this._set = setPlusFlag;
  }

  async hasPlus() {
    return Boolean(this._get());
  }

  async setDemoPlus(enabled) {
    await this._set(Boolean(enabled));
    return this.hasPlus();
  }
}
