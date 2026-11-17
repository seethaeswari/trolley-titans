import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StaffDashboard } from './components/StaffDashboard';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { ensureStoreInitialized } from './services/trolleyService';
import { Product, Trolley } from './types/store';

function StaffApplication() {
  const [products, setProducts] = useState<Product[]>([]);
  const [trolleys, setTrolleys] = useState<Trolley[]>([]);

  useEffect(() => {
    void ensureStoreInitialized();

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((docSnap) => list.push(docSnap.data() as Product));
        list.sort((a, b) => a.productId.localeCompare(b.productId));
        setProducts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      }
    );

    const unsubTrolleys = onSnapshot(
      collection(db, 'trolleys'),
      (snap) => {
        const list: Trolley[] = [];
        snap.forEach((docSnap) => list.push(docSnap.data() as Trolley));
        list.sort((a, b) => a.trolleyId.localeCompare(b.trolleyId));
        setTrolleys(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'trolleys');
      }
    );

    return () => {
      unsubProducts();
      unsubTrolleys();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="no-print sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <span className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Trolley Titans
          </span>
          <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap shrink-0">
            Staff Billing Counter System
          </span>
        </div>
      </header>

      <main className="flex-1">
        <StaffDashboard products={products} trolleys={trolleys} />
      </main>

      <footer className="no-print border-t border-slate-200 bg-white py-4 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <span>Trolley Titans · Authorized Billing Counter</span>
          <span>Live Cloud Sync Enabled</span>
        </div>
      </footer>
    </div>
  );
}

export function StaffShell() {
  return (
    <ErrorBoundary>
      <StaffApplication />
    </ErrorBoundary>
  );
}
