import { CameraDevice, Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CameraOff, ImageUp, Keyboard } from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useId, useRef, useState } from 'react';

export type QrScanSource = 'camera' | 'image' | 'manual';

interface QrScannerPanelProps {
  title: string;
  subtitle: string;
  inputPlaceholder: string;
  submitLabel: string;
  onScan: (decodedText: string, source?: QrScanSource) => Promise<void> | void;
  disabled?: boolean;
  allowImageUpload?: boolean;
}

export function QrScannerPanel({
  title,
  subtitle,
  inputPlaceholder,
  submitLabel,
  onScan,
  disabled = false,
  allowImageUpload = true,
}: QrScannerPanelProps) {
  const reactId = useId().replace(/:/g, '');
  const readerId = `qr-reader-${reactId}`;
  const fileReaderId = `qr-file-reader-${reactId}`;

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onScanRef = useRef(onScan);
  const processingScanRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const isStoppingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastCameraDecode, setLastCameraDecode] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanningImage, setScanningImage] = useState(false);

  // Keep latest onScan callback in ref so active camera stream never uses a stale closure
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopCamera = async () => {
    const instance = scannerRef.current;
    if (!instance || isStoppingRef.current) {
      if (isMountedRef.current) {
        setCameraActive(false);
        setCameraStarting(false);
      }
      return;
    }
    isStoppingRef.current = true;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
      instance.clear();
    } catch {
      // ignore cleanup error if stream already stopped
    } finally {
      scannerRef.current = null;
      isStoppingRef.current = false;
      if (isMountedRef.current) {
        setCameraActive(false);
        setCameraStarting(false);
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

  const createQrInstance = (elementId: string) =>
    new Html5Qrcode(elementId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });

  const invokeOnScanSafely = async (decodedText: string, source: QrScanSource) => {
    const cleaned = decodedText.trim();
    if (!cleaned) return;
    if (processingScanRef.current) return;

    processingScanRef.current = true;
    try {
      await onScanRef.current(cleaned, source);
    } finally {
      processingScanRef.current = false;
    }
  };

  const startCamera = async (overrideCameraId?: string) => {
    if (disabled || cameraStarting) return;
    if (cameraActive) {
      await stopCamera();
    }

    setCameraError(null);
    setLastCameraDecode(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraError(
        'Camera access is unavailable in this browser context (HTTPS or camera permissions required). Use "Scan QR Image" or the manual lookup input below.'
      );
      return;
    }

    // Make reader container visible BEFORE starting Html5Qrcode so it measures real non-zero width/height
    setCameraStarting(true);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    if (!isMountedRef.current) return;

    const scanConfig = {
      fps: 12,
      qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
        const minEdge = Math.min(viewfinderWidth || 260, viewfinderHeight || 260);
        const side = Math.max(140, Math.min(280, Math.floor(minEdge * 0.72)));
        return { width: side, height: side };
      },
      disableFlip: false,
    };

    const handleDecoded = async (decodedText: string) => {
      const cleaned = decodedText.trim();
      if (!cleaned) return;
      const now = Date.now();
      if (lastScanRef.current.value === cleaned && now - lastScanRef.current.at < 2000) {
        return;
      }
      lastScanRef.current = { value: cleaned, at: now };
      if (isMountedRef.current) {
        setLastCameraDecode(cleaned);
      }
      await invokeOnScanSafely(cleaned, 'camera');
    };

    const tryStartWithTarget = async (cameraIdOrConfig: string | MediaTrackConstraints) => {
      const instance = createQrInstance(readerId);
      scannerRef.current = instance;
      try {
        await instance.start(cameraIdOrConfig, scanConfig, handleDecoded, () => {});
        return true;
      } catch (err) {
        try {
          if (instance.isScanning) {
            await instance.stop();
          }
          instance.clear();
        } catch {
          // ignore cleanup
        }
        scannerRef.current = null;
        throw err;
      }
    };

    try {
      let availableCameras: CameraDevice[] = [];
      try {
        availableCameras = await Html5Qrcode.getCameras();
        if (isMountedRef.current && availableCameras.length > 0) {
          setCameras(availableCameras);
        }
      } catch {
        availableCameras = [];
      }

      const preferredId = overrideCameraId || selectedCameraId;
      let started = false;
      let lastError: unknown = null;

      // Strategy 1: explicit camera ID (selected by user or enumerated webcam)
      if (availableCameras.length > 0) {
        const chosen =
          (preferredId && availableCameras.find((c) => c.id === preferredId)) ||
          availableCameras.find((c) => /back|rear|environment/i.test(c.label)) ||
          availableCameras[0];

        if (isMountedRef.current && chosen) {
          setSelectedCameraId(chosen.id);
        }

        if (chosen) {
          try {
            await tryStartWithTarget(chosen.id);
            started = true;
          } catch (err) {
            lastError = err;
          }
        }
      }

      // Strategy 2: fallback constraint for laptops (user) then phones (environment)
      if (!started) {
        for (const constraint of [{ facingMode: 'user' }, { facingMode: 'environment' }]) {
          try {
            await tryStartWithTarget(constraint);
            started = true;
            break;
          } catch (err) {
            lastError = err;
          }
        }
      }

      if (!started) {
        throw lastError || new Error('No accessible camera found.');
      }

      // Refresh camera list after permission grant so device labels appear
      try {
        const postCameras = await Html5Qrcode.getCameras();
        if (isMountedRef.current && postCameras.length > 0) {
          setCameras(postCameras);
        }
      } catch {
        // non-fatal
      }

      if (isMountedRef.current) {
        setCameraStarting(false);
        setCameraActive(true);
      }
    } catch (err) {
      scannerRef.current = null;
      if (isMountedRef.current) {
        setCameraStarting(false);
        setCameraActive(false);
        const message =
          err instanceof Error ? err.message : 'Camera permission unavailable on this device.';
        setCameraError(
          `Camera access unavailable (${message}). Use "Scan QR Image" or enter the Customer ID / Trolley Number below.`
        );
      }
    }
  };

  const handleCameraSwitch = async (nextCameraId: string) => {
    setSelectedCameraId(nextCameraId);
    if (cameraActive) {
      await stopCamera();
      await startCamera(nextCameraId);
    }
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || scanningImage || disabled) return;

    setCameraError(null);
    setScanningImage(true);
    let tempInstance: Html5Qrcode | null = null;
    try {
      tempInstance = createQrInstance(fileReaderId);
      const decodedText = await tempInstance.scanFile(file, false);
      lastScanRef.current = { value: decodedText.trim(), at: Date.now() };
      setLastCameraDecode(decodedText.trim());
      await invokeOnScanSafely(decodedText, 'image');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No readable QR code found in image.';
      setCameraError(`Could not decode QR from image (${msg}). Try a clearer screenshot or manual lookup below.`);
    } finally {
      try {
        tempInstance?.clear();
      } catch {
        // ignore cleanup
      }
      if (isMountedRef.current) {
        setScanningImage(false);
      }
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = manualValue.trim();
    if (!cleaned || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onScanRef.current(cleaned, 'manual');
      setManualValue('');
    } finally {
      setSubmitting(false);
    }
  };

  const showViewport = cameraStarting || cameraActive;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-600 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {allowImageUpload && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => void handleImageUpload(e)}
                className="hidden"
                aria-label="Upload QR code image"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || scanningImage}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <ImageUp className="w-4 h-4" aria-hidden="true" />
                {scanningImage ? 'Reading...' : 'Scan QR Image'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => (cameraActive || cameraStarting ? void stopCamera() : void startCamera())}
            disabled={disabled}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cameraActive || cameraStarting
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-emerald-700 text-white hover:bg-emerald-800'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {cameraActive || cameraStarting ? (
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
      </div>

      {cameras.length > 1 && showViewport && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <label htmlFor={`camera-select-${reactId}`} className="text-xs font-medium text-slate-600">
            Camera Device
          </label>
          <select
            id={`camera-select-${reactId}`}
            value={selectedCameraId}
            onChange={(e) => void handleCameraSwitch(e.target.value)}
            className="flex-1 max-w-xs min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            {cameras.map((cam, idx) => (
              <option key={cam.id} value={cam.id}>
                {cam.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div
        className={`relative overflow-hidden rounded-xl bg-slate-950 transition-all ${
          showViewport ? 'min-h-[260px] border border-slate-200 mb-4' : 'h-0 border-0'
        }`}
      >
        <div
          id={readerId}
          className="w-full min-h-[260px] [&_video]:w-full [&_video]:h-auto [&_video]:rounded-xl [&_video]:object-cover"
        />
        {cameraStarting && !cameraActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/85 text-white text-xs font-medium">
            Starting camera &amp; QR detector...
          </div>
        )}
      </div>

      {cameraActive && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
          <span className="font-semibold">
            Camera active — hold Checkout QR steady in the viewfinder
          </span>
          {lastCameraDecode && (
            <span className="font-mono text-[11px] truncate max-w-[260px]">
              Last read: {lastCameraDecode}
            </span>
          )}
        </div>
      )}

      <div id={fileReaderId} className="hidden" aria-hidden="true" />

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
          {submitting ? 'Loading...' : submitLabel}
        </button>
      </form>
    </div>
  );
}
