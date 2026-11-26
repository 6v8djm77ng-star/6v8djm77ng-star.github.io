import { createContext, useContext, useEffect, useState } from 'react';
import type { Meta } from './api/client';

export const MetaContext = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaContext);

export function useWarehouseName() {
  const meta = useMeta();
  return (code: string) => meta?.warehouses.find((w) => w.code === code)?.name ?? `מחסן ${code}`;
}

/** Browser connectivity + periodic server reachability check. */
export function useOnline(pingMs = 15000) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      if (!navigator.onLine) return alive && setOnline(false);
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    const up = () => void ping();
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const t = window.setInterval(ping, pingMs);
    void ping();
    return () => {
      alive = false;
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearInterval(t);
    };
  }, [pingMs]);
  return online;
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
