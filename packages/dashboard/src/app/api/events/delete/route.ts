import type { NextRequest } from 'next/server'
import { proxyDeleteEvent } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'bad id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return proxyDeleteEvent(id)
}
