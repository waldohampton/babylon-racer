// Vite exposes the base path at build time. Declared by hand because
// tsconfig `types` is empty, and the game only needs this one field.
interface ImportMetaEnv {
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
