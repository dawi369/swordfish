import { NEXT_PUBLIC_SITE_URL } from "@/config/env";
import { RootProvider } from "@/providers/root-provider";
import "@/styles/globals.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk, JetBrains_Mono, Roboto } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(NEXT_PUBLIC_SITE_URL),
  title: {
    default: "Swordfish - Futures Intelligence",
    template: "%s | Swordfish",
  },
  description: "Futures. Focused. Fast",
  keywords: ["Trading", "Futures", "Swordfish", "Real-time market data", "Technical indicators"],
  authors: [{ name: "David Erwin", url: "/" }],
  creator: "David Erwin",
  publisher: "Swordfish",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://swordfish.trade",
    title: "Swordfish - Futures Intelligence",
    description:
      "Next-generation futures trading terminal. Sub-millisecond latency, institutional-grade data, and intelligent insights for professional traders.",
    siteName: "Swordfish",
    images: [
      {
        url: "/swordfishLogoTransparentnBackground.png",
        width: 1200,
        height: 630,
        alt: "Swordfish Futures Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Swordfish - Futures Intelligence",
    description: "Futures. Focused. Fast",
    creator: "@devDawi",
    images: ["/swordfishLogoTransparentnBackground.png"],
  },
  icons: {
    icon: [
      {
        url: "/swordfishLogoTransparent.png",
        type: "image/png",
        sizes: "32x32",
      },
    ],
    shortcut: "/swordfishLogoTransparent.png",
    apple: "/swordfishLogoTransparent.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Swordfish",
  },
  verification: {
    // Add these when you get them from Google/Bing
    // google: "your-google-site-verification-code",
    // yandex: "your-yandex-verification-code",
    // bing: "your-bing-verification-code",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${roboto.variable} antialiased min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
