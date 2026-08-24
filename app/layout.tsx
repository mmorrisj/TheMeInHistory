import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Me In History",
  description:
    "Build a character, drop them into a real historical setting, and learn the period by living in it.",
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
