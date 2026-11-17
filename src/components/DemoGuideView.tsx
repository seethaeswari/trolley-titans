import { ArrowRight, CheckCircle2, History, QrCode, ShieldCheck } from 'lucide-react';
import { Trolley } from '../types/store';
import { getPublicAppOrigin } from '../utils/formatters';

export type StaffPortalTab = 'counter' | 'history' | 'catalog' | 'qr-kit' | 'demo-guide';

interface DemoGuideViewProps {
  trolleys: Trolley[];
  onSelectTab: (tab: StaffPortalTab) => void;
}

const DEMO_STEPS: {
  step: string;
  title: string;
  detail: string;
  tab?: StaffPortalTab;
  actionLabel?: string;
}[] = [
  {
    step: '01',
    title: 'Three shoppers scan T001, T002, and T003 on three phones',
    detail:
      'Each shopper points their mobile phone camera at their trolley’s permanent QR sticker. The Shopper Web App opens directly in their mobile browser without installing any app.',
    tab: 'qr-kit',
    actionLabel: 'Open QR Print Kit',
  },
  {
    step: '02',
    title: 'Three independent Customer IDs & carts run simultaneously',
    detail:
      'Atomic Firestore transactions assign unique Customer IDs (e.g., CUST001, CUST002, CUST003) to T001, T002, and T003 without mixing or overwriting any customer cart.',
    tab: 'counter',
    actionLabel: 'Watch Active Sessions',
  },
  {
    step: '03',
    title: 'Customers scan shelf products & check live GST totals',
    detail:
      'Each phone scans shelf QR codes (Rice 5%, Milk 0%, Biscuit 18%, Soap 18%, Shampoo 18%, Cooking Oil 5%), updates quantities, and calculates subtotal, GST, and grand total.',
  },
  {
    step: '04',
    title: 'Each customer generates a unique session-linked Checkout QR',
    detail:
      'When finished shopping, each customer taps "Generate Checkout QR Code" to display a Checkout QR uniquely tied to their Customer ID, Trolley ID, and session token.',
  },
  {
    step: '05',
    title: 'Staff scans Checkout QR on laptop camera (or enters Customer ID)',
    detail:
      'On the Staff Billing Laptop (/staff), scan the customer’s Checkout QR using the laptop webcam or enter their Customer ID (e.g., CUST001) and click Load Bill.',
    tab: 'counter',
    actionLabel: 'Open Counter Scanner',
  },
  {
    step: '06',
    title: 'Verify physical items, mark Demo Payment PAID & close session',
    detail:
      'Check off the physical trolley products against the bill, click "Verify & Mark Demo Payment PAID" (school demonstration only), then click "Close Session & Release Trolley".',
    tab: 'counter',
    actionLabel: 'Verify & Close',
  },
  {
    step: '07',
    title: 'Other active customers remain unaffected',
    detail:
      'Closing Customer 1’s trolley leaves Customers 2 and 3 shopping normally on their own phones. Load Customer 2 next by scanning their Checkout QR or entering their Customer ID.',
    tab: 'counter',
    actionLabel: 'Load Next Bill',
  },
  {
    step: '08',
    title: 'Reuse trolley & inspect permanent Bill History',
    detail:
      'Once a trolley session is CLOSED, the next shopper can scan that same permanent trolley QR to receive a brand-new Customer ID while all completed bills remain archived in Bill History.',
    tab: 'history',
    actionLabel: 'Open Bill History',
  },
];

export function DemoGuideView({ trolleys, onSelectTab }: DemoGuideViewProps) {
  const t001 = trolleys.find((t) => t.trolleyId === 'T001');
  const customerUrl = `${getPublicAppOrigin()}/`;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
            Competition Demonstration Mode
          </p>
          <h2 className="text-2xl font-bold text-slate-900">
            9-Step STEM Competition Walkthrough
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Customer Mobile App URL:{' '}
            <span className="font-mono font-semibold text-slate-900">{customerUrl}</span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 shrink-0 min-w-[220px]">
          <p className="text-xs text-slate-500">Live Trolley T001 Status</p>
          <p className="text-lg font-mono font-bold text-slate-900 mt-0.5">
            {t001 ? t001.status : 'Loading...'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5 font-mono">
            {t001?.activeCustomerId ? `Holder: ${t001.activeCustomerId}` : 'Ready for next customer'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5">
        {DEMO_STEPS.map((item) => (
          <div
            key={item.step}
            className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-4">
              <span className="font-mono text-sm font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 shrink-0">
                {item.step}
              </span>
              <div>
                <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">{item.detail}</p>
              </div>
            </div>

            {item.tab && item.actionLabel && (
              <button
                type="button"
                onClick={() => onSelectTab(item.tab!)}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {item.actionLabel}
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onSelectTab('counter')}
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-emerald-600 transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-5 h-5 text-emerald-700 mb-2" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-900">Active Counter Verification</p>
          <p className="text-xs text-slate-600 mt-1">Verify bills, mark PAID, close session</p>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('history')}
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-emerald-600 transition-colors cursor-pointer"
        >
          <History className="w-5 h-5 text-emerald-700 mb-2" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-900">Bill History Archive</p>
          <p className="text-xs text-slate-600 mt-1">Inspect CUST001, CUST002 closed receipts</p>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('qr-kit')}
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-emerald-600 transition-colors cursor-pointer"
        >
          <QrCode className="w-5 h-5 text-emerald-700 mb-2" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-900">Printable QR Stickers</p>
          <p className="text-xs text-slate-600 mt-1">Print T001–T003 &amp; 6 product QRs</p>
        </button>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3 text-xs text-emerald-900">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          Customer Mobile App (/) and Staff Billing System (/staff) connect to the same cloud
          Firestore database in real time over the internet.
        </span>
      </div>
    </div>
  );
}
