import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { RegisterSW } from "@/components/register-sw";
import { SiteNav } from "@/components/site-nav";
import { SiteNavShell } from "@/components/site-nav-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HVC Scoring",
  description: "Box-cricket tournament live scoring and spectator app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        // Browser extensions (e.g. ColorZilla) inject attributes like
        // `cz-shortcut-listen` onto <body> before React hydrates,
        // causing a noisy console warning. The mismatch is harmless
        // and not from our code — silence it.
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteNavShell>
            <SiteNav />
          </SiteNavShell>
          {children}
          <Toaster />
          <RegisterSW />
        </ThemeProvider>
      </body>
    </html>
  );
}
