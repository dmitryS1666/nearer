export function assessAndroidUpdate(local, remote) {
  if (!remote || remote.platform !== 'android') return { action: 'none' };
  const versionCode = Number(remote.versionCode);
  const localCode = Number(local?.versionCode);
  if (!Number.isInteger(versionCode) || !Number.isInteger(localCode)) return { action: 'reject', reason: 'bad_version' };
  if (!/^https:\/\/\S+$/i.test(String(remote.downloadUrl || ''))) return { action: 'reject', reason: 'bad_url' };
  if (!/^[a-f0-9]{64}$/i.test(String(remote.sha256 || ''))) return { action: 'reject', reason: 'bad_sha' };
  if (versionCode <= localCode) return { action: 'current' };
  return {
    action: 'available',
    mandatory: Boolean(remote.mandatory) || Number(remote.minimumSupportedVersionCode) > localCode,
    versionName: remote.versionName,
    versionCode,
    releaseNotes: String(remote.releaseNotes || '').slice(0, 2000)
  };
}

export function assessWebUpdate(local, remote) {
  if (!remote || remote.platform !== 'web') return { action: 'none' };
  const versionCode = Number(remote.versionCode);
  const localCode = Number(local?.versionCode);
  if (!Number.isInteger(versionCode) || !Number.isInteger(localCode)) return { action: 'none' };
  if (versionCode <= localCode) return { action: 'current' };
  return {
    action: 'available',
    versionName: remote.versionName,
    versionCode,
    releaseNotes: String(remote.releaseNotes || '').slice(0, 2000)
  };
}
