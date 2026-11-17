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

export function parseCheckoutQr(rawInput: string): {
  customerId: string;
  trolleyId?: string;
  sessionToken?: string;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) return { customerId: '' };
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        customerId?: string;
        trolleyId?: string;
        sessionToken?: string;
      };
      return {
        customerId: (parsed.customerId || '').trim().toUpperCase(),
        trolleyId: parsed.trolleyId ? parsed.trolleyId.trim().toUpperCase() : undefined,
        sessionToken: parsed.sessionToken ? parsed.sessionToken.trim().toUpperCase() : undefined,
      };
    } catch {
      // fall through
    }
  }
  if (trimmed.toUpperCase().startsWith('TROLLEY_TITANS:CHECKOUT:')) {
    const parts = trimmed.split(':');
    return {
      customerId: (parts[2] || '').trim().toUpperCase(),
      trolleyId: parts[3] ? parts[3].trim().toUpperCase() : undefined,
      sessionToken: parts[4] ? parts[4].trim().toUpperCase() : undefined,
    };
  }
  return { customerId: trimmed.toUpperCase() };
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
