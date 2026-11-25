/**
 * Asset URL under the build's base path. Vite dev serves from `/`, GitHub
 * Pages serves from `/babylon-racer/`, and a hardcoded leading slash breaks the
 * second one.
 */
export const asset = (p: string) => import.meta.env.BASE_URL + p.replace(/^\//, "");
