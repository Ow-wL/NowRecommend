/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** API server origin, e.g. http://127.0.0.1:8010. Empty or unset → offline mode with the bundled catalog. */
  readonly VITE_API_BASE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
