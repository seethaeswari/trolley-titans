import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Minus,
  Plus,
  QrCode,
  Receipt,
  ScanLine,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HERO_IMAGE_PATH } from '../data/seedCatalog';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  matchProductByQr,
  setSessionCheckoutReady,
  startTrolleySession,
  updateCartItemQuantity,
} from '../services/trolleyService';
import { Product, SessionItem, ShoppingSession, Trolley } from '../types/store';
import {
  buildCheckoutQrPayload,
  formatCurrency,
  formatTimestamp,
  parseTrolleyQr,
} from '../utils/formatters';
import { ProductImage } from './ProductImage';
import { QrCodeGraphic } from './QrCodeGraphic';
import { QrScannerPanel } from './QrScannerPanel';

interface BrowserSessionBinding {
  trolleyId: string;
  customerId: string;
  customerToken?: string;
}

const LEGACY_GLOBAL_SESSION_KEY = 'trolley_titans_active_session_id';
const TAB_SESSION_STORAGE_KEY = 'trolley_titans_tab_session_v1';
const TROLLEY_SESSION_STORAGE_PREFIX = 'trolley_titans_trolley_session_v1:';

function readJsonStorage<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getLocalTrolleyBinding(trolleyId: string): BrowserSessionBinding | null {
  if (typeof window === 'undefined') return null;
  const parsed = readJsonStorage<BrowserSessionBinding>(
    window.localStorage,
    `${TROLLEY_SESSION_STORAGE_PREFIX}${trolleyId.toUpperCase()}`
  );
  if (parsed?.trolleyId && parsed?.customerId) {
    return {
      trolleyId: parsed.trolleyId.toUpperCase(),
      customerId: parsed.customerId.toUpperCase(),
      customerToken: parsed.customerToken,
    };
  }
  return null;
}

function persistSessionBinding(binding: BrowserSessionBinding): void {
  if (typeof window === 'undefined') return;
  const normalized: BrowserSessionBinding = {
    trolleyId: binding.trolleyId.toUpperCase(),
    customerId: binding.customerId.toUpperCase(),
    customerToken: binding.customerToken,
  };
  try {
    window.localStorage.removeItem(LEGACY_GLOBAL_SESSION_KEY);
    window.sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(normalized));
    window.localStorage.setItem(
      `${TROLLEY_SESSION_STORAGE_PREFIX}${normalized.trolleyId}`,
      JSON.stringify(normalized)
    );
  } catch {
    // ignore storage quota errors
  }
  const nextUrl = `${window.location.pathname}?trolley=${encodeURIComponent(
    normalized.trolleyId
  )}&customer=${encodeURIComponent(normalized.customerId)}`;
  window.history.replaceState({}, '', nextUrl);
}

function clearSessionBindingStorage(trolleyId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_GLOBAL_SESSION_KEY);
    window.sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
    if (trolleyId) {
      window.localStorage.removeItem(`${TROLLEY_SESSION_STORAGE_PREFIX}${trolleyId.toUpperCase()}`);
    }
  } catch {
    // ignore storage errors
  }
  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

function resolveInitialBinding(): {
  initialBinding: BrowserSessionBinding | null;
  pendingAutoStartTrolley: string | null;
} {
  if (typeof window === 'undefined') {
    return { initialBinding: null, pendingAutoStartTrolley: null };
  }
  try {
    window.localStorage.removeItem(LEGACY_GLOBAL_SESSION_KEY);
  } catch {
    // ignore storage errors
  }

  const params = new URLSearchParams(window.location.search);
  const urlTrolleyRaw = params.get('trolley');
  const urlCustomerRaw = params.get('customer');
  const urlTrolley = urlTrolleyRaw ? parseTrolleyQr(urlTrolleyRaw) : '';
  const urlCustomer = urlCustomerRaw ? urlCustomerRaw.trim().toUpperCase() : '';

  const tabBinding = readJsonStorage<BrowserSessionBinding>(
    window.sessionStorage,
    TAB_SESSION_STORAGE_KEY
  );

  // Case 1: Explicit ?trolley=T001&customer=CUST001 URL restores that exact session
  if (urlTrolley && urlCustomer) {
    const localToken = getLocalTrolleyBinding(urlTrolley)?.customerToken;
    return {
      initialBinding: {
        trolleyId: urlTrolley,
        customerId: urlCustomer,
        customerToken:
          tabBinding?.customerId === urlCustomer ? tabBinding.customerToken : localToken,
      },
      pendingAutoStartTrolley: null,
    };
  }

  // Case 2: Scanned permanent trolley URL (?trolley=T002)
  if (urlTrolley) {
    if (tabBinding && tabBinding.trolleyId.toUpperCase() === urlTrolley) {
      return {
        initialBinding: {
          trolleyId: urlTrolley,
          customerId: tabBinding.customerId.toUpperCase(),
          customerToken: tabBinding.customerToken,
        },
        pendingAutoStartTrolley: null,
      };
    }
    return { initialBinding: null, pendingAutoStartTrolley: urlTrolley };
  }

  // Case 3: Bare (/) restores only this specific tab's own binding (never a global cross-trolley key)
  if (tabBinding?.trolleyId && tabBinding?.customerId) {
    return {
      initialBinding: {
        trolleyId: tabBinding.trolleyId.toUpperCase(),
        customerId: tabBinding.customerId.toUpperCase(),
        customerToken: tabBinding.customerToken,
      },
      pendingAutoStartTrolley: null,
    };
  }

  return { initialBinding: null, pendingAutoStartTrolley: null };
}

interface CustomerAppProps {
  products: Product[];
  trolleys: Trolley[];
}

export function CustomerApp({ products, trolleys }: CustomerAppProps) {
  const initialResolutionRef = useRef(resolveInitialBinding());
  const [binding, setBinding] = useState<BrowserSessionBinding | null>(
    initialResolutionRef.current.initialBinding
  );
  const [session, setSession] = useState<ShoppingSession | null>(null);
  const [cartItems, setCartItems] = useState<SessionItem[]>([]);
  const [loadingSession, setLoadingSession] = useState<boolean>(
    Boolean(initialResolutionRef.current.initialBinding)
  );
  const [trolleyError, setTrolleyError] = useState<string | null>(null);
  const [productNotice, setProductNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const hadLiveSessionRef = useRef(false);
  const autoStartExecutedRef = useRef(false);

  // Persist active per-tab and per-trolley binding without ever overwriting another trolley
  useEffect(() => {
    if (binding && session?.status !== 'CLOSED') {
      persistSessionBinding(binding);
    }
  }, [binding, session?.status]);

  // Listen to this customer's independent Firestore session (verified by both customerId and trolleyId)
  useEffect(() => {
    if (!binding) {
      setSession(null);
      setCartItems([]);
      setLoadingSession(false);
      return;
    }

    const { customerId, trolleyId } = binding;
    setLoadingSession(true);

    const sessionRef = doc(db, 'sessions', customerId);
    const unsubSession = onSnapshot(
      sessionRef,
      (snap) => {
        if (!snap.exists()) {
          hadLiveSessionRef.current = false;
          clearSessionBindingStorage(trolleyId);
          setSession(null);
          setBinding(null);
          setLoadingSession(false);
          return;
        }

        const data = snap.data() as ShoppingSession;
        if (
          data.customerId.toUpperCase() !== customerId.toUpperCase() ||
          data.trolleyId.toUpperCase() !== trolleyId.toUpperCase()
        ) {
          hadLiveSessionRef.current = false;
          clearSessionBindingStorage(trolleyId);
          setSession(null);
          setBinding(null);
          setTrolleyError(
            `Session ${customerId} is bound to Trolley ${data.trolleyId}, not ${trolleyId}.`
          );
          setLoadingSession(false);
          return;
        }

        if (data.status === 'CLOSED') {
          clearSessionBindingStorage(data.trolleyId);
          if (!hadLiveSessionRef.current) {
            // Stored/bookmarked session was already CLOSED; render Welcome & Trolley Scanner at (/)
            setSession(null);
            setCartItems([]);
            setBinding(null);
            setLoadingSession(false);
            return;
          }
        } else {
          hadLiveSessionRef.current = true;
        }

        setSession(data);
        setLoadingSession(false);
      },
      (error) => {
        setLoadingSession(false);
        handleFirestoreError(error, OperationType.GET, `sessions/${customerId}`);
      }
    );

    const itemsQuery = query(
      collection(db, 'sessions', customerId, 'items'),
      where('sessionId', '==', customerId)
    );
    const unsubItems = onSnapshot(
      itemsQuery,
      (snapshot) => {
        const list: SessionItem[] = [];
        snapshot.forEach((docSnap) => list.push(docSnap.data() as SessionItem));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setCartItems(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `sessions/${customerId}/items`);
      }
    );

    return () => {
      unsubSession();
      unsubItems();
    };
  }, [binding?.customerId, binding?.trolleyId]);

  // Auto-start trolley session when opened directly via phone camera scanning a permanent trolley QR URL (/?trolley=T001)
  useEffect(() => {
    const pendingTrolley = initialResolutionRef.current.pendingAutoStartTrolley;
    if (!pendingTrolley || autoStartExecutedRef.current || binding) return;
    autoStartExecutedRef.current = true;

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }

    setTrolleyError(null);
    setBusyAction(true);
    void startTrolleySession(pendingTrolley)
      .then((result) => {
        const nextBinding: BrowserSessionBinding = {
          trolleyId: result.trolleyId,
          customerId: result.customerId,
          customerToken: result.customerToken,
        };
        hadLiveSessionRef.current = true;
        persistSessionBinding(nextBinding);
        setBinding(nextBinding);
        setProductNotice({
          type: 'success',
          message: `Session ${result.customerId} started on Trolley ${result.trolleyId}. Scan shelf products to add them to your cart.`,
        });
      })
      .catch((err) => {
        const raw = err instanceof Error ? err.message : 'Unable to start trolley session.';
        const clean = raw.replace(
          /^(TROLLEY_IN_USE|TROLLEY_NOT_FOUND|INVALID_TROLLEY_QR|SESSION_COLLISION):/,
          ''
        );
        setTrolleyError(clean);
      })
      .finally(() => {
        setBusyAction(false);
      });
  }, [binding]);

  // Group GST breakdown by rate (0%, 5%, 18%, etc.)
  const gstBreakdown = useMemo(() => {
    const map = new Map<number, { taxable: number; gst: number }>();
    for (const item of cartItems) {
      const existing = map.get(item.gstRate) || { taxable: 0, gst: 0 };
      map.set(item.gstRate, {
        taxable: Math.round((existing.taxable + item.lineSubtotal) * 100) / 100,
        gst: Math.round((existing.gst + item.lineGst) * 100) / 100,
      });
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [cartItems]);

  const handleScanTrolley = async (decodedText: string) => {
    setTrolleyError(null);
    setBusyAction(true);
    try {
      const result = await startTrolleySession(decodedText);
      const nextBinding: BrowserSessionBinding = {
        trolleyId: result.trolleyId,
        customerId: result.customerId,
        customerToken: result.customerToken,
      };
      hadLiveSessionRef.current = true;
      persistSessionBinding(nextBinding);
      setBinding(nextBinding);
      setProductNotice({
        type: 'success',
        message: `Session ${result.customerId} started on Trolley ${result.trolleyId}. Scan shelf products to add them to your cart.`,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Unable to start trolley session.';
      const clean = raw.replace(
        /^(TROLLEY_IN_USE|TROLLEY_NOT_FOUND|INVALID_TROLLEY_QR|SESSION_COLLISION):/,
        ''
      );
      setTrolleyError(clean);
    } finally {
      setBusyAction(false);
    }
  };

  const handleResumeOwnedTrolley = async (trolleyId: string) => {
    setTrolleyError(null);
    const local = getLocalTrolleyBinding(trolleyId);
    if (!local) return;
    setBusyAction(true);
    try {
      const snap = await getDoc(doc(db, 'sessions', local.customerId));
      if (!snap.exists()) {
        clearSessionBindingStorage(trolleyId);
        setTrolleyError(`Saved session ${local.customerId} was not found.`);
        return;
      }
      const data = snap.data() as ShoppingSession;
      if (data.trolleyId.toUpperCase() !== trolleyId.toUpperCase() || data.status === 'CLOSED') {
        clearSessionBindingStorage(trolleyId);
        setTrolleyError(`Session ${local.customerId} on Trolley ${trolleyId} is already closed.`);
        return;
      }
      if (local.customerToken && data.customerToken !== local.customerToken) {
        clearSessionBindingStorage(trolleyId);
        setTrolleyError(`Session token mismatch for Trolley ${trolleyId}.`);
        return;
      }
      hadLiveSessionRef.current = true;
      persistSessionBinding(local);
      setBinding(local);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `sessions/${local.customerId}`);
    } finally {
      setBusyAction(false);
    }
  };

  const handleScanProduct = async (decodedText: string) => {
    if (!session) return;
    setProductNotice(null);
    const matched = matchProductByQr(decodedText, products);
    if (!matched) {
      setProductNotice({
        type: 'error',
        message: `Unrecognized product QR "${decodedText}". Try scanning a valid store shelf QR (e.g., TT-PROD-RICE-001).`,
      });
      return;
    }
    if (!matched.available) {
      setProductNotice({
        type: 'error',
        message: `${matched.name} is currently marked unavailable by store staff.`,
      });
      return;
    }
    setBusyAction(true);
    try {
      const newQty = await updateCartItemQuantity(
        session.customerId,
        matched,
        1,
        'delta',
        session.trolleyId
      );
      setProductNotice({
        type: 'success',
        message: `Added ${matched.name} (${formatCurrency(matched.price)} · ${matched.gstRate}% GST) — Qty in cart: ${newQty}`,
      });
    } catch (err) {
      setProductNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not update cart.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleQtyChange = async (item: SessionItem, delta: number) => {
    if (!session) return;
    const product = products.find((p) => p.productId === item.productId) || {
      productId: item.productId,
      name: item.name,
      qrCode: item.qrCode,
      price: item.unitPrice,
      gstRate: item.gstRate,
      available: true,
      category: 'Grocery',
      unit: item.unit,
      imagePath: '',
    };
    setBusyAction(true);
    try {
      await updateCartItemQuantity(
        session.customerId,
        product,
        delta,
        'delta',
        session.trolleyId
      );
    } catch (err) {
      setProductNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not update item quantity.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleRemoveItem = async (item: SessionItem) => {
    if (!session) return;
    const product = products.find((p) => p.productId === item.productId) || {
      productId: item.productId,
      name: item.name,
      qrCode: item.qrCode,
      price: item.unitPrice,
      gstRate: item.gstRate,
      available: true,
      category: 'Grocery',
      unit: item.unit,
      imagePath: '',
    };
    setBusyAction(true);
    try {
      await updateCartItemQuantity(session.customerId, product, 0, 'exact', session.trolleyId);
    } catch (err) {
      setProductNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not remove item.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleGenerateCheckoutQr = async () => {
    if (!session || cartItems.length === 0) return;
    setBusyAction(true);
    try {
      await setSessionCheckoutReady(session.customerId, true, session.trolleyId);
    } finally {
      setBusyAction(false);
    }
  };

  const handleResumeShopping = async () => {
    if (!session) return;
    setBusyAction(true);
    try {
      await setSessionCheckoutReady(session.customerId, false, session.trolleyId);
    } finally {
      setBusyAction(false);
    }
  };

  const handleFinishAndReset = () => {
    hadLiveSessionRef.current = false;
    clearSessionBindingStorage(binding?.trolleyId || session?.trolleyId);
    setBinding(null);
    setSession(null);
    setCartItems([]);
    setTrolleyError(null);
    setProductNotice(null);
  };

  // Loading state while restoring local session
  if (loadingSession) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="inline-block w-8 h-8 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600">Connecting to your shopping trolley session...</p>
      </div>
    );
  }

  // STATE 1: Welcome & Trolley QR Scan (No active session)
  if (!session) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-10">
        {/* Hero Split Section */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-5">
            <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
              In-Store Queue-Free Checkout
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 text-balance leading-[1.12]">
              Welcome to Trolley Titans
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
              Walk into the aisle, scan the permanent QR code on your physical shopping trolley, scan
              shelf products as you pick them, and verify your GST bill at the counter in seconds.
            </p>
            <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-200 max-w-lg">
              <div>
                <p className="text-xs text-slate-500">Step 1</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">Scan Trolley QR</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Step 2</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">Scan Shelf Items</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Step 3</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">Counter Verify</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[260px] max-h-[380px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src={HERO_IMAGE_PATH}
                alt="Customer pushing a smart supermarket trolley with QR placard in a modern aisle"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* Trolley Scanner & Live Availability Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-4">
            {trolleyError && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold text-red-900">Trolley Currently Unavailable</h2>
                  <p className="text-sm text-red-800 mt-1">{trolleyError}</p>
                </div>
              </div>
            )}

            <QrScannerPanel
              title="Scan Permanent Trolley QR Code"
              subtitle="Point your mobile camera at the trolley handle QR sticker (e.g., T001, T002, T003)."
              inputPlaceholder="Enter Trolley ID (e.g., T001)"
              submitLabel="Start Session"
              onScan={handleScanTrolley}
              disabled={busyAction}
            />
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Store Trolleys</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live status across all connected devices
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {trolleys.length === 0 ? (
                <p className="py-6 text-sm text-slate-500 text-center">
                  Loading store trolleys...
                </p>
              ) : (
                trolleys.map((t) => {
                  const isAvailable = t.status === 'AVAILABLE' && !t.activeSessionId;
                  const ownedLocal = !isAvailable ? getLocalTrolleyBinding(t.trolleyId) : null;
                  const canResumeOwned =
                    Boolean(ownedLocal) &&
                    Boolean(t.activeSessionId) &&
                    ownedLocal?.customerId === t.activeSessionId?.toUpperCase();
                  return (
                    <div
                      key={t.trolleyId}
                      className="py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono font-bold text-slate-900">{t.trolleyId}</span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="text-slate-700 truncate">{t.label}</span>
                        </div>
                        <p className="text-xs mt-0.5 text-slate-500">
                          {isAvailable ? (
                            <span className="text-emerald-700 font-medium">Available for new customer</span>
                          ) : (
                            <span className="text-amber-700 font-medium">
                              In Use · Active Session {t.activeCustomerId || t.activeSessionId}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {canResumeOwned && (
                          <button
                            type="button"
                            onClick={() => void handleResumeOwnedTrolley(t.trolleyId)}
                            disabled={busyAction}
                            className="min-h-[40px] px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                          >
                            Resume {t.activeSessionId}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleScanTrolley(t.trolleyId)}
                          disabled={busyAction}
                          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                            isAvailable
                              ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {isAvailable ? `Scan ${t.trolleyId}` : `Test ${t.trolleyId}`}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  // STATE 2: Session PAID or CLOSED (Real-time completion receipt)
  if (session.status === 'PAID' || session.status === 'CLOSED') {
    const isClosed = session.status === 'CLOSED';
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                {isClosed ? 'Shopping Session Closed' : 'Demo Payment Verified at Counter'}
              </p>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">
                {isClosed
                  ? `Thank you for shopping, ${session.customerId}`
                  : `Demo Payment Confirmed for ${session.customerId}`}
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {isClosed
                  ? `Trolley ${session.trolleyId} has been released and is ready for the next customer. Your demonstration receipt is archived.`
                  : `Counter staff (${session.verifiedByLabel || 'Staff'}) verified your physical trolley items and marked the demonstration payment as PAID. Counter staff is closing the session now.`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-200 text-sm">
            <div>
              <p className="text-xs text-slate-500">Customer ID</p>
              <p className="font-mono font-bold text-slate-900 mt-0.5">{session.customerId}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trolley ID</p>
              <p className="font-mono font-bold text-slate-900 mt-0.5">{session.trolleyId}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Payment</p>
              <p className="font-semibold text-emerald-700 mt-0.5">{session.paymentStatus}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Session Status</p>
              <p className="font-semibold text-slate-900 mt-0.5">{session.status}</p>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Itemized Tax Receipt</h2>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {cartItems.map((item) => (
                <div
                  key={item.productId}
                  className="px-4 py-3 flex items-center justify-between gap-4 text-sm bg-white"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {item.quantity} × {formatCurrency(item.unitPrice)} · GST {item.gstRate}% (
                      {formatCurrency(item.lineGst)})
                    </p>
                  </div>
                  <p className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                    {formatCurrency(item.lineTotal)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal (before GST)</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Total GST</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.gstTotal)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Grand Total (Demo Paid)</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.grandTotal)}</span>
            </div>
            {session.closedAt && (
              <p className="text-xs text-slate-500 pt-1">
                Closed at {formatTimestamp(session.closedAt)} · School demonstration mode (no live payment gateway)
              </p>
            )}
          </div>

          {isClosed && (
            <button
              type="button"
              onClick={handleFinishAndReset}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors cursor-pointer"
            >
              Start New Customer Trolley Session
            </button>
          )}
        </div>
      </div>
    );
  }

  // STATE 3: Checkout QR Display (CHECKOUT_READY)
  if (session.status === 'CHECKOUT_READY') {
    const checkoutQrPayload = buildCheckoutQrPayload(
      session.customerId,
      session.trolleyId,
      session.customerToken
    );

    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => void handleResumeShopping()}
            disabled={busyAction}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Shelf Scanning
          </button>

          <div className="text-sm text-slate-600 font-mono tabular-nums">
            <span className="font-bold text-slate-900">{session.customerId}</span>
            <span className="mx-2 text-slate-300">·</span>
            <span>Trolley {session.trolleyId}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          <div className="md:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 flex flex-col items-center text-center space-y-4">
            <div>
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                Show at Billing Counter
              </p>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">Checkout QR Code</h1>
              <p className="text-sm text-slate-600 mt-1">
                Ask counter staff to scan this unique Checkout QR with the billing laptop camera or
                enter Customer ID <span className="font-mono font-bold text-slate-900">{session.customerId}</span>.
              </p>
            </div>

            <QrCodeGraphic
              value={checkoutQrPayload}
              label={`Checkout QR for ${session.customerId}`}
              size={220}
              showDownload={false}
            />

            <div className="w-full grid grid-cols-2 gap-2.5 text-left">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5">
                <p className="text-[11px] text-slate-500">Customer ID</p>
                <p className="font-mono text-sm font-bold text-emerald-800 mt-0.5">
                  {session.customerId}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5">
                <p className="text-[11px] text-slate-500">Trolley ID</p>
                <p className="font-mono text-sm font-bold text-slate-900 mt-0.5">
                  {session.trolleyId}
                </p>
              </div>
            </div>

            <div className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-left">
              <p className="text-xs text-slate-500">Session-Linked QR Payload</p>
              <p className="font-mono text-xs font-semibold text-slate-900 break-all mt-0.5">
                {checkoutQrPayload}
              </p>
            </div>

            <div className="w-full rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900 text-left">
              Awaiting Staff Counter verification. This screen updates automatically as soon as
              staff verifies your physical items, marks demo payment as PAID, and closes your session.
            </div>
          </div>

          <div className="md:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900">
              <Receipt className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <h2 className="text-lg font-bold">Complete Shopping Summary</h2>
            </div>

            <div className="divide-y divide-slate-100">
              {cartItems.map((item) => (
                <div key={item.productId} className="py-3 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                      Qty {item.quantity} × {formatCurrency(item.unitPrice)} · GST {item.gstRate}%
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(item.lineTotal)}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                      incl. {formatCurrency(item.lineGst)} GST
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatCurrency(session.subtotal)}</span>
              </div>
              {gstBreakdown.map(([rate, vals]) => (
                <div key={rate} className="flex justify-between text-xs text-slate-500">
                  <span>GST @ {rate}% (on {formatCurrency(vals.taxable)})</span>
                  <span className="font-mono tabular-nums">{formatCurrency(vals.gst)}</span>
                </div>
              ))}
              <div className="flex justify-between text-slate-700 font-medium">
                <span>Total GST</span>
                <span className="font-mono tabular-nums">{formatCurrency(session.gstTotal)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>Grand Total</span>
                <span className="font-mono tabular-nums">{formatCurrency(session.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STATE 4: Active Shopping & Cart (ACTIVE)
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 pb-28 lg:pb-10 space-y-6">
      {/* Compact Session Identity Strip */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-slate-500">Customer ID</p>
            <p className="text-lg font-mono font-bold text-emerald-800">{session.customerId}</p>
          </div>
          <div className="h-8 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />
          <div>
            <p className="text-xs text-slate-500">Trolley ID</p>
            <p className="text-lg font-mono font-bold text-slate-900">{session.trolleyId}</p>
          </div>
          <div className="h-8 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />
          <div>
            <p className="text-xs text-slate-500">Session Status</p>
            <p className="text-sm font-semibold text-slate-900">Active Shopping</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs text-slate-500">Running Grand Total</p>
          <p className="text-xl font-mono font-bold text-slate-900 tabular-nums">
            {formatCurrency(session.grandTotal)}
          </p>
        </div>
      </div>

      {/* Main 2-Column Shopping Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Product QR Scanner & Shelf Catalog */}
        <div className="lg:col-span-7 space-y-6">
          {productNotice && (
            <div
              role="status"
              className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                productNotice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              {productNotice.message}
            </div>
          )}

          <QrScannerPanel
            title="Scan Shelf Product QR Code"
            subtitle="Scan any product label in the aisle to inspect its price and GST rate and add it to your cart."
            inputPlaceholder="Enter Product QR (e.g., TT-PROD-RICE-001)"
            submitLabel="Add Product"
            onScan={handleScanProduct}
            disabled={busyAction}
          />

          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Store Shelf Catalog</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tap to simulate scanning a shelf product QR during booth demos
                </p>
              </div>
              <ScanLine className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {products.map((product) => (
                <div
                  key={product.productId}
                  className="rounded-xl border border-slate-200 p-3.5 flex items-center gap-3.5 hover:border-slate-300 transition-colors bg-white"
                >
                  <ProductImage
                    src={product.imagePath}
                    alt={product.name}
                    className="w-16 h-16"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {product.unit} · GST {product.gstRate}%
                    </p>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(product.price)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleScanProduct(product.qrCode)}
                        disabled={!product.available || busyAction}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {product.available ? 'Add to Cart' : 'Out of Stock'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Live Cart & GST Billing Summary */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-5 lg:sticky lg:top-20">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <ShoppingCart className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">Your Trolley Cart</h2>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums">
              {session.itemCount} {session.itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          {cartItems.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">Your trolley is empty</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Scan a product QR code using your mobile camera or select an item from the shelf
                catalog.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pr-1">
              {cartItems.map((item) => {
                const productMeta = products.find((p) => p.productId === item.productId);
                return (
                  <div key={item.productId} className="py-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <ProductImage
                          src={productMeta?.imagePath || ''}
                          alt={item.name}
                          className="w-11 h-11"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {formatCurrency(item.unitPrice)} · GST {item.gstRate}%
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {formatCurrency(item.lineTotal)}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                          +{formatCurrency(item.lineGst)} tax
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center border border-slate-200 rounded-xl bg-slate-50">
                        <button
                          type="button"
                          onClick={() => void handleQtyChange(item, -1)}
                          disabled={busyAction}
                          aria-label={`Decrease ${item.name} quantity`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-200 rounded-l-xl transition-colors cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <span className="px-3 text-sm font-mono font-bold text-slate-900 tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleQtyChange(item, 1)}
                          disabled={busyAction}
                          aria-label={`Increase ${item.name} quantity`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-200 rounded-r-xl transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleRemoveItem(item)}
                        disabled={busyAction}
                        className="inline-flex items-center gap-1.5 min-h-[40px] px-3 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Billing Totals */}
          <div className="pt-4 border-t border-slate-200 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.subtotal)}</span>
            </div>
            {gstBreakdown.map(([rate, vals]) => (
              <div key={rate} className="flex justify-between text-xs text-slate-500">
                <span>GST {rate}% slab</span>
                <span className="font-mono tabular-nums">{formatCurrency(vals.gst)}</span>
              </div>
            ))}
            <div className="flex justify-between text-slate-700 font-medium">
              <span>Total GST</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.gstTotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Grand Total</span>
              <span className="font-mono tabular-nums">{formatCurrency(session.grandTotal)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerateCheckoutQr()}
            disabled={cartItems.length === 0 || busyAction}
            className="hidden lg:flex w-full items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <QrCode className="w-4 h-4" aria-hidden="true" />
            Generate Checkout QR Code
          </button>
        </div>
      </div>

      {/* Mobile Sticky Bottom Checkout CTA (compact <= 72px to stay well under 15% mobile cap) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
          <div>
            <p className="text-[11px] text-slate-500">{session.itemCount} items · incl. GST</p>
            <p className="text-base font-mono font-bold text-slate-900 tabular-nums">
              {formatCurrency(session.grandTotal)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateCheckoutQr()}
            disabled={cartItems.length === 0 || busyAction}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <QrCode className="w-4 h-4" aria-hidden="true" />
            Checkout QR
          </button>
        </div>
      </div>
    </div>
  );
}
