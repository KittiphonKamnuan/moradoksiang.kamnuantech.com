'use client';

import { useEffect, useRef, useState } from 'react';

/** Artwork with a warm gradient fallback, so layout never breaks while images are missing. */
export function Art({ src, alt = '', className = '', imgClassName = '' }: { src: string; alt?: string; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // an SSR'd <img> can 404 before hydration, so onError never fires — check once mounted
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  return (
    <div className={`art-fallback relative overflow-hidden ${className}`} aria-hidden={alt ? undefined : true}>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={imgRef} src={src} alt={alt} onError={() => setFailed(true)} className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`} />
      )}
    </div>
  );
}
