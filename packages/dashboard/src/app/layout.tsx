import type { ReactNode } from 'react'
import './globals.css'
import Nav from './Nav'

export const metadata = {
  title: 'Ring NVR',
  description: 'Local event timeline and clip playback',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
