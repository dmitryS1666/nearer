/**
 * Wfolio is an external gallery provider.
 * Level 1 stores a gallery link and optional Open Graph metadata.
 * Level 2 may embed only when a gallery explicitly allows it.
 * Level 3 (account API) is not implemented — private cabinets are not scraped.
 */

export function isWfolioUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host.split('.').includes('wfolio');
  } catch {
    return false;
  }
}

export function wfolioEmbedUrl() {
  // Public embed support is not confirmed. Keep the gallery as a link.
  return null;
}

export function normalizeGalleryMetadata(meta, galleryUrl) {
  return {
    provider: 'wfolio',
    galleryUrl,
    title: meta?.title || 'Галерея Wfolio',
    cover: meta?.imageUrl || '',
    date: meta?.date || null,
    description: meta?.description || ''
  };
}

export class WfolioPhotoProvider {
  constructor({ metadataProvider } = {}) {
    this.metadataProvider = metadataProvider || null;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    return { provider: 'wfolio', level: 1, mode: 'link', accountApi: false };
  }

  async disconnect() {
    this.connected = false;
  }

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
    return media?.previewUrl || media?.metadata?.cover || '';
  }

  async importMedia({ galleryUrl } = {}) {
    if (!isWfolioUrl(galleryUrl)) {
      const error = new Error('not_wfolio');
      error.code = 'not_wfolio';
      throw error;
    }
    let meta = null;
    try {
      meta = await this.metadataProvider?.fetch?.(galleryUrl);
    } catch {
      meta = null;
    }
    const gallery = normalizeGalleryMetadata(meta, galleryUrl);
    return {
      type: 'gallery',
      provider: 'wfolio',
      providerId: null,
      sourceUrl: gallery.galleryUrl,
      previewUrl: gallery.cover || '',
      metadata: {
        title: gallery.title,
        cover: gallery.cover,
        date: gallery.date,
        description: gallery.description,
        embedUrl: wfolioEmbedUrl(gallery.galleryUrl)
      }
    };
  }
}
