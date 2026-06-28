import type { NextRequest } from 'next/server'
import { proxyControl } from '@/lib/device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  const device = req.nextUrl.searchParams.get('device') ?? ''
  const on = req.nextUrl.searchParams.get('on') !== 'false'
  return proxyControl('light', device, on)
}
