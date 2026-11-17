import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { BOOTSTRAPPED_ADMIN_EMAIL, SAMPLE_PRODUCTS, SAMPLE_TROLLEYS } from '../data/seedCatalog';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Product, SessionItem, ShoppingSession, Trolley } from '../types/store';
import { parseTrolleyQr, round2 } from '../utils/formatters';

function generateCustomerToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

export async function ensureStoreInitialized(): Promise<void> {
  try {
    const counterRef = doc(db, 'counters', 'customerSeq');
    const counterSnap = await getDoc(counterRef);
    if (!counterSnap.exists()) {
      await setDoc(counterRef, {
        lastNumber: 0,
        updatedAt: serverTimestamp(),
      });
    }

    for (const trolley of SAMPLE_TROLLEYS) {
      const tRef = doc(db, 'trolleys', trolley.trolleyId);
      const tSnap = await getDoc(tRef);
      if (!tSnap.exists()) {
        await setDoc(tRef, {
          ...trolley,
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const product of SAMPLE_PRODUCTS) {
      const pRef = doc(db, 'products', product.productId);
      const pSnap = await getDoc(pRef);
      if (!pSnap.exists()) {
        await setDoc(pRef, {
          ...product,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    // Non-fatal if rules prevent re-creating already existing docs
    console.warn('Store initialization notice:', error);
  }
}

export async function startTrolleySession(rawQrOrId: string): Promise<{
  customerId: string;
  trolleyId: string;
  customerToken: string;
}> {
  const trolleyId = parseTrolleyQr(rawQrOrId);
  if (!trolleyId || !/^T[0-9]{3,}$/.test(trolleyId)) {
    throw new Error('INVALID_TROLLEY_QR:Please scan a valid permanent trolley QR code (for example, T001, T002, or T003).');
  }

  const trolleyRef = doc(db, 'trolleys', trolleyId);
  const counterRef = doc(db, 'counters', 'customerSeq');
  const customerToken = generateCustomerToken();

  try {
    return await runTransaction(db, async (tx) => {
      const trolleySnap = await tx.get(trolleyRef);
      if (!trolleySnap.exists()) {
        throw new Error(`TROLLEY_NOT_FOUND:Trolley ${trolleyId} is not registered in the store system.`);
      }

      const trolleyData = trolleySnap.data() as Trolley;
      if (trolleyData.status !== 'AVAILABLE' || trolleyData.activeSessionId !== null) {
        const holder = trolleyData.activeCustomerId || trolleyData.activeSessionId || 'another shopper';
        throw new Error(
          `TROLLEY_IN_USE:Trolley ${trolleyId} is currently in use (${holder}). Only one active shopping session per trolley is allowed until counter staff closes the current session.`
        );
      }

      const counterSnap = await tx.get(counterRef);
      const lastNumber = counterSnap.exists() ? Number(counterSnap.data().lastNumber || 0) : 0;
      const nextNumber = lastNumber + 1;
      const customerId = `CUST${String(nextNumber).padStart(3, '0')}`;
      const sessionRef = doc(db, 'sessions', customerId);
      const existingSessionSnap = await tx.get(sessionRef);
      if (existingSessionSnap.exists()) {
        throw new Error(`SESSION_COLLISION:Session ${customerId} already exists and cannot be overwritten.`);
      }

      if (!counterSnap.exists()) {
        tx.set(counterRef, {
          lastNumber: nextNumber,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(counterRef, {
          lastNumber: nextNumber,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(sessionRef, {
        customerId,
        trolleyId,
        status: 'ACTIVE',
        paymentStatus: 'UNPAID',
        subtotal: 0,
        gstTotal: 0,
        grandTotal: 0,
        itemCount: 0,
        customerToken,
        physicalVerified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(trolleyRef, {
        status: 'IN_USE',
        activeSessionId: customerId,
        activeCustomerId: customerId,
        updatedAt: serverTimestamp(),
      });

      return { customerId, trolleyId, customerToken };
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('TROLLEY_IN_USE:') ||
      error.message.startsWith('TROLLEY_NOT_FOUND:') ||
      error.message.startsWith('INVALID_TROLLEY_QR:')
    )) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `sessions/trolleys/${trolleyId}`);
  }
}

export async function updateCartItemQuantity(
  sessionId: string,
  product: Product,
  quantityDeltaOrExact: number,
  mode: 'delta' | 'exact' = 'delta',
  expectedTrolleyId?: string
): Promise<number> {
  if (!product.available && mode === 'delta' && quantityDeltaOrExact > 0) {
    throw new Error(`${product.name} is currently unavailable on shelves.`);
  }

  const sessionRef = doc(db, 'sessions', sessionId);
  const itemsColRef = query(
    collection(db, 'sessions', sessionId, 'items'),
    where('sessionId', '==', sessionId)
  );

  try {
    const currentItemsSnap = await getDocs(itemsColRef);
    const existingItemIds = new Set<string>();
    currentItemsSnap.forEach((docSnap) => existingItemIds.add(docSnap.id));
    existingItemIds.add(product.productId);

    return await runTransaction(db, async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists()) {
        throw new Error('Shopping session was not found.');
      }
      const session = sessionSnap.data() as ShoppingSession;
      if (expectedTrolleyId && session.trolleyId !== expectedTrolleyId) {
        throw new Error(`Session ${sessionId} belongs to Trolley ${session.trolleyId}, not ${expectedTrolleyId}.`);
      }
      if (session.paymentStatus === 'PAID' || session.status === 'CLOSED' || session.status === 'PAID') {
        throw new Error('This shopping session has already been paid or closed and can no longer be edited.');
      }

      const trolleySnap = await tx.get(doc(db, 'trolleys', session.trolleyId));
      if (trolleySnap.exists()) {
        const trolleyData = trolleySnap.data() as Trolley;
        if (trolleyData.activeSessionId !== sessionId) {
          throw new Error(`Trolley ${session.trolleyId} is no longer bound to session ${sessionId}.`);
        }
      }

      const itemSnaps = await Promise.all(
        Array.from(existingItemIds).map((pid) => tx.get(doc(db, 'sessions', sessionId, 'items', pid)))
      );

      let targetNewQty = 0;
      let subtotal = 0;
      let gstTotal = 0;
      let grandTotal = 0;
      let itemCount = 0;

      for (const snap of itemSnaps) {
        const pid = snap.id;
        if (pid === product.productId) {
          const currentQty = snap.exists() ? Number((snap.data() as SessionItem).quantity) : 0;
          targetNewQty = mode === 'delta' ? currentQty + quantityDeltaOrExact : quantityDeltaOrExact;
          if (targetNewQty > 200) targetNewQty = 200;

          if (targetNewQty <= 0) {
            if (snap.exists()) {
              tx.delete(snap.ref);
            }
            targetNewQty = 0;
          } else {
            const lineSubtotal = round2(product.price * targetNewQty);
            const lineGst = round2(lineSubtotal * (product.gstRate / 100));
            const lineTotal = round2(lineSubtotal + lineGst);

            subtotal = round2(subtotal + lineSubtotal);
            gstTotal = round2(gstTotal + lineGst);
            grandTotal = round2(grandTotal + lineTotal);
            itemCount += targetNewQty;

            tx.set(snap.ref, {
              sessionId,
              productId: product.productId,
              qrCode: product.qrCode,
              name: product.name,
              unit: product.unit,
              unitPrice: product.price,
              gstRate: product.gstRate,
              quantity: targetNewQty,
              lineSubtotal,
              lineGst,
              lineTotal,
              updatedAt: serverTimestamp(),
            });
          }
        } else if (snap.exists()) {
          const item = snap.data() as SessionItem;
          subtotal = round2(subtotal + item.lineSubtotal);
          gstTotal = round2(gstTotal + item.lineGst);
          grandTotal = round2(grandTotal + item.lineTotal);
          itemCount += item.quantity;
        }
      }

      tx.update(sessionRef, {
        status: 'ACTIVE',
        subtotal,
        gstTotal,
        grandTotal,
        itemCount,
        updatedAt: serverTimestamp(),
      });

      return targetNewQty;
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('unavailable') ||
      error.message.includes('already been paid') ||
      error.message.includes('not found') ||
      error.message.includes('belongs to Trolley') ||
      error.message.includes('no longer bound')
    )) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}/items/${product.productId}`);
  }
}

export async function setSessionCheckoutReady(
  sessionId: string,
  ready: boolean,
  expectedTrolleyId?: string
): Promise<void> {
  const sessionRef = doc(db, 'sessions', sessionId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists()) {
        throw new Error(`Session ${sessionId} was not found.`);
      }
      const session = snap.data() as ShoppingSession;
      if (expectedTrolleyId && session.trolleyId !== expectedTrolleyId) {
        throw new Error(`Session ${sessionId} belongs to Trolley ${session.trolleyId}, not ${expectedTrolleyId}.`);
      }
      if (session.paymentStatus === 'PAID' || session.status === 'CLOSED' || session.status === 'PAID') {
        throw new Error('Session has already been paid or closed.');
      }
      tx.update(sessionRef, {
        status: ready ? 'CHECKOUT_READY' : 'ACTIVE',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('was not found') ||
      error.message.includes('belongs to Trolley') ||
      error.message.includes('already been paid')
    )) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function checkIsStaff(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) return true;
  try {
    const snap = await getDoc(doc(db, 'staff_allowlist', normalized));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function staffVerifyAndMarkPaid(sessionId: string, staffUser: User): Promise<void> {
  const sessionRef = doc(db, 'sessions', sessionId);
  try {
    await updateDoc(sessionRef, {
      status: 'PAID',
      paymentStatus: 'PAID',
      physicalVerified: true,
      paidAt: serverTimestamp(),
      verifiedByUid: staffUser.uid,
      verifiedByLabel: staffUser.displayName || staffUser.email || 'Counter Staff',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function staffCloseSession(sessionId: string, trolleyId: string): Promise<void> {
  const sessionRef = doc(db, 'sessions', sessionId);
  const trolleyRef = doc(db, 'trolleys', trolleyId);
  try {
    await runTransaction(db, async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists()) {
        throw new Error(`Session ${sessionId} not found.`);
      }
      const session = sessionSnap.data() as ShoppingSession;
      if (session.trolleyId !== trolleyId) {
        throw new Error(`Trolley mismatch: Session ${sessionId} belongs to ${session.trolleyId}, not ${trolleyId}.`);
      }
      if (session.paymentStatus !== 'PAID') {
        throw new Error('Payment must be marked PAID before closing this session.');
      }
      if (session.status === 'CLOSED') {
        throw new Error('Session is already CLOSED.');
      }

      const trolleySnap = await tx.get(trolleyRef);
      if (!trolleySnap.exists()) {
        throw new Error(`Trolley ${trolleyId} not found.`);
      }

      tx.update(sessionRef, {
        status: 'CLOSED',
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(trolleyRef, {
        status: 'AVAILABLE',
        activeSessionId: null,
        activeCustomerId: null,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Payment must be marked PAID') ||
      error.message.includes('already CLOSED') ||
      error.message.includes('not found') ||
      error.message.includes('Trolley mismatch')
    )) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}`);
  }
}

export async function staffSaveProduct(product: Omit<Product, 'updatedAt'>): Promise<void> {
  const productRef = doc(db, 'products', product.productId);
  try {
    await setDoc(productRef, {
      ...product,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `products/${product.productId}`);
  }
}

export async function staffCreateTrolley(trolleyId: string, label: string): Promise<void> {
  const normalized = trolleyId.trim().toUpperCase();
  if (!/^T[0-9]{3,}$/.test(normalized)) {
    throw new Error('Trolley ID must follow format T001, T004, T005, etc.');
  }
  const trolleyRef = doc(db, 'trolleys', normalized);
  try {
    const existing = await getDoc(trolleyRef);
    if (existing.exists()) {
      throw new Error(`Trolley ${normalized} already exists.`);
    }
    await setDoc(trolleyRef, {
      trolleyId: normalized,
      label: label.trim() || `Smart Trolley ${normalized}`,
      status: 'AVAILABLE',
      activeSessionId: null,
      activeCustomerId: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('format'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `trolleys/${normalized}`);
  }
}

export async function staffAddAllowlistEmail(email: string, adminEmail: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  try {
    await setDoc(doc(db, 'staff_allowlist', normalized), {
      email: normalized,
      role: 'STAFF',
      addedBy: adminEmail,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `staff_allowlist/${normalized}`);
  }
}

export async function staffRemoveAllowlistEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  try {
    await deleteDoc(doc(db, 'staff_allowlist', normalized));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `staff_allowlist/${normalized}`);
  }
}

export function matchProductByQr(rawQr: string, products: Product[]): Product | null {
  const trimmed = rawQr.trim();
  if (!trimmed) return null;

  let lookup = trimmed.toUpperCase();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { qrCode?: string; productId?: string };
      lookup = (parsed.qrCode || parsed.productId || '').trim().toUpperCase();
    } catch {
      // ignore
    }
  }

  return (
    products.find(
      (p) =>
        p.qrCode.toUpperCase() === lookup ||
        p.productId.toUpperCase() === lookup ||
        p.name.toUpperCase() === lookup
    ) || null
  );
}
