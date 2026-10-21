import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow — Voice workspace",
  description: "Your personal dictation workspace: speak, refine, and keep the words that matter.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
