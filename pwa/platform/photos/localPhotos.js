import { buildLocalAttachmentInput } from '../../domain/media/model.js';

/**
 * PhotoProvider surface:
 * connect, disconnect, getAlbums, getAlbum, getMedia, getPreview, importMedia.
 * Future: GooglePhotosProvider, ApplePhotosProvider.
 * WfolioPhotoProvider lives in integrations/wfolio.
 */
export class LocalPhotoProvider {
  constructor({ mode = 'preview' } = {}) {
    this.mode = mode;
  }

  async connect() {
    return { provider: 'local' };
  }

  async disconnect() {}

  async getAlbums() {
    return [];
  }

  async getAlbum() {
    return null;
  }

  async getMedia() {
    return [];
  }

  async getPreview(media) {
    return media?.previewUrl || media?.metadata?.thumbnail || '';
  }

  async importMedia({ files, mode } = {}) {
    return filesToAttachmentInputs(files, mode || this.mode);
  }
}

export async function filesToAttachmentInputs(files, mode) {
  const inputs = [];
  const list = [...(files || [])];
  if (!list.length) return { inputs };
  if (mode === 'links') return { error: 'links_mode', inputs: [] };
  for (const file of list) {
    if (!file?.type?.startsWith('image/')) continue;
    const variants = await imageFileToVariants(file);
    const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
    const input = buildLocalAttachmentInput({ variants, mode, takenAt });
    if (!input.error) inputs.push(input);
  }
  return { inputs };
}

export async function imageFileToVariants(file, { maxPreview = 1280, maxThumb = 360 } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    const preview = await renderDataUrl(bitmap, maxPreview, 0.82);
    const thumbnail = await renderDataUrl(bitmap, maxThumb, 0.72);
    let originalDataUrl = '';
    if (file.size && file.size < 1_500_000) originalDataUrl = await blobToDataUrl(file);
    return {
      previewUrl: preview.url,
      thumbnail: thumbnail.url,
      originalDataUrl,
      width: bitmap.width,
      height: bitmap.height
    };
  } finally {
    bitmap.close?.();
  }
}

async function renderDataUrl(bitmap, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { url: blob ? await blobToDataUrl(blob) : '', width, height };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
