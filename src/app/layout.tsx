import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internship Tracker",
  description: "Track internship applications parsed from your Gmail inbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
