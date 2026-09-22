import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glass — transparent PBM",
  description:
    "Glass: a CVS Caremark concept for transparent small-employer pharmacy benefits. Explore plan costs, guarantees and supporting evidence using demo data.",
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
