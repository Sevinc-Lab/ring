import type { ReactNode } from 'react'
import './globals.css'
import Nav from './Nav'
import DoorbellWatcher from './DoorbellWatcher'

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
        <DoorbellWatcher />
      </body>
    </html>
  )
}
