import type { NextRequest } from 'next/server'
import { proxyCaps } from '@/lib/device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return proxyCaps(req.nextUrl.searchParams.get('device') ?? '')
}
