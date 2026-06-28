import type { NextRequest } from 'next/server'
import { proxyLive } from '@/lib/live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  return proxyLive('start', req.nextUrl.searchParams.get('device') ?? '')
}
