import { useEffect, useRef, useState } from 'react';

/**
 * Full-screen VIN barcode scanner using @zxing/browser.
 * Works on iOS Safari, Chrome Android, Firefox, etc.
 *
 * Props:
 *   onScan(vin: string) — called when a valid 17-char VIN barcode is detected
 *   onClose()            — called when the user dismisses the scanner
 */
export function VINScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // Dynamic import keeps ZXing out of the initial bundle
        const { BrowserMultiFormatReader, NotFoundException } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();

        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result, err) => {
            if (cancelled) return;
            if (result) {
              const val = result.getText().replace(/\s/g, '').toUpperCase();
              // VIN: 17 alphanumeric chars, no I / O / Q
              if (/^[A-HJ-NPR-Z0-9]{17}$/.test(val)) {
                controls.stop();
                onScan(val);
              }
            }
            // NotFoundException = no barcode in this frame — totally normal, ignore
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setActive(true);
      } catch (e) {
        if (cancelled) return;
        if (e.name === 'NotAllowedError' || e.message?.includes('Permission denied')) {
          setError('Camera access denied.\nPlease allow camera access in your browser settings and try again.');
        } else if (e.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError('Could not start the camera. Please try again.');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (controlsRef.current) {
        try { controlsRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  function handleClose() {
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch { /* ignore */ }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black z-[70] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
        <p className="text-white text-base font-semibold">Scan VIN Barcode</p>
        <button
          onClick={handleClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-xl leading-none"
        >
          ×
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white text-center text-sm whitespace-pre-line leading-relaxed">{error}</p>
          <button
            onClick={handleClose}
            className="bg-white text-black text-sm font-semibold px-6 py-2.5 rounded-xl"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          {/* Camera feed */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {/* Targeting overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {/* Frame */}
            <div className="w-72 h-14 border-2 border-white rounded-lg relative">
              {/* Corner accents */}
              <div className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-[3px] border-l-[3px] border-white rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-[3px] border-r-[3px] border-white rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-[3px] border-l-[3px] border-white rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-[3px] border-r-[3px] border-white rounded-br-lg" />
            </div>
            <p className="mt-4 text-white text-xs text-center bg-black/50 px-3 py-1.5 rounded-full">
              {active ? 'Align VIN barcode within the frame' : 'Starting camera…'}
            </p>
          </div>
        </div>
      )}

      <div className="px-5 py-4 flex-shrink-0">
        <p className="text-white/40 text-xs text-center">
          Find the barcode on the driver-side door jamb sticker or windshield
        </p>
      </div>
    </div>
  );
}
