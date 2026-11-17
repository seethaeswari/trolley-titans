import { lazy, Suspense, useEffect, useState } from 'react';
import { CustomerShell } from './CustomerShell';

const StaffShell = lazy(() =>
  import('./StaffShell').then((mod) => ({ default: mod.StaffShell }))
);

let historyPatched = false;

export function ensureLocationChangeEvents(): void {
  if (typeof window === 'undefined' || historyPatched) return;
  historyPatched = true;

  const origPushState = window.history.pushState.bind(window.history);
  const origReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function (...args: Parameters<History['pushState']>) {
    origPushState(...args);
    window.dispatchEvent(new Event('tt-locationchange'));
  };

  window.history.replaceState = function (...args: Parameters<History['replaceState']>) {
    origReplaceState(...args);
    window.dispatchEvent(new Event('tt-locationchange'));
  };
}

export function isStaffEntryPath(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const appParam = (params.get('app') || params.get('view') || '').toLowerCase();

  // Customer trolley/session query parameters always route to the Customer Shopper App,
  // even if a stale #staff fragment remained in the preview address bar.
  if (params.has('trolley') || params.has('customer')) {
    return false;
  }

  if (
    pathname === '/staff' ||
    pathname === '/staff/' ||
    pathname.startsWith('/staff/') ||
    pathname.endsWith('/staff.html')
  ) {
    return true;
  }

  if (
    hash === '#staff' ||
    hash === '#/staff' ||
    hash.startsWith('#staff/') ||
    hash.startsWith('#/staff/')
  ) {
    return true;
  }

  if (appParam === 'staff' || params.get('staff') === '1') {
    return true;
  }

  return false;
}

export default function App() {
  const [isStaff, setIsStaff] = useState<boolean>(() => isStaffEntryPath());

  useEffect(() => {
    ensureLocationChangeEvents();

    const syncRoute = () => {
      const nextIsStaff = isStaffEntryPath();
      if (!nextIsStaff) {
        const hash = window.location.hash.toLowerCase();
        if (hash === '#staff' || hash.startsWith('#/staff') || hash.startsWith('#staff/')) {
          window.history.replaceState(
            {},
            '',
            `${window.location.pathname}${window.location.search}`
          );
        }
      }
      setIsStaff(nextIsStaff);
      document.title = nextIsStaff
        ? 'Trolley Titans Staff — Billing Counter & Verification System'
        : 'Trolley Titans — Smart Trolley Self-Checkout';
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('tt-locationchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('tt-locationchange', syncRoute);
    };
  }, []);

  if (isStaff) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <p className="text-sm font-medium text-slate-600">
              Loading Staff Billing Counter...
            </p>
          </div>
        }
      >
        <StaffShell />
      </Suspense>
    );
  }

  return <CustomerShell />;
}
