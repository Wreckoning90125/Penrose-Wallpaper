import { normalizeSettings } from '../settings/androidSettings';
import type { AtlasCategory, AtlasItem, AtlasManifest } from '../types';

export async function loadAtlasManifest(): Promise<AtlasManifest> {
  // The manifest is build-generated and ~90 KB; let normal HTTP caching
  // (ETag revalidation) apply instead of re-downloading it on every boot.
  const response = await fetch('/generated/atlas/manifest.json');
  if (!response.ok) {
    throw new Error(`atlas manifest HTTP ${response.status}`);
  }
  return response.json();
}

export function firstTarget(manifest: AtlasManifest): { category: AtlasManifest['categories'][number]; item: AtlasItem } {
  for (const category of manifest.categories ?? []) {
    const item = category.items?.[0];
    if (item) return { category, item };
  }
  throw new Error('atlas manifest contains no targets');
}

export function targetSettings(category: AtlasCategory, item: AtlasItem) {
  return normalizeSettings({ ...(category.defaults ?? {}), ...(item.settings ?? {}) });
}
