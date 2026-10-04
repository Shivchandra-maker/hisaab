import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isAndroidApp } from '../native/capture';
import { Icon } from './Icon';

const TRIGGER = 70;

/**
 * Pull down from the top of the page to refresh (phone app only). Returns an indicator to render
 * at the top of the page.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): { indicator: ReactNode } {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!isAndroidApp) return;
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !busy ? e.touches[0]!.clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const d = e.touches[0]!.clientY - start.current;
      setPull(d > 0 ? Math.min(d * 0.5, 100) : 0);
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      setPull((p) => {
        if (p >= TRIGGER) {
          setBusy(true);
          void cb.current().finally(() => setBusy(false));
        }
        return 0;
      });
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [busy]);

  if (!isAndroidApp || (!pull && !busy)) return { indicator: null };
  return {
    indicator: (
      <div
        className={`ptr ${busy ? 'is-busy' : ''}`}
        style={{ height: busy ? 44 : pull }}
        role="status"
        aria-live="polite"
      >
        <span style={{ transform: `rotate(${busy ? 0 : pull * 3}deg)` }}>
          <Icon name="repeat" size={18} />
        </span>
        {busy ? 'Checking messages…' : pull >= TRIGGER ? 'Release to refresh' : 'Pull to refresh'}
      </div>
    ),
  };
}
