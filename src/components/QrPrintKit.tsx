import { Globe, Printer, RotateCcw } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Product, Trolley } from '../types/store';
import {
  buildTrolleyQrPayload,
  clearStoredPublicAppUrl,
  DEFAULT_PUBLIC_APP_URL,
  formatCurrency,
  getPublicAppOrigin,
  isInternalPreviewOrigin,
  saveStoredPublicAppUrl,
} from '../utils/formatters';
import { QrCodeGraphic } from './QrCodeGraphic';

interface QrPrintKitProps {
  trolleys: Trolley[];
  products: Product[];
}

export function QrPrintKit({ trolleys, products }: QrPrintKitProps) {
  const [publicOrigin, setPublicOrigin] = useState<string>(() => getPublicAppOrigin());
  const [urlInput, setUrlInput] = useState<string>(() => getPublicAppOrigin());
  const [urlFeedback, setUrlFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const runningInPreviewHost =
    typeof window !== 'undefined' && isInternalPreviewOrigin(window.location.origin);

  const handleSavePublicUrl = (e: FormEvent) => {
    e.preventDefault();
    setUrlFeedback(null);
    try {
      const saved = saveStoredPublicAppUrl(urlInput);
      setPublicOrigin(saved);
      setUrlInput(saved);
      setUrlFeedback({
        type: 'success',
        message: `Permanent trolley QR codes now encode ${saved}/?trolley=T001 (public browser URL).`,
      });
    } catch (err) {
      setUrlFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid public URL.',
      });
    }
  };

  const handleResetDefaultUrl = () => {
    clearStoredPublicAppUrl();
    const fallback = getPublicAppOrigin();
    setPublicOrigin(fallback);
    setUrlInput(fallback);
    setUrlFeedback({
      type: 'success',
      message: `Reset to default public URL (${fallback}).`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <div className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Permanent Trolley &amp; Product QR Kit</h1>
          <p className="text-sm text-slate-600 mt-1">
            Print or download these QR codes for your physical trolleys and shelf products during
            supermarket testing and STEM competition demos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Printer className="w-4 h-4" aria-hidden="true" />
          Print All QR Cards
        </button>
      </div>

      {/* Public Website URL Settings (prevents 403 AI Studio preview URLs in QR stickers) */}
      <section className="no-print rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900">
              Public Customer Website URL for Permanent Trolley QRs
            </h2>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              QR stickers always encode your public deployed website URL so any customer&apos;s
              mobile phone opens the Shopper App directly without Google AI Studio login or 403
              errors. Internal preview URLs (<span className="font-mono">ais-dev-*</span>,{' '}
              <span className="font-mono">ais-pre-*</span>) are blocked automatically.
            </p>
          </div>
        </div>

        <form onSubmit={handleSavePublicUrl} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={DEFAULT_PUBLIC_APP_URL}
            aria-label="Public deployed website URL"
            className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
          />
          <button
            type="submit"
            className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Save Public URL
          </button>
          <button
            type="button"
            onClick={handleResetDefaultUrl}
            className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Default
          </button>
        </form>

        {urlFeedback && (
          <p
            role="status"
            className={`text-xs font-medium ${
              urlFeedback.type === 'success' ? 'text-emerald-800' : 'text-red-700'
            }`}
          >
            {urlFeedback.message}
          </p>
        )}

        {runningInPreviewHost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1">
            <p className="font-semibold">
              Deploy to make <span className="font-mono">{publicOrigin}</span> live on mobile phones
            </p>
            <p>
              You are viewing this dashboard inside an internal AI Studio preview. Run{' '}
              <span className="font-mono font-semibold">npm run build &amp;&amp; firebase deploy --only hosting</span>{' '}
              (free Firebase Spark Hosting) or deploy <span className="font-mono">dist/</span> to
              Vercel/Netlify and paste that live URL above before printing stickers.
            </p>
          </div>
        )}
      </section>

      {/* Permanent Trolley QR Codes */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Permanent Trolley QR Codes</h2>
          <p className="text-sm text-slate-600">
            One permanent QR sticker per physical trolley. Scanning with any phone camera opens the
            deployed Customer Shopper App directly in the mobile browser without installing an app.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {trolleys.map((trolley) => {
            const trolleyPayload = buildTrolleyQrPayload(trolley.trolleyId, publicOrigin);
            return (
              <div
                key={trolley.trolleyId}
                className="print-card rounded-2xl border border-slate-200 bg-white p-6 flex flex-col items-center text-center space-y-3"
              >
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                    Trolley Titans · Permanent Sticker
                  </p>
                  <h3 className="text-2xl font-mono font-bold text-slate-900">
                    {trolley.trolleyId}
                  </h3>
                  <p className="text-xs text-slate-500">{trolley.label}</p>
                </div>
                <QrCodeGraphic
                  value={trolleyPayload}
                  label={`Permanent QR for ${trolley.trolleyId}`}
                  size={180}
                  downloadName={`trolley_${trolley.trolleyId}`}
                  showDownload={true}
                />
                <p className="text-[11px] font-mono text-slate-500 break-all">{trolleyPayload}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Product Shelf QR Codes */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Supermarket Shelf Product QR Codes</h2>
          <p className="text-sm text-slate-600">
            Attach each QR card to its shelf item so shoppers can scan with their mobile camera.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <div
              key={product.productId}
              className="print-card rounded-2xl border border-slate-200 bg-white p-5 flex flex-col items-center text-center space-y-3"
            >
              <div className="space-y-0.5">
                <p className="text-xs text-slate-500">{product.category} · {product.unit}</p>
                <h3 className="text-lg font-bold text-slate-900">{product.name}</h3>
                <p className="text-sm font-mono font-semibold text-emerald-800 tabular-nums">
                  {formatCurrency(product.price)} · GST {product.gstRate}%
                </p>
              </div>
              <QrCodeGraphic
                value={product.qrCode}
                label={`QR for ${product.name}`}
                size={164}
                downloadName={`product_${product.productId}`}
                showDownload={true}
              />
              <p className="text-xs font-mono text-slate-500">{product.qrCode}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
