import { daysBetween, todayIST } from '../domain/dates';
import { sampleData, sampleMessages } from '../sample/sample';
import { isDemo } from './demo';
import { ingestMessages } from './inbox';
import { getMeta, loadSample, setMeta } from './repo';

/**
 * Fill the sample database the first time it's shown, and refresh it after a week so the
 * payments look recent. Only ever touches the sample database.
 */
export async function seedDemoIfNeeded(): Promise<void> {
  if (!isDemo) return;
  const today = todayIST();
  const seeded = await getMeta<string>('demoSeededOn', '');
  if (seeded && daysBetween(seeded, today) < 7) return;
  await loadSample(sampleData(today));
  await ingestMessages(sampleMessages(today), { source: 'paste', receivedAt: today });
  await setMeta('demoSeededOn', today);
}
