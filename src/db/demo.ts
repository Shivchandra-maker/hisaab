/**
 * "Show sample data" (U-26): a second, separate database full of made-up payments for showing
 * Hisaab to someone else. Your own data stays untouched in the real one; switching back is
 * instant. The choice lives in this browser/phone only and is read once at start-up.
 */
const KEY = 'hisaab-demo';

export const DB_NAME = 'hisaab';
export const DEMO_DB_NAME = 'hisaab-demo';

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** True while the sample database is showing. */
export const isDemo = read();

/** Switch databases. The app reloads so every screen reads from the other one. */
export function setDemo(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    return; // storage blocked: stay where we are
  }
  location.hash = '#home';
  location.reload();
}
