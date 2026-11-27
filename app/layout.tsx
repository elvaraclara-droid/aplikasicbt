import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { PwaRegistrar } from "@/components/pwa/pwa-registrar";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#1e3a8a",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "CBT SMART EXAM | Smart Examination, Secure Assessment",
  description:
    "Platform ujian berbasis komputer untuk sekolah dengan sistem anti-cheating, pemantauan pengawas langsung, penyimpanan otomatis, dan keamanan berlapis.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CBT SMART EXAM",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
        <PwaRegistrar />
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
