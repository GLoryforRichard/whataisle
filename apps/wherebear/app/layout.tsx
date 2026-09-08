import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import StaleClientGuard from "@/components/StaleClientGuard";
import QueueBoot from "@/components/QueueBoot";
import StoreRuntimeProvider from "@/components/StoreRuntimeProvider";
import { CANONICAL_URL } from "@/lib/store-identity.mjs";
import { getStoreRuntime } from "@/lib/store-runtime";
import GlobalScanIndicator from "@/components/GlobalScanIndicator";

// Uber-adjacent geometric sans (Plus Jakarta Sans ≈ Uber Move feel).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const dynamic = 'force-dynamic';
export async function generateMetadata():Promise<Metadata> {
  let name='WhatAisle';
  try {name=(await getStoreRuntime()).displayName;}catch{}
  return {metadataBase:new URL(CANONICAL_URL),title:`${name} — Find the aisle`,description:`Find products at ${name}.`,referrer:'no-referrer'};
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="min-h-full" style={{ fontFamily: 'var(--font-jakarta), -apple-system, system-ui, sans-serif' }}>
        <StoreRuntimeProvider>
        <StaleClientGuard />
        <QueueBoot />
        {children}
        <GlobalScanIndicator />
        </StoreRuntimeProvider>
      </body>
    </html>
  );
}
