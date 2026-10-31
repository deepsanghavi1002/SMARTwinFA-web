import type { Metadata, Viewport } from "next";
import { Figtree, Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
// The Modern view's Light and Dark colours (generated from the rules above by `npm run theme`), then the Modern design layer on top.
import "./modern-theme.generated.css";
import "./modern-ui.css";
// Phones and tablets: the menu drawer, the bottom bar, touch sizes. Last, so it wins over the desktop layers above.
import "./responsive.css";
import { MessageBoxHost } from "../features/ui/MessageBox";
import { NoBrowserMenu } from "../features/ui/NoBrowserMenu";
import { ClientErrorReporter } from "../features/ui/ClientErrorReporter";

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
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/pranav-icon.png", type: "image/png", sizes: "256x256" }],
    shortcut: "/favicon.ico",
    apple: "/pranav-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Under the notch and home bar (the layout pads itself with env(safe-area-inset-*)), and the on-screen keyboard shrinks the page
  // instead of covering its lower half. Zoom stays on: pinching a report is how a phone reads a wide table.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
        <ClientErrorReporter />
        {/* The one message box every screen uses (features/ui/MessageBox). */}
        <MessageBoxHost />
        <NoBrowserMenu />
      </body>
    </html>
  );
}
