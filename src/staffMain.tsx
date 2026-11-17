import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLocationChangeEvents, isStaffEntryPath } from './App.tsx';
import { StaffShell } from './StaffShell.tsx';
import './index.css';

const CustomerShell = lazy(() =>
  import('./CustomerShell.tsx').then((mod) => ({ default: mod.CustomerShell }))
);

function StaffEntryRouter() {
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
    return <StaffShell />;
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <p className="text-sm font-medium text-slate-600">
            Loading Customer Shopping App...
          </p>
        </div>
      }
    >
      <CustomerShell />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(<StaffEntryRouter />);
