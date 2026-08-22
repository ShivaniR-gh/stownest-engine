/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_DATA_SOURCE?: 'demo' | 'sheets';
}
interface ImportMeta { readonly env: ImportMetaEnv }
