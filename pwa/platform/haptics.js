import { runtime } from './runtime.js';

export async function lightImpact() {
  if (!runtime.isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Plugin optional / unavailable
  }
}
