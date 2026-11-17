import { Timestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const PUBLIC_APP_URL_STORAGE_KEY = 'trolley_titans_public_app_url_v1';
export const DEFAULT_PUBLIC_APP_URL = `https://${firebaseConfig.projectId}.web.app`;

export function isInternalPreviewOrigin(rawUrl: string): boolean {
  const lower = rawUrl.trim().toLowerCase();
  if (!lower) return true;
  try {
    const parsed = new URL(lower.startsWith('http') ? lower : `https://${lower}`);
    const host = parsed.hostname.toLowerCase();
    return (
      host.startsWith('ais-dev-') ||
      host.startsWith('ais-pre-') ||
      host.endsWith('aistudio.google.com') ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0'
    );
  } catch {
    return true;
  }
}

export function normalizePublicOrigin(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProto);
    if (isInternalPreviewOrigin(url.origin)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getStoredPublicAppUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(PUBLIC_APP_URL_STORAGE_KEY);
    return saved ? normalizePublicOrigin(saved) : null;
  } catch {
    return null;
  }
}

export function saveStoredPublicAppUrl(rawUrl: string): string {
  const normalized = normalizePublicOrigin(rawUrl);
  if (!normalized) {
    throw new Error(
      'Enter a public HTTPS website URL (never an ais-dev, ais-pre, AI Studio preview, or localhost URL).'
    );
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PUBLIC_APP_URL_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function clearStoredPublicAppUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PUBLIC_APP_URL_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getPublicAppOrigin(overrideOrigin?: string): string {
  if (overrideOrigin) {
    const normalized = normalizePublicOrigin(overrideOrigin);
    if (normalized) return normalized;
  }

  const envUrl = import.meta.env?.VITE_PUBLIC_APP_URL;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    const normalizedEnv = normalizePublicOrigin(envUrl);
    if (normalizedEnv) return normalizedEnv;
  }

  const stored = getStoredPublicAppUrl();
  if (stored) return stored;

  if (typeof window !== 'undefined' && window.location?.origin) {
    const current = normalizePublicOrigin(window.location.origin);
    if (current) return current;
  }

  return DEFAULT_PUBLIC_APP_URL;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTimestamp(ts?: Timestamp | null): string {
  if (!ts) return 'Just now';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch {
    return 'Just now';
  }
}

export function parseTrolleyQr(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { trolleyId?: string };
      if (parsed.trolleyId) return parsed.trolleyId.trim().toUpperCase();
    } catch {
      // fall through to text parsing
    }
  }
  // Support direct web URL QR codes such as https://example.com/?trolley=T001
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('trolley=')) {
    try {
      const urlObj = trimmed.startsWith('http')
        ? new URL(trimmed)
        : new URL(trimmed, 'https://trolley-titans.local');
      const param = urlObj.searchParams.get('trolley');
      if (param) return param.trim().toUpperCase();
    } catch {
      const match = trimmed.match(/[?&]trolley=([^&]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]).trim().toUpperCase();
    }
  }
  if (trimmed.toUpperCase().startsWith('TROLLEY_TITANS:TROLLEY:')) {
    return trimmed.split(':').pop()?.trim().toUpperCase() || '';
  }
  return trimmed.toUpperCase();
}

export interface ParsedCheckoutQr {
  customerId: string;
  trolleyId?: string;
  sessionToken?: string;
  invoiceRef?: string;
  lookupMode: 'checkout_qr' | 'customer_id' | 'trolley_id' | 'invalid';
  error?: string;
}

const CUSTOMER_ID_RE = /^CUST[0-9]{3,}$/;
const TROLLEY_ID_RE = /^T[0-9]{3,}$/;

export function parseCheckoutQr(rawInput: string): ParsedCheckoutQr {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      customerId: '',
      lookupMode: 'invalid',
      error: 'Checkout QR code or lookup input is empty.',
    };
  }

  // 1. Canonical Trolley Titans Checkout QR: TROLLEY_TITANS:CHECKOUT:CUST006:T001[:TOKEN[:INVOICE]]
  if (trimmed.toUpperCase().startsWith('TROLLEY_TITANS:CHECKOUT:')) {
    const parts = trimmed.split(':');
    const customerId = (parts[2] || '').trim().toUpperCase();
    const trolleyId = parts[3] ? parts[3].trim().toUpperCase() : undefined;
    const sessionToken = parts[4] ? parts[4].trim().toUpperCase() : undefined;
    const invoiceRef = parts[5] ? parts[5].trim().toUpperCase() : undefined;

    if (!CUSTOMER_ID_RE.test(customerId)) {
      return {
        customerId: '',
        lookupMode: 'invalid',
        error: 'Invalid Checkout QR code: missing or malformed Customer ID.',
      };
    }
    if (trolleyId && !TROLLEY_ID_RE.test(trolleyId)) {
      return {
        customerId: '',
        lookupMode: 'invalid',
        error: `Invalid Checkout QR code: malformed Trolley Number "${trolleyId}".`,
      };
    }

    return {
      customerId,
      trolleyId,
      sessionToken,
      invoiceRef: invoiceRef || `INV-${customerId}`,
      lookupMode: 'checkout_qr',
    };
  }

  // 2. Reject permanent trolley tag or shelf product QR prefixes with clear guidance
  if (trimmed.toUpperCase().startsWith('TT-PROD-')) {
    return {
      customerId: '',
      lookupMode: 'invalid',
      error: `Scanned "${trimmed}" is a Shelf Product QR code, not a Customer Checkout QR.`,
    };
  }
  if (trimmed.toUpperCase().startsWith('TROLLEY_TITANS:TROLLEY:')) {
    return {
      customerId: '',
      lookupMode: 'invalid',
      error: 'Scanned QR is a permanent Trolley sticker, not a Customer Checkout QR.',
    };
  }

  // 3. JSON Checkout QR payload
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        productId?: string;
        qrCode?: string;
        customerId?: string;
        customer?: string;
        trolleyId?: string;
        trolley?: string;
        sessionToken?: string;
        customerToken?: string;
        token?: string;
        invoiceNumber?: string;
        invoiceId?: string;
        invoiceRef?: string;
      };

      if (parsed.type?.toUpperCase() === 'PRODUCT' || ((parsed.productId || parsed.qrCode) && !parsed.customerId && !parsed.customer)) {
        return {
          customerId: '',
          lookupMode: 'invalid',
          error: 'Scanned JSON is a Product QR code, not a Customer Checkout QR.',
        };
      }

      const customerId = (parsed.customerId || parsed.customer || '').trim().toUpperCase();
      const trolleyId = (parsed.trolleyId || parsed.trolley || '').trim().toUpperCase() || undefined;
      const sessionToken =
        (parsed.sessionToken || parsed.customerToken || parsed.token || '').trim().toUpperCase() ||
        undefined;
      const invoiceRef =
        (parsed.invoiceNumber || parsed.invoiceId || parsed.invoiceRef || '').trim().toUpperCase() ||
        undefined;

      if (CUSTOMER_ID_RE.test(customerId)) {
        if (trolleyId && !TROLLEY_ID_RE.test(trolleyId)) {
          return {
            customerId: '',
            lookupMode: 'invalid',
            error: `Invalid Checkout QR code: malformed Trolley Number "${trolleyId}".`,
          };
        }
        return {
          customerId,
          trolleyId,
          sessionToken,
          invoiceRef: invoiceRef || `INV-${customerId}`,
          lookupMode: 'checkout_qr',
        };
      }

      if (trolleyId && TROLLEY_ID_RE.test(trolleyId)) {
        return {
          customerId: '',
          trolleyId,
          sessionToken,
          invoiceRef,
          lookupMode: 'trolley_id',
        };
      }

      return {
        customerId: '',
        lookupMode: 'invalid',
        error: 'Invalid Checkout QR JSON payload: no valid Customer ID found.',
      };
    } catch {
      return {
        customerId: '',
        lookupMode: 'invalid',
        error: 'Malformed JSON Checkout QR code.',
      };
    }
  }

  // 4. URL-based QR code (supports ?customer=CUST001&trolley=T001 or rejects permanent ?trolley=T001 URLs)
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?') || trimmed.includes('/')) {
    try {
      const urlObj = /^https?:\/\//i.test(trimmed)
        ? new URL(trimmed)
        : new URL(trimmed, 'https://trolley-titans.local');
      const customerParam = (
        urlObj.searchParams.get('customer') ||
        urlObj.searchParams.get('customerId') ||
        ''
      )
        .trim()
        .toUpperCase();
      const trolleyParam = (
        urlObj.searchParams.get('trolley') ||
        urlObj.searchParams.get('trolleyId') ||
        ''
      )
        .trim()
        .toUpperCase();
      const tokenParam = (
        urlObj.searchParams.get('token') ||
        urlObj.searchParams.get('sessionToken') ||
        ''
      )
        .trim()
        .toUpperCase();
      const invoiceParam = (
        urlObj.searchParams.get('invoice') ||
        urlObj.searchParams.get('invoiceNumber') ||
        ''
      )
        .trim()
        .toUpperCase();

      if (CUSTOMER_ID_RE.test(customerParam)) {
        return {
          customerId: customerParam,
          trolleyId: TROLLEY_ID_RE.test(trolleyParam) ? trolleyParam : undefined,
          sessionToken: tokenParam || undefined,
          invoiceRef: invoiceParam || `INV-${customerParam}`,
          lookupMode: 'checkout_qr',
        };
      }

      if (TROLLEY_ID_RE.test(trolleyParam)) {
        return {
          customerId: '',
          lookupMode: 'invalid',
          error: `Scanned QR is a permanent Trolley entrance link (${trolleyParam}), not a Customer Checkout QR. Scan the Checkout QR on the customer phone or type ${trolleyParam} in manual lookup.`,
        };
      }
    } catch {
      // fall through to invalid
    }

    return {
      customerId: '',
      lookupMode: 'invalid',
      error: 'Scanned QR is not a valid Trolley Titans Checkout QR code.',
    };
  }

  // 5. Direct manual lookup IDs (CUST001 or T001)
  const upper = trimmed.toUpperCase();
  if (CUSTOMER_ID_RE.test(upper)) {
    return {
      customerId: upper,
      invoiceRef: `INV-${upper}`,
      lookupMode: 'customer_id',
    };
  }

  if (TROLLEY_ID_RE.test(upper)) {
    return {
      customerId: '',
      trolleyId: upper,
      lookupMode: 'trolley_id',
    };
  }

  return {
    customerId: '',
    lookupMode: 'invalid',
    error: `Invalid Checkout QR code or ID ("${trimmed.slice(0, 40)}"). Scan a valid Checkout QR or enter Customer ID (e.g., CUST001) or Trolley Number (e.g., T001).`,
  };
}

export function buildTrolleyQrPayload(trolleyId: string, publicOriginOverride?: string): string {
  const origin = getPublicAppOrigin(publicOriginOverride);
  return `${origin}/?trolley=${encodeURIComponent(trolleyId)}`;
}

export function buildCheckoutQrPayload(
  customerId: string,
  trolleyId: string,
  customerToken?: string
): string {
  const tokenSlice = customerToken ? `:${customerToken.slice(0, 8).toUpperCase()}` : '';
  return `TROLLEY_TITANS:CHECKOUT:${customerId}:${trolleyId}${tokenSlice}`;
}
