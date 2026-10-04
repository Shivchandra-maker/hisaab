/**
 * Ask the browser / Android WebView to keep Hisaab's data even when the device runs low on
 * space. Without this, web storage is "best effort" and can be cleared by the system (H-10).
 * Returns true when protected, false when refused, undefined when the device can't say.
 */
export async function requestPersistentStorage(): Promise<boolean | undefined> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) return undefined;
    if (await s.persisted()) return true;
    return await s.persist();
  } catch {
    return undefined;
  }
}

/** Current state, without asking again. */
export async function storageIsPersistent(): Promise<boolean | undefined> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    return s?.persisted ? await s.persisted() : undefined;
  } catch {
    return undefined;
  }
}
