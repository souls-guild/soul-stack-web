import { useEffect, useState } from 'react';

// Ticking clock: re-renders every `intervalMs` with the current epoch ms. Drives live
// "N seconds ago" freshness that counts up smoothly between data refetches, instead of
// jumping only when a query refetches. Interval cleared on unmount.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
