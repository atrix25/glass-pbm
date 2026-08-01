import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glass — transparent PBM",
  description:
    "An end-to-end transparent pharmacy benefit manager, built on the published Wisconsin ETF / Navitus contract. Every number shows its derivation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
