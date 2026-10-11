import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glass — simpler pharmacy benefits",
  description:
    "A Caremark small-employer offering concept: pricing choices, member support, and automated benefit administration.",
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
