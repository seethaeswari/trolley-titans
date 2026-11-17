import { ShoppingBag } from 'lucide-react';
import { useState } from 'react';

interface ProductImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ProductImage({ src, alt, className = 'w-16 h-16' }: ProductImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`${className} rounded-xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-500 shrink-0`}
        aria-label={alt}
      >
        <ShoppingBag className="w-6 h-6" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} rounded-xl object-cover border border-slate-200 bg-slate-100 shrink-0`}
    />
  );
}
