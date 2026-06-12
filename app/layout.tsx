import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Fineprinted: Know what you're agreeing to",
  description:
    "AI-powered monitoring of Terms of Service and Privacy Policies. Letter grades, plain-English flags, and alerts when the rules quietly change.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://fineprinted.vercel.app"),
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Fineprinted",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Fineprinted: Know what you're agreeing to",
    description: "AI-powered monitoring of Terms of Service and Privacy Policies. Letter grades, plain-English flags, and alerts when the rules quietly change.",
    url: "https://fineprinted.vercel.app",
    siteName: "Fineprinted",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fineprinted: Know what you're agreeing to",
    description: "AI-powered monitoring of Terms of Service and Privacy Policies. Letter grades, plain-English flags, and alerts when the rules quietly change.",
  },
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
      className={`${inter.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        {/* Set theme class before paint to avoid a flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('fp_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#FAF9F5] text-[#1C1C1E] transition-colors dark:bg-[#0B0B0C] dark:text-[#E5E5E7]">
        {children}
      </body>
    </html>
  );
}
