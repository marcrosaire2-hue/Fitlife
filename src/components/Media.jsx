import { useEffect, useRef, useState } from 'react';

export function Img({ src, className = 'art', pos, alt = '' }) {
  if (!src) return <div className={className} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" draggable="false" style={pos ? { objectPosition: pos } : undefined} />;
}

/* Vidéo muette en boucle, avec la photo en affiche. `play=false` met en pause. */
export function Vid({ src, poster, play = true, className = 'art', pos }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (play) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
  }, [play, src]);
  return (
    <>
      {poster && <img className={className} src={poster} alt="" style={pos ? { objectPosition: pos } : undefined} />}
      {src && (
        <video
          ref={ref} className={className + ' vid' + (ready ? ' ready' : '')} src={src} muted loop playsInline autoPlay preload="auto"
          onPlaying={() => setReady(true)} style={pos ? { objectPosition: pos } : undefined}
        />
      )}
    </>
  );
}
