import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Per-history-entry scroll restoration. Same implementation as the
// other apps for consistency.
export default function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastSaveRef = useRef(0);

  useEffect(() => {
    const key = `scroll:${location.key}`;
    const save = () => {
      const now = Date.now();
      if (now - lastSaveRef.current < 100) return;
      lastSaveRef.current = now;
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* sessionStorage full / disabled — non-fatal */
      }
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* noop */
      }
    };
  }, [location.key]);

  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      if (navigationType === 'POP') {
        const saved = sessionStorage.getItem(`scroll:${location.key}`);
        if (saved !== null) {
          window.scrollTo(0, parseInt(saved, 10) || 0);
          return;
        }
      }
      window.scrollTo(0, 0);
    };
    const raf = window.requestAnimationFrame(apply);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [location.key, location.pathname, navigationType]);

  return null;
}
