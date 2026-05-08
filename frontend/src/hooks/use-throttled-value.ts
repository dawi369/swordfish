import { useEffect, useRef, useState } from "react";

/**
 * A hook that returns a throttled version of the provided value.
 * Useful for high-frequency updates (like market data) to prevent excessive re-renders.
 */
export function useThrottledValue<T>(value: T, limit: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdated = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdated.current;

    if (timeSinceLastUpdate >= limit) {
      setThrottledValue(value);
      lastUpdated.current = now;
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      timeoutRef.current = setTimeout(() => {
        setThrottledValue(value);
        lastUpdated.current = Date.now();
      }, limit - timeSinceLastUpdate);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, limit]);

  return throttledValue;
}
