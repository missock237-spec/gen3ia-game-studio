import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Esbuild est un outil serveur avec un binaire natif : ne doit JAMAIS
  // être tracé/bundlé par Turbopack (sinon "invalid utf-8 sequence").
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
