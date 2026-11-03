import { useEffect } from 'react';

export default function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-body">
          <div className="modal-head">
            <h2 className="pink-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
