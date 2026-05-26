import { normalizeSettings } from '../settings/androidSettings.js';

export async function loadAtlasManifest() {
  const response = await fetch('/generated/atlas/manifest.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`atlas manifest HTTP ${response.status}`);
  }
  return response.json();
}

export function firstTarget(manifest) {
  for (const category of manifest.categories ?? []) {
    const item = category.items?.[0];
    if (item) return { category, item };
  }
  throw new Error('atlas manifest contains no targets');
}

export function targetSettings(item) {
  return normalizeSettings(item.settings ?? {});
}
