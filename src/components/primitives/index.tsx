import {
  forwardRef, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/* --------------------------------- Button -------------------------------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  icon?: string;
  iconOnly?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', icon, iconOnly, children, className = '', ...rest }, ref,
) {
  const cls = ['btn',
    variant !== 'default' && `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    iconOnly && 'btn--icon',
    className].filter(Boolean).join(' ');
  return (
    <button ref={ref} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 14} />}
      {children}
    </button>
  );
});

/* --------------------------------- Badge --------------------------------- */
export function Badge({ tone = 'idle', children, bare }: {
  tone?: 'pos' | 'neg' | 'signal' | 'idle' | 'accent'; children: ReactNode; bare?: boolean;
}) {
  return <span className={`badge badge--${tone}${bare ? ' badge--bare' : ''}`}>{children}</span>;
}

/* --------------------------------- Field --------------------------------- */
export function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="formrow">
      <label className="formrow__lb" htmlFor={id}>{label}</label>
      <div id={id}>{children}</div>
      {error ? <span className="formrow__err">{error}</span>
        : hint ? <span className="formrow__hint">{hint}</span> : null}
    </div>
  );
}

/* -------------------------------- Popover -------------------------------- */
export function Popover({ trigger, children, align = 'start', width }: {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<never> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = width ?? panel.current?.offsetWidth ?? 220;
    const left = align === 'end' ? r.right - w : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - w - 8)) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <>
      {trigger({
        open,
        toggle: () => setOpen(o => !o),
        ref: ((el: HTMLElement | null) => { anchor.current = el; }) as unknown as React.Ref<never>,
      })}
      {open && createPortal(
        <div ref={panel} className="pop" role="dialog"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}>
          {children(() => setOpen(false))}
        </div>, document.body)}
    </>
  );
}

/* --------------------------------- Modal --------------------------------- */
export function Modal({ title, onClose, children, footer, size = 'md' }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
  size?: 'md' | 'wide' | 'full';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="modal__scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${size !== 'md' ? ` modal--${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__hd">
          <h2 className="modal__title">{title}</h2>
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="ghost" size="sm" iconOnly icon="close" onClick={onClose} aria-label="Close" />
          </div>
        </div>
        <div className="modal__bd">{children}</div>
        {footer && <div className="modal__ft">{footer}</div>}
      </div>
    </div>, document.body);
}

/* -------------------------------- Tooltip -------------------------------- */
export function Tooltip({ label, children, fullWidth }: { label: ReactNode; children: ReactNode; fullWidth?: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      style={fullWidth ? { display: 'flex', width: '100%' } : { display: 'inline-flex' }}
      onMouseEnter={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPos({ x: r.left + r.width / 2, y: r.top - 8 }); }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div className="tip" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%,-100%)' }} role="tooltip">{label}</div>,
        document.body)}
    </span>
  );
}

/* --------------------------------- States -------------------------------- */
export function EmptyState({ title, body, action, icon = 'search' }: {
  title: string; body?: string; action?: ReactNode; icon?: string;
}) {
  return (
    <div className="state">
      <div className="state__icon"><Icon name={icon} size={22} /></div>
      <div className="state__title">{title}</div>
      {body && <p className="state__body">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div className="state state--err">
      <div className="state__icon"><Icon name="alert" size={22} /></div>
      <div className="state__title">{title}</div>
      {body && <p className="state__body">{body}</p>}
      {onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export const Skeleton = ({ h = 14, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) =>
  <div className="skel" style={{ height: h, width: w, ...style }} />;

/* ------------------------------- Confirm --------------------------------- */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, danger, busy }: {
  title: string; body: ReactNode; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean; busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </>
    }>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.6 }}>{body}</div>
    </Modal>
  );
}

export { Icon };
