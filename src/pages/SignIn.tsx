import { useEffect, useRef } from 'react';
import { renderSignInButton } from '@/lib/auth/googleIdentity';
import { useAuth } from '@/lib/auth/AuthContext';
import { Icon } from '@/components/primitives';

export default function SignIn() {
  const { status, error } = useAuth();
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => { if (slot.current) void renderSignInButton(slot.current); }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)', padding: 'var(--s6)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s7)' }}>
          <span className="rail__mark" style={{ width: 28, height: 28, fontSize: 12 }}>SN</span>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 650, letterSpacing: '.04em' }}>STOWNEST</span>
        </div>

        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-.015em', marginBottom: 6 }}>
          Operations platform
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 'var(--s6)', lineHeight: 1.6 }}>
          Sign in with your StowNest Google account. Access is granted per person on the
          access&nbsp;control sheet — a valid Google account on its own is not enough.
        </p>

        {status === 'denied' && (
          <div style={{
            marginBottom: 'var(--s5)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
            background: 'var(--signal-soft)', color: 'var(--signal)', fontSize: 'var(--fs-sm)',
            display: 'flex', gap: 'var(--s2)', lineHeight: 1.6,
          }}>
            <Icon name="alert" size={15} />
            <span>{error ?? 'This account is not on the access list. Ask a super admin to add you.'}</span>
          </div>
        )}

        {status === 'error' && (
          <div style={{
            marginBottom: 'var(--s5)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
            background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)',
            display: 'flex', gap: 'var(--s2)', lineHeight: 1.6,
          }}>
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}

        <div ref={slot} />

        <p style={{ marginTop: 'var(--s7)', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.7 }}>
          Your Google sign-in produces an identity token only. It carries no access to Drive or Sheets —
          the spreadsheet is read by a service account that runs on the server and is never exposed to the browser.
        </p>
      </div>
    </div>
  );
}
