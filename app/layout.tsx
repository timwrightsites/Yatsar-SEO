import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { Shell } from '@/components/layout/Shell'

export const metadata: Metadata = {
  title: 'Yatsar SEO Dashboard',
  description: 'AI-powered SEO management for your clients',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://cdn.tailwindcss.com"
          strategy="beforeInteractive"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof tailwind !== 'undefined') {
                tailwind.config = {
                  theme: {
                    extend: {}
                  }
                }
              }
            `,
          }}
        />
      </head>
      <body className="antialiased bg-[#0a0c10]">
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
