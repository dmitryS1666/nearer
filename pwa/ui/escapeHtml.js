export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[ch]);
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return '';
  }
  return '';
}

export function safeImageUrl(value) {
  const raw = String(value || '');
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw;
  return safeHttpUrl(raw);
}
