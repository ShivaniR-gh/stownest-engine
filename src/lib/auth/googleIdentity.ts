/** ---------------------------------------------------------------------------
 * Google Identity Services wrapper.
 *
 * The client obtains an ID token only. It never receives a Sheets access token,
 * never sees the service-account key and never calls googleapis.com directly.
 * The ID token is a bearer credential our API verifies against Google's public
 * keys on every request.
 * ------------------------------------------------------------------------- */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const STORE_KEY = 'sn.idtoken';

interface GoogleCredentialResponse { credential: string }
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: GoogleCredentialResponse) => void; auto_select?: boolean; hosted_domain?: string }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
          prompt(): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in could not load. Check your network and try again.'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function decodeExp(jwt: string): number {
  try { return (JSON.parse(atob(jwt.split('.')[1])).exp ?? 0) * 1000; }
  catch { return 0; }
}

export function storeIdToken(t: string) { sessionStorage.setItem(STORE_KEY, t); }
export function clearIdToken() { sessionStorage.removeItem(STORE_KEY); }

/** Returns a non-expired ID token, or null. Tokens live ~1h; the caller
 *  re-prompts via `promptSignIn` when this comes back null. */
export async function getIdToken(): Promise<string | null> {
  const t = sessionStorage.getItem(STORE_KEY);
  if (!t) return null;
  if (decodeExp(t) < Date.now() + 30_000) { clearIdToken(); return null; }
  return t;
}

export async function initGoogle(onCredential: (jwt: string) => void): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set. Add it to your environment and redeploy.');
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: r => { storeIdToken(r.credential); onCredential(r.credential); },
    auto_select: true,
  });
}

export async function renderSignInButton(el: HTMLElement) {
  await loadGoogleScript();
  window.google?.accounts.id.renderButton(el, {
    theme: 'outline', size: 'large', text: 'signin_with',
    shape: 'rectangular', logo_alignment: 'left', width: 300,
  });
}

export const promptSignIn = () => window.google?.accounts.id.prompt();
export const signOutGoogle = () => { window.google?.accounts.id.disableAutoSelect(); clearIdToken(); };
export const hasClientId = () => Boolean(CLIENT_ID);
