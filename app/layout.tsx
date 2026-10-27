import type { Metadata, Viewport } from "next";
import { Figtree, Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
// The Modern view's Light and Dark colours (generated from the rules above by `npm run theme`), then the Modern design layer on top.
import "./modern-theme.generated.css";
import "./modern-ui.css";
import { MessageBoxHost } from "../features/ui/MessageBox";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// The Modern view's type (app/modern-ui.css): Figtree for text, Sora for headings and figures.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SMARTwinFA Web",
  description: "Cross-platform migration of SMART financial accounting.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The Modern view's theme is on the page before it paints, so a dark theme does not flash white. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{if(localStorage.getItem("view-mode")==="modern"){var t=localStorage.getItem("modern-theme");document.documentElement.dataset.mtheme=t==="dark"||t==="light"?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}}catch(e){}' }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${figtree.variable} ${sora.variable} antialiased`}
      >
        {children}
        {/* The one message box every screen uses (features/ui/MessageBox). */}
        <MessageBoxHost />
      </body>
    </html>
  );
}
