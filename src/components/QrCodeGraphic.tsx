import { Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface QrCodeGraphicProps {
  value: string;
  label?: string;
  size?: number;
  downloadName?: string;
  showDownload?: boolean;
}

export function QrCodeGraphic({
  value,
  label,
  size = 220,
  downloadName,
  showDownload = false,
}: QrCodeGraphicProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError('Could not render QR code');
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${downloadName || value.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-600 p-4"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={label || `QR code for ${value}`}
            width={size}
            height={size}
            className="block rounded-lg"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="animate-pulse rounded-lg bg-slate-100"
            style={{ width: size, height: size }}
          />
        )}
      </div>
      {showDownload && dataUrl && (
        <button
          type="button"
          onClick={handleDownload}
          className="no-print inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          Download PNG
        </button>
      )}
    </div>
  );
}
