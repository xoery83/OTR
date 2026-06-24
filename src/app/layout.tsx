import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { SidebarNav } from "@/components/SidebarNav";
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
        <SidebarNav />
        <AppHeader />
        <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-6 md:ml-64 md:pb-10 lg:max-w-4xl">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
