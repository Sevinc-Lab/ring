import type { NextRequest } from 'next/server'
import { proxyWebRtc } from '@/lib/live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const offer = await req.text()
  return proxyWebRtc(req.nextUrl.searchParams.get('device') ?? '', offer)
}
