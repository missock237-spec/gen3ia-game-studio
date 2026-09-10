import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "GEN3IA GAME STUDIO — Éditeur de jeux 3D cloud",
  description:
    "Game engine web professionnel: éditeur 3D temps réel, physique, IA de PNJ hybride, multiplayer autoritaire, build cloud. Créez des jeux 3D depuis votre navigateur, PC ou Android.",
  keywords: ["game engine", "éditeur 3D", "Gén3IA", "jeux vidéo", "WebGL", "multiplayer", "IA"],
  authors: [{ name: "GEN3IA" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b0f16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning className="dark">
      <body className="antialiased bg-[#0b0f16] text-gray-100">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
