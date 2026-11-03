import { useCallback, useEffect, useRef, useState } from 'react';
import { thumb } from '../format.js';

/** Visionneuse plein écran façon carrousel : flèches, clavier, balayage tactile. */
export default function Lightbox({ images, start = 0, onClose }) {
  const [index, setIndex] = useState(start);
  const touchX = useRef(null);
  const n = images.length;
  const go = useCallback((d) => setIndex((i) => (i + d + n) % n), [n]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [go, onClose]);

  const img = images[index];
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        if (Math.abs(dx) > 50) go(dx > 0 ? -1 : 1);
      }}
    >
      <button type="button" className="icon-btn lb-close" onClick={onClose} aria-label="Fermer">✕</button>
      {n > 1 && <button type="button" className="lb-nav prev" onClick={() => go(-1)} aria-label="Précédente">‹</button>}
      <img src={img.thumbUrl ? thumb(img.thumbUrl, 1920) : img.url} alt={img.title || img.originalName} />
      {n > 1 && <button type="button" className="lb-nav next" onClick={() => go(1)} aria-label="Suivante">›</button>}
      <div className="lb-caption">
        <span>{img.title || img.originalName} · <a href={img.url} target="_blank" rel="noreferrer" className="lb-original">Original</a></span>
        <span className="dots">
          {images.map((im, i) => (
            <button key={im.id} type="button" className={`dot${i === index ? ' on' : ''}`} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`} />
          ))}
        </span>
      </div>
    </div>
  );
}
