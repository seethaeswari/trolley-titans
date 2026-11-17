import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  CheckCircle2,
  CheckSquare,
  History,
  Lock,
  LogOut,
  Package,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Square,
  UserPlus,
  Users,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BOOTSTRAPPED_ADMIN_EMAIL } from '../data/seedCatalog';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  checkIsStaff,
  staffAddAllowlistEmail,
  staffCloseSession,
  staffCreateTrolley,
  staffRemoveAllowlistEmail,
  staffSaveProduct,
  staffVerifyAndMarkPaid,
} from '../services/trolleyService';
import { Product, SessionItem, ShoppingSession, StaffAllowlistEntry, Trolley } from '../types/store';
import { formatCurrency, formatTimestamp, parseCheckoutQr } from '../utils/formatters';
import { DemoGuideView, StaffPortalTab } from './DemoGuideView';
import { QrPrintKit } from './QrPrintKit';
import { QrScannerPanel } from './QrScannerPanel';

type StaffTab = StaffPortalTab;

interface StaffDashboardProps {
  products: Product[];
  trolleys: Trolley[];
}

export function StaffDashboard({ products, trolleys }: StaffDashboardProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<StaffTab>('counter');
  const [sessions, setSessions] = useState<ShoppingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<SessionItem[]>([]);
  const [checkedProducts, setCheckedProducts] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [actionNotice, setActionNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Catalog & Staff Admin state
  const [allowlist, setAllowlist] = useState<StaffAllowlistEntry[]>([]);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newTrolleyId, setNewTrolleyId] = useState('');
  const [newTrolleyLabel, setNewTrolleyLabel] = useState('');
  const [editingProduct, setEditingProduct] = useState<Omit<Product, 'updatedAt'> | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        const ok = await checkIsStaff(nextUser.email);
        setIsAuthorized(ok);
      } else {
        setIsAuthorized(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Listen to all sessions ONLY when authorized staff is authenticated
  useEffect(() => {
    if (!authReady || !isAuthorized) {
      setSessions([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, 'sessions'),
      (snap) => {
        const list: ShoppingSession[] = [];
        snap.forEach((docSnap) => list.push(docSnap.data() as ShoppingSession));
        list.sort((a, b) => {
          const numA = parseInt(a.customerId.replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(b.customerId.replace(/\D/g, ''), 10) || 0;
          return numB - numA;
        });
        setSessions(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'sessions');
      }
    );

    return () => unsub();
  }, [authReady, isAuthorized]);

  // Listen to selected session line items
  useEffect(() => {
    if (!isAuthorized || !selectedSessionId) {
      setSelectedItems([]);
      setCheckedProducts({});
      return;
    }

    setCheckedProducts({});
    const q = query(
      collection(db, 'sessions', selectedSessionId, 'items'),
      where('sessionId', '==', selectedSessionId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: SessionItem[] = [];
        snap.forEach((d) => list.push(d.data() as SessionItem));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setSelectedItems((prev) => {
          const prevQty = new Map(prev.map((item) => [item.productId, item.quantity]));
          const changedIds = list
            .filter((item) => prevQty.get(item.productId) !== item.quantity)
            .map((item) => item.productId);
          if (changedIds.length > 0) {
            setCheckedProducts((checks) => {
              const next = { ...checks };
              changedIds.forEach((id) => {
                delete next[id];
              });
              return next;
            });
          }
          return list;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `sessions/${selectedSessionId}/items`);
      }
    );

    return () => unsub();
  }, [isAuthorized, selectedSessionId]);

  // Listen to staff allowlist for bootstrapped admin
  const isBootstrappedAdmin =
    Boolean(user?.email) && user?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

  useEffect(() => {
    if (!isAuthorized || !isBootstrappedAdmin) {
      setAllowlist([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'staff_allowlist'),
      (snap) => {
        const list: StaffAllowlistEntry[] = [];
        snap.forEach((d) => list.push(d.data() as StaffAllowlistEntry));
        setAllowlist(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'staff_allowlist');
      }
    );
    return () => unsub();
  }, [isAuthorized, isBootstrappedAdmin]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'CLOSED'),
    [sessions]
  );

  const closedSessions = useMemo(
    () => sessions.filter((s) => s.status === 'CLOSED'),
    [sessions]
  );

  const filteredActive = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeSessions;
    return activeSessions.filter(
      (s) =>
        s.customerId.toLowerCase().includes(q) ||
        s.trolleyId.toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q)
    );
  }, [activeSessions, searchQuery]);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return closedSessions;
    return closedSessions.filter(
      (s) =>
        s.customerId.toLowerCase().includes(q) ||
        s.trolleyId.toLowerCase().includes(q)
    );
  }, [closedSessions, searchQuery]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.customerId === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const totalRevenue = useMemo(
    () =>
      sessions
        .filter((s) => s.paymentStatus === 'PAID')
        .reduce((acc, s) => acc + s.grandTotal, 0),
    [sessions]
  );

  const selectedGstBreakdown = useMemo(() => {
    const map = new Map<number, { taxable: number; gst: number }>();
    for (const item of selectedItems) {
      const existing = map.get(item.gstRate) || { taxable: 0, gst: 0 };
      map.set(item.gstRate, {
        taxable: Math.round((existing.taxable + item.lineSubtotal) * 100) / 100,
        gst: Math.round((existing.gst + item.lineGst) * 100) / 100,
      });
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [selectedItems]);

  const allPhysicalItemsChecked =
    selectedItems.length > 0 && selectedItems.every((item) => Boolean(checkedProducts[item.productId]));

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In could not complete.');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setSelectedSessionId(null);
  };

  const handleScanCheckoutQr = async (decoded: string) => {
    setActionNotice(null);
    const parsed = parseCheckoutQr(decoded);
    if (!parsed.customerId) {
      setActionNotice({
        type: 'error',
        message: 'Could not read a valid Customer ID from that QR code or input.',
      });
      return;
    }

    let found = sessions.find(
      (s) => s.customerId.toUpperCase() === parsed.customerId.toUpperCase()
    );
    if (!found) {
      try {
        const snap = await getDoc(doc(db, 'sessions', parsed.customerId.toUpperCase()));
        if (snap.exists()) {
          found = snap.data() as ShoppingSession;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `sessions/${parsed.customerId}`);
      }
    }

    if (!found) {
      setActionNotice({
        type: 'error',
        message: `Customer session ${parsed.customerId} was not found.`,
      });
      return;
    }

    if (parsed.trolleyId && found.trolleyId.toUpperCase() !== parsed.trolleyId.toUpperCase()) {
      setActionNotice({
        type: 'error',
        message: `Checkout QR mismatch: QR references ${parsed.trolleyId}, but ${found.customerId} belongs to ${found.trolleyId}.`,
      });
      return;
    }

    if (
      parsed.sessionToken &&
      !found.customerToken.toUpperCase().startsWith(parsed.sessionToken.toUpperCase())
    ) {
      setActionNotice({
        type: 'error',
        message: `Checkout QR security token does not match session ${found.customerId}.`,
      });
      return;
    }

    setSelectedSessionId(found.customerId);
    if (found.status === 'CLOSED') {
      setActiveTab('history');
      setActionNotice({
        type: 'success',
        message: `Loaded archived bill ${found.customerId} (Trolley ${found.trolleyId} · CLOSED).`,
      });
    } else {
      setActiveTab('counter');
      setActionNotice({
        type: 'success',
        message: `Loaded ${found.customerId} on Trolley ${found.trolleyId} for physical verification.`,
      });
    }
  };

  const handleVerifyAllToggle = () => {
    if (allPhysicalItemsChecked) {
      setCheckedProducts({});
    } else {
      const next: Record<string, boolean> = {};
      selectedItems.forEach((item) => {
        next[item.productId] = true;
      });
      setCheckedProducts(next);
    }
  };

  const handleMarkPaid = async () => {
    if (!selectedSession || !user) return;
    setBusy(true);
    setActionNotice(null);
    try {
      await staffVerifyAndMarkPaid(selectedSession.customerId, user);
      setActionNotice({
        type: 'success',
        message: `Demo payment marked PAID for ${selectedSession.customerId} (${formatCurrency(
          selectedSession.grandTotal
        )}). Click "Close Session & Release ${selectedSession.trolleyId}" to finish this customer.`,
      });
    } catch (err) {
      setActionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to mark payment as PAID.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCloseSession = async () => {
    if (!selectedSession) return;
    setBusy(true);
    setActionNotice(null);
    try {
      await staffCloseSession(selectedSession.customerId, selectedSession.trolleyId);
      setActionNotice({
        type: 'success',
        message: `Session ${selectedSession.customerId} is now CLOSED and archived. Trolley ${selectedSession.trolleyId} is AVAILABLE for the next customer.`,
      });
    } catch (err) {
      setActionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to close session.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setBusy(true);
    setActionNotice(null);
    try {
      await staffSaveProduct(editingProduct);
      setActionNotice({
        type: 'success',
        message: `Saved product ${editingProduct.name} (${formatCurrency(
          editingProduct.price
        )} · ${editingProduct.gstRate}% GST).`,
      });
      setEditingProduct(null);
    } catch (err) {
      setActionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save product.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddTrolley = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTrolleyId.trim()) return;
    setBusy(true);
    setActionNotice(null);
    try {
      await staffCreateTrolley(newTrolleyId, newTrolleyLabel);
      setActionNotice({
        type: 'success',
        message: `Registered permanent trolley ${newTrolleyId.trim().toUpperCase()}.`,
      });
      setNewTrolleyId('');
      setNewTrolleyLabel('');
    } catch (err) {
      setActionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to add trolley.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (!newStaffEmail.trim() || !user?.email) return;
    setBusy(true);
    setActionNotice(null);
    try {
      await staffAddAllowlistEmail(newStaffEmail, user.email);
      setActionNotice({
        type: 'success',
        message: `Authorized ${newStaffEmail.trim().toLowerCase()} for Staff Counter access.`,
      });
      setNewStaffEmail('');
    } catch (err) {
      setActionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not authorize staff email.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Loading auth
  if (!authReady) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="inline-block w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-600">Checking staff authentication...</p>
      </div>
    );
  }

  // Staff Login Gate
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-7 space-y-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
              Authorized Access Only
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Staff Billing Counter Login</h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Sign in with your authorized supermarket staff Google account to verify customer
              trolleys, confirm payment as PAID, and close trolley sessions.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 text-left">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Sign In with Google (Staff Counter)
          </button>

          <p className="text-xs text-slate-500">
            Default Store Admin: <span className="font-mono">{BOOTSTRAPPED_ADMIN_EMAIL}</span>
          </p>
        </div>
      </div>
    );
  }

  // Signed in, but not on staff allowlist
  if (!isAuthorized) {
    return (
      <div className="max-w-lg mx-auto px-4 py-14">
        <div className="rounded-2xl border border-amber-200 bg-white p-7 space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Staff Authorization Required</h1>
          <p className="text-sm text-slate-700 leading-relaxed">
            You are signed in as <span className="font-mono font-semibold">{user.email}</span>,
            which is not currently on the authorized supermarket staff allowlist.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Ask the store admin (<span className="font-mono">{BOOTSTRAPPED_ADMIN_EMAIL}</span>) to
            add your email under <strong>Staff Counter &rarr; Catalog &amp; Staff</strong>, or sign
            in with the store admin account.
          </p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Staff Counter Header & KPI Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Staff Billing Counter Dashboard</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Signed in as <span className="font-medium text-slate-900">{user.email}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          Sign Out
        </button>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Active Sessions</p>
          <p className="text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1">
            {activeSessions.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Awaiting Counter Verify</p>
          <p className="text-2xl font-mono font-bold text-amber-700 tabular-nums mt-1">
            {activeSessions.filter((s) => s.status === 'CHECKOUT_READY').length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Closed Bills Archived</p>
          <p className="text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1">
            {closedSessions.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Verified Revenue</p>
          <p className="text-2xl font-mono font-bold text-emerald-800 tabular-nums mt-1">
            {formatCurrency(totalRevenue)}
          </p>
        </div>
      </div>

      {/* Workspace Segmented Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('counter')}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'counter'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            Active Verification ({activeSessions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" aria-hidden="true" />
            Bill History ({closedSessions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'catalog'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" aria-hidden="true" />
            Products &amp; Staff
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qr-kit')}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'qr-kit'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <QrCode className="w-4 h-4" aria-hidden="true" />
            QR Print Kit
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('demo-guide')}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'demo-guide'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Demo Guide
          </button>
        </div>

        {(activeTab === 'counter' || activeTab === 'history') && (
          <div className="relative w-full sm:w-72">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Customer ID (CUST001) or T001"
              aria-label="Search by Customer ID or Trolley ID"
              className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        )}
      </div>

      {actionNotice && (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
            actionNotice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {actionNotice.message}
        </div>
      )}

      {/* TAB 1: Active Counter Verification */}
      {activeTab === 'counter' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Checkout QR Scanner + Active Sessions List */}
          <div className="lg:col-span-5 space-y-5">
            <QrScannerPanel
              title="Scan Customer Checkout QR"
              subtitle="Scan the customer's Checkout QR using your laptop camera, or enter Customer ID (e.g., CUST001) and click Load Bill."
              inputPlaceholder="Enter Customer ID (e.g., CUST001)"
              submitLabel="Load Bill"
              onScan={handleScanCheckoutQr}
            />

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Active Trolley Sessions</h2>
                <span className="text-xs text-slate-500 tabular-nums">
                  {filteredActive.length} open
                </span>
              </div>

              {filteredActive.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No active shopping sessions match your search.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredActive.map((s) => {
                    const isSelected = s.customerId === selectedSessionId;
                    return (
                      <button
                        key={s.customerId}
                        type="button"
                        onClick={() => setSelectedSessionId(s.customerId)}
                        className={`w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                          isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {s.customerId}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="font-mono text-xs font-semibold text-slate-700">
                              {s.trolleyId}
                            </span>
                          </div>
                          <p className="text-xs mt-0.5 text-slate-600">
                            {s.status === 'CHECKOUT_READY' && (
                              <span className="text-amber-700 font-semibold">
                                Ready at Counter · Unpaid
                              </span>
                            )}
                            {s.status === 'ACTIVE' && <span>Shopping in Aisle</span>}
                            {s.status === 'PAID' && (
                              <span className="text-emerald-700 font-semibold">
                                Paid · Ready to Close
                              </span>
                            )}
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="tabular-nums">{s.itemCount} items</span>
                          </p>
                        </div>
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums shrink-0">
                          {formatCurrency(s.grandTotal)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Verification Detail Panel */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6">
            {!selectedSession ? (
              <div className="py-16 text-center space-y-2">
                <p className="text-base font-semibold text-slate-900">Select or Scan a Session</p>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Scan a customer&apos;s Checkout QR code or click any active session on the left to
                  verify physical products, confirm payment as PAID, and close the trolley session.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <p className="text-xs text-slate-500">Customer Billing Verification</p>
                    <h2 className="text-2xl font-mono font-bold text-slate-900 mt-0.5">
                      {selectedSession.customerId}
                      <span className="text-slate-300 mx-2 font-sans font-normal">·</span>
                      <span className="text-emerald-800">{selectedSession.trolleyId}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Started {formatTimestamp(selectedSession.createdAt)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-500">Status</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">
                      {selectedSession.status} · {selectedSession.paymentStatus}
                    </p>
                  </div>
                </div>

                {/* Physical Product Verification Checklist */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Physical Product Verification Checklist
                      </h3>
                      <p className="text-xs text-slate-500">
                        Confirm every physical item inside Trolley {selectedSession.trolleyId}{' '}
                        matches the billed item and quantity.
                      </p>
                    </div>
                    {selectedSession.paymentStatus === 'UNPAID' && selectedItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleVerifyAllToggle}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {allPhysicalItemsChecked ? 'Uncheck All' : 'Verify All Items'}
                      </button>
                    )}
                  </div>

                  {selectedItems.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      No products scanned into this trolley yet.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                      {selectedItems.map((item) => {
                        const checked =
                          selectedSession.paymentStatus === 'PAID' ||
                          Boolean(checkedProducts[item.productId]);
                        return (
                          <button
                            key={item.productId}
                            type="button"
                            disabled={selectedSession.paymentStatus === 'PAID'}
                            onClick={() =>
                              setCheckedProducts((prev) => ({
                                ...prev,
                                [item.productId]: !prev[item.productId],
                              }))
                            }
                            className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left bg-white hover:bg-slate-50 disabled:hover:bg-white transition-colors cursor-pointer disabled:cursor-default"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {checked ? (
                                <CheckSquare
                                  className="w-5 h-5 text-emerald-700 shrink-0"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Square
                                  className="w-5 h-5 text-slate-400 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {item.name}{' '}
                                  <span className="font-mono text-emerald-800">
                                    × {item.quantity}
                                  </span>
                                </p>
                                <p className="text-xs text-slate-500 tabular-nums">
                                  Unit {formatCurrency(item.unitPrice)} · GST {item.gstRate}% (
                                  {formatCurrency(item.lineGst)})
                                </p>
                              </div>
                            </div>
                            <span className="font-mono text-sm font-bold text-slate-900 tabular-nums shrink-0">
                              {formatCurrency(item.lineTotal)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.subtotal)}
                    </span>
                  </div>
                  {selectedGstBreakdown.map(([rate, vals]) => (
                    <div key={rate} className="flex justify-between text-xs text-slate-500">
                      <span>GST @ {rate}% (on {formatCurrency(vals.taxable)})</span>
                      <span className="font-mono tabular-nums">{formatCurrency(vals.gst)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-slate-700 font-medium">
                    <span>Total GST</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.gstTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
                    <span>Grand Total (Demo Bill)</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.grandTotal)}
                    </span>
                  </div>
                </div>

                {/* Staff Actions */}
                {selectedSession.status !== 'CLOSED' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">
                      School Demonstration Verification: Confirm physical items in Trolley{' '}
                      <span className="font-mono font-semibold text-slate-700">
                        {selectedSession.trolleyId}
                      </span>{' '}
                      before marking demo payment as PAID (no real payment processing). Closing
                      this session will not affect other active trolleys.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      {selectedSession.paymentStatus === 'UNPAID' ? (
                        <button
                          type="button"
                          onClick={() => void handleMarkPaid()}
                          disabled={busy || !allPhysicalItemsChecked}
                          className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          {allPhysicalItemsChecked
                            ? 'Verify & Mark Demo Payment PAID'
                            : 'Check All Physical Items First'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleCloseSession()}
                          disabled={busy}
                          className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          Close Session &amp; Release {selectedSession.trolleyId}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-emerald-900">
                      <p className="font-semibold">
                        Session {selectedSession.customerId} Closed &amp; Archived
                      </p>
                      <p className="mt-0.5">
                        Trolley {selectedSession.trolleyId} is released. Scan the next customer&apos;s
                        Checkout QR or enter their Customer ID on the left.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSessionId(null)}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-emerald-300 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Load Next Customer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Bill History Archive */}
      {activeTab === 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Permanent Customer Bill Archive
                </h2>
                <p className="text-xs text-slate-500">
                  Historical customer bills are permanently preserved across all trolley cycles.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                {filteredHistory.length} bills
              </span>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No closed bills archived yet. Complete a customer checkout to see it preserved here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Customer ID</th>
                      <th className="py-3 px-4 font-semibold">Trolley</th>
                      <th className="py-3 px-4 font-semibold text-right">Items</th>
                      <th className="py-3 px-4 font-semibold text-right">Subtotal</th>
                      <th className="py-3 px-4 font-semibold text-right">GST</th>
                      <th className="py-3 px-4 font-semibold text-right">Grand Total</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredHistory.map((bill) => (
                      <tr
                        key={bill.customerId}
                        onClick={() => setSelectedSessionId(bill.customerId)}
                        className={`cursor-pointer transition-colors ${
                          bill.customerId === selectedSessionId
                            ? 'bg-emerald-50/70'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {bill.customerId}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700">{bill.trolleyId}</td>
                        <td className="py-3 px-4 font-mono text-right tabular-nums">
                          {bill.itemCount}
                        </td>
                        <td className="py-3 px-4 font-mono text-right tabular-nums">
                          {formatCurrency(bill.subtotal)}
                        </td>
                        <td className="py-3 px-4 font-mono text-right tabular-nums">
                          {formatCurrency(bill.gstTotal)}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-right tabular-nums text-slate-900">
                          {formatCurrency(bill.grandTotal)}
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold text-emerald-800">
                          PAID · CLOSED
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right: Archived Bill Receipt Inspector */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6">
            {!selectedSession || selectedSession.status !== 'CLOSED' ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Select any archived bill row to view its complete itemized receipt and timestamps.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="pb-3 border-b border-slate-200">
                  <p className="text-xs text-slate-500">Archived Tax Invoice</p>
                  <h3 className="text-xl font-mono font-bold text-slate-900 mt-0.5">
                    {selectedSession.customerId} · {selectedSession.trolleyId}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Closed {formatTimestamp(selectedSession.closedAt)} · Verified by{' '}
                    {selectedSession.verifiedByLabel || 'Staff'}
                  </p>
                </div>

                <div className="divide-y divide-slate-100">
                  {selectedItems.map((item) => (
                    <div key={item.productId} className="py-2.5 flex justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {item.quantity} × {formatCurrency(item.unitPrice)} · GST {item.gstRate}%
                        </p>
                      </div>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(item.lineTotal)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-200 space-y-1.5 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total GST</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.gstTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-slate-900 pt-1">
                    <span>Grand Total Paid</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(selectedSession.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Products, Trolleys & Staff Allowlist */}
      {activeTab === 'catalog' && (
        <div className="space-y-8">
          {/* Product Management */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Supermarket Product Catalog &amp; GST Rates
                </h2>
                <p className="text-sm text-slate-600">
                  Configure product-specific prices, QR codes, availability, and GST slabs (0%–28%).
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditingProduct({
                    productId: `PROD${String(products.length + 1).padStart(3, '0')}`,
                    name: '',
                    qrCode: `TT-PROD-ITEM-${String(products.length + 1).padStart(3, '0')}`,
                    price: 50,
                    gstRate: 5,
                    available: true,
                    category: 'Groceries',
                    unit: '1 Unit',
                    imagePath: '',
                  })
                }
                className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Product
              </button>
            </div>

            {editingProduct && (
              <form
                onSubmit={handleSaveProduct}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product ID
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.productId}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, productId: e.target.value })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    QR Code Value
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.qrCode}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, qrCode: e.target.value })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit / Pack Size
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.unit}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unit: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Price (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={editingProduct.price}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        price: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="28"
                    step="0.5"
                    required
                    value={editingProduct.gstRate}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        gstRate: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.category}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, category: e.target.value })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <label className="inline-flex items-center gap-2 min-h-[40px] text-sm font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProduct.available}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, available: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-emerald-700"
                    />
                    Available
                  </label>
                </div>

                <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[40px] px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    Save Product
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="py-3 px-3 font-semibold">ID</th>
                    <th className="py-3 px-3 font-semibold">Product</th>
                    <th className="py-3 px-3 font-semibold">QR Code</th>
                    <th className="py-3 px-3 font-semibold text-right">Price</th>
                    <th className="py-3 px-3 font-semibold text-right">GST</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.productId}>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600">{p.productId}</td>
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        {p.name}{' '}
                        <span className="text-xs font-normal text-slate-500">({p.unit})</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600">{p.qrCode}</td>
                      <td className="py-3 px-3 font-mono text-right tabular-nums">
                        {formatCurrency(p.price)}
                      </td>
                      <td className="py-3 px-3 font-mono text-right tabular-nums">{p.gstRate}%</td>
                      <td className="py-3 px-3 text-xs font-medium">
                        {p.available ? (
                          <span className="text-emerald-700">Available</span>
                        ) : (
                          <span className="text-red-700">Unavailable</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingProduct({
                              productId: p.productId,
                              name: p.name,
                              qrCode: p.qrCode,
                              price: p.price,
                              gstRate: p.gstRate,
                              available: p.available,
                              category: p.category,
                              unit: p.unit,
                              imagePath: p.imagePath,
                            })
                          }
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4 cursor-pointer"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trolley & Staff Allowlist Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Permanent Trolleys</h2>
              <form onSubmit={handleAddTrolley} className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={newTrolleyId}
                  onChange={(e) => setNewTrolleyId(e.target.value)}
                  placeholder="ID (e.g. T004)"
                  className="sm:w-32 min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm font-mono"
                />
                <input
                  type="text"
                  value={newTrolleyLabel}
                  onChange={(e) => setNewTrolleyLabel(e.target.value)}
                  placeholder="Label (e.g. Express Trolley 04)"
                  className="flex-1 min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy || !newTrolleyId.trim()}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Add Trolley
                </button>
              </form>

              <div className="divide-y divide-slate-100">
                {trolleys.map((t) => (
                  <div key={t.trolleyId} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{t.trolleyId}</span>
                      <span className="text-slate-300 mx-2">·</span>
                      <span className="text-slate-600">{t.label}</span>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        t.status === 'AVAILABLE' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {t.status} {t.activeCustomerId ? `(${t.activeCustomerId})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-700" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900">Authorized Counter Staff</h2>
              </div>

              {isBootstrappedAdmin ? (
                <>
                  <form onSubmit={handleAddStaff} className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="email"
                      value={newStaffEmail}
                      onChange={(e) => setNewStaffEmail(e.target.value)}
                      placeholder="Add staff Google email..."
                      className="flex-1 min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy || !newStaffEmail.trim()}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Authorize
                    </button>
                  </form>

                  <div className="divide-y divide-slate-100 text-sm">
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-900">
                        {BOOTSTRAPPED_ADMIN_EMAIL}
                      </span>
                      <span className="text-xs font-semibold text-emerald-800">Store Admin</span>
                    </div>
                    {allowlist.map((entry) => (
                      <div
                        key={entry.email}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <span className="font-mono text-xs text-slate-700 truncate">
                          {entry.email}
                        </span>
                        <button
                          type="button"
                          onClick={() => void staffRemoveAllowlistEmail(entry.email)}
                          className="text-xs font-semibold text-red-700 hover:text-red-800 cursor-pointer shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Signed in as counter staff ({user.email}). Store Admin ({BOOTSTRAPPED_ADMIN_EMAIL})
                  manages staff allowlist permissions.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Authenticated Staff QR Print Kit */}
      {activeTab === 'qr-kit' && (
        <QrPrintKit trolleys={trolleys} products={products} />
      )}

      {/* TAB 5: Competition Demo Guide */}
      {activeTab === 'demo-guide' && (
        <DemoGuideView trolleys={trolleys} onSelectTab={setActiveTab} />
      )}
    </div>
  );
}
