import type { Metadata, Viewport } from "next";
import { Providers } from "@/app/providers";
import "./globals.css";

const appName = "파이널 유도 멀티짐";
const appDescription = "유도장과 멀티짐의 수업, 출석, 결제, 공지를 역할별로 확인합니다.";

export const metadata: Metadata = {
  applicationName: appName,
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: appDescription,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/final-judo-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/final-judo-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/final-judo-icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "파이널 유도",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#102a43",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
