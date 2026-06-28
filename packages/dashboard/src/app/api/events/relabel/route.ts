import type { NextRequest } from 'next/server'
import { proxyRelabel } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all') === '1'
  if (all) return proxyRelabel([], true)
  const raw = req.nextUrl.searchParams.get('ids') ?? req.nextUrl.searchParams.get('id') ?? ''
  const ids = [...new Set(raw.split(',').map((s) => Number(s.trim())))].filter(
    (n) => Number.isInteger(n) && n > 0,
  )
  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: 'no valid id(s)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return proxyRelabel(ids, false)
}
