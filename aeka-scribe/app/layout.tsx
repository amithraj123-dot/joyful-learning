import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aeka Scribe',
  description: 'Aeka Scribe: dictation and meeting notes workspace for Aeka Advisors.',
  applicationName: 'Aeka Scribe',
  authors: [{ name: 'Aeka Advisors India LLP' }],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
