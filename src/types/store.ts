import { Timestamp } from 'firebase/firestore';

export type TrolleyStatus = 'AVAILABLE' | 'IN_USE';

export type SessionStatus = 'ACTIVE' | 'CHECKOUT_READY' | 'PAID' | 'CLOSED';

export type PaymentStatus = 'UNPAID' | 'PAID';

export type AppView = 'shopper' | 'staff' | 'qr-kit' | 'demo-guide';

export interface Product {
  productId: string;
  name: string;
  qrCode: string;
  price: number;
  gstRate: number;
  available: boolean;
  category: string;
  unit: string;
  imagePath: string;
  updatedAt?: Timestamp | null;
}

export interface Trolley {
  trolleyId: string;
  label: string;
  status: TrolleyStatus;
  activeSessionId: string | null;
  activeCustomerId: string | null;
  updatedAt?: Timestamp | null;
}

export interface ShoppingSession {
  customerId: string;
  trolleyId: string;
  status: SessionStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  itemCount: number;
  customerToken: string;
  physicalVerified: boolean;
  verifiedByUid?: string;
  verifiedByLabel?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  closedAt?: Timestamp | null;
}

export interface SessionItem {
  sessionId: string;
  productId: string;
  qrCode: string;
  name: string;
  unit: string;
  unitPrice: number;
  gstRate: number;
  quantity: number;
  lineSubtotal: number;
  lineGst: number;
  lineTotal: number;
  updatedAt?: Timestamp | null;
}

export interface StaffAllowlistEntry {
  email: string;
  role: 'STAFF';
  addedBy: string;
  createdAt?: Timestamp | null;
}
