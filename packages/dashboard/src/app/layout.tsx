import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Ring NVR',
  description: 'Local event timeline and clip playback',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
