import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ActivityCenter } from "@/components/ActivityCenter";
import { BottomNav } from "@/components/BottomNav";
import { CaptureModalProvider } from "@/components/CaptureModalProvider";
import { I18nProvider } from "@/components/I18nProvider";
import { SidebarNav } from "@/components/SidebarNav";
import { WorkspaceManager } from "@/components/WorkspaceManager";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OTR",
  description: "A group travel memory app for daily notes, photos, and reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f7f3ea] text-stone-950">
        <I18nProvider>
          <CaptureModalProvider>
            <Suspense fallback={null}>
              <WorkspaceManager />
            </Suspense>
            <SidebarNav />
            <AppHeader />
            <ActivityCenter />
            <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-6 md:ml-20 md:pb-10 lg:max-w-5xl">
              {children}
            </main>
            <BottomNav />
          </CaptureModalProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
