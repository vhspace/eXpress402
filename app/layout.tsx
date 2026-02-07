import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'eXpress402',
  description: 'x402 v2 + SIWx + Yellow MCP paid tools',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

