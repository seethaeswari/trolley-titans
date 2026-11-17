import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { FormEvent, useEffect, useId, useRef, useState } from 'react';

interface QrScannerPanelProps {
  title: string;
  subtitle: string;
  inputPlaceholder: string;
  submitLabel: string;
  onScan: (decodedText: string) => Promise<void> | void;
  disabled?: boolean;
}

export function QrScannerPanel({
  title,
  subtitle,
  inputPlaceholder,
  submitLabel,
  onScan,
  disabled = false,
}: QrScannerPanelProps) {
  const reactId = useId().replace(/:/g, '');
  const readerId = `qr-reader-${reactId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const isStoppingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const stopCamera = async () => {
    const instance = scannerRef.current;
    if (!instance || isStoppingRef.current) return;
    isStoppingRef.current = true;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
      instance.clear();
    } catch {
      // ignore cleanup error if already stopped
    } finally {
      scannerRef.current = null;
      isStoppingRef.current = false;
      if (isMountedRef.current) {
        setCameraActive(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      void stopCamera();
    };
  }, []);

  const startCamera = async () => {
    if (disabled || cameraActive) return;
    setCameraError(null);

    const scanConfig = {
      fps: 10,
      qrbox: { width: 220, height: 220 },
      aspectRatio: 1.3333,
    };

    const handleDecoded = async (decodedText: string) => {
      const now = Date.now();
      if (
        lastScanRef.current.value === decodedText &&
        now - lastScanRef.current.at < 2200
      ) {
        return;
      }
      lastScanRef.current = { value: decodedText, at: now };
      await onScan(decodedText);
    };

    try {
      const html5Qr = new Html5Qrcode(readerId);
      scannerRef.current = html5Qr;
      try {
        await html5Qr.start(
          { facingMode: 'environment' },
          scanConfig,
          handleDecoded,
          () => {}
        );
      } catch (envErr) {
        // Fallback for laptop webcams or devices without rear camera constraints
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          throw envErr;
        }
        const preferred =
          cameras.find((cam) => /back|rear|environment/i.test(cam.label)) || cameras[0];
        await html5Qr.start(preferred.id, scanConfig, handleDecoded, () => {});
      }
      if (isMountedRef.current) {
        setCameraActive(true);
      }
    } catch (err) {
      scannerRef.current = null;
      if (isMountedRef.current) {
        setCameraActive(false);
        const message =
          err instanceof Error ? err.message : 'Camera permission unavailable on this device.';
        setCameraError(
          `Camera access unavailable (${message}). Use the manual QR code input below.`
        );
      }
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = manualValue.trim();
    if (!cleaned || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onScan(cleaned);
      setManualValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-600 mt-0.5">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => (cameraActive ? void stopCamera() : void startCamera())}
          disabled={disabled}
          className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            cameraActive
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-emerald-700 text-white hover:bg-emerald-800'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {cameraActive ? (
            <>
              <CameraOff className="w-4 h-4" aria-hidden="true" />
              Stop Camera
            </>
          ) : (
            <>
              <Camera className="w-4 h-4" aria-hidden="true" />
              Open Camera Scanner
            </>
          )}
        </button>
      </div>

      <div
        id={readerId}
        className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-950 transition-all ${
          cameraActive ? 'min-h-[240px] mb-4' : 'h-0 border-0'
        }`}
      />

      {cameraError && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
        >
          {cameraError}
        </div>
      )}

      <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Keyboard
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder={inputPlaceholder}
            disabled={disabled || submitting}
            aria-label={inputPlaceholder}
            className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || submitting || !manualValue.trim()}
          className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {submitting ? 'Processing...' : submitLabel}
        </button>
      </form>
    </div>
  );
}
