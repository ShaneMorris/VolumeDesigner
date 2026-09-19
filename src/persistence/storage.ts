import type { Design } from '../geometry/types';

const STORAGE_KEY = 'volume-designer:design';

export function saveToLocalStorage(design: Design) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // Storage can be unavailable (private browsing, quota) — autosave is best-effort.
  }
}

export function loadFromLocalStorage(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Design;
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

export function readDesignFromFile(file: File): Promise<Design> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string) as Design);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
