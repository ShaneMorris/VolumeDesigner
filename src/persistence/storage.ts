import type { Design } from '../geometry/types';
import type { RawDesign } from '../geometry/normalize';

const STORAGE_KEY = 'volume-designer:design';
const DEFAULT_PLANE_KEY = 'volume-designer:default-base-plane-in';

/**
 * The work-area size new designs start with. Kept outside the design itself so it
 * carries across designs as a personal preference, the way a shop default would.
 */
export function loadDefaultBasePlaneSize(): number | null {
  try {
    const raw = localStorage.getItem(DEFAULT_PLANE_KEY);
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDefaultBasePlaneSize(inches: number) {
  try {
    localStorage.setItem(DEFAULT_PLANE_KEY, String(inches));
  } catch {
    // Storage can be unavailable (private browsing, quota) — the preference is optional.
  }
}

export function saveToLocalStorage(design: Design) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // Storage can be unavailable (private browsing, quota) — autosave is best-effort.
  }
}

// Parsed, not validated: `normalizeDesign` (via the store's loadDesign) is what decides
// whether this is a usable design, so nothing here claims it already is one.
export function loadFromLocalStorage(): RawDesign | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RawDesign;
  } catch {
    return null;
  }
}

export function downloadDesignAsFile(design: Design, filename = 'volume-design.json') {
  const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function readDesignFromFile(file: File): Promise<RawDesign> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string) as RawDesign);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
