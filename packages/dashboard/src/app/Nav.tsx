'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: '🎥 Dashboard', match: (p: string) => p === '/' },
  {
    href: '/verlauf',
    label: '🕑 Verlauf',
    match: (p: string) => p.startsWith('/verlauf') || p.startsWith('/event'),
  },
]

/** Top tab bar shown on every page (Dashboard ⇄ Verlauf). */
export default function Nav() {
  const pathname = usePathname() || '/'
  // The live view is a per-camera detail screen, not a top-level tab.
  if (pathname.startsWith('/live')) return null
  return (
    <nav className="tabbar">
      <span className="brand">Ring NVR</span>
      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`tab${t.match(pathname) ? ' active' : ''}`}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
