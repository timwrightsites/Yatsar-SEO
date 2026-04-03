import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { ConditionalShell } from '@/components/layout/ConditionalShell'

export const metadata: Metadata = {
  title: 'Yatsar SEO Dashboard',
  description: 'AI-powered SEO management for your clients',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
      </head>
      <body className="antialiased bg-[#0d0d0d]">
        <ConditionalShell>{children}</ConditionalShell>
      </body>
    </html>
  )
}
