/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** API server origin, e.g. http://127.0.0.1:8010. Empty or unset → offline mode with the bundled catalog. */
  readonly VITE_API_BASE_URL?: string;
  /** The build's name in error reports (the commit, set by the deploy workflow). */
  readonly VITE_RELEASE?: string;
  /** Where the site is served, with a trailing slash: used for the address in link previews. */
  readonly VITE_PUBLIC_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
