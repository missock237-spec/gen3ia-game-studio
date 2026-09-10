import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Aucun masque d'erreur TypeScript : le typecheck strict doit passer.
  reactStrictMode: false,
  // socket.io via /api/mp : le XHR d'engine.io ne suit PAS les redirections
  // 308 — on route /api/mp/ directement (catch-all optionnel) sans redirect.
  skipTrailingSlashRedirect: true,
  // distDir surchargeable (validation de build prod isolée sans perturber
  // le serveur de développement) : NEXT_DIST_DIR=.next-prod
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Esbuild est un outil serveur avec un binaire natif : ne doit JAMAIS
  // être tracé/bundlé par Turbopack (sinon "invalid utf-8 sequence").
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
