import type { Metadata, Viewport } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Scripture is set in a serif face so that the reader can tell, at a glance and
// without reading a word, which text is God's and which is the tool's.
const scripture = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-scripture",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lectern",
  description:
    "A tool for praying with Scripture. Every response is grounded in the Berean Standard Bible and verified against it.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${scripture.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
