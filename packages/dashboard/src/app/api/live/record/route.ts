import type { NextRequest } from 'next/server'
import { proxyRecord } from '@/lib/live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const device = req.nextUrl.searchParams.get('device') ?? ''
  const seconds = Number(req.nextUrl.searchParams.get('seconds')) || 0
  const body = await req.arrayBuffer()
  return proxyRecord(device, seconds, body)
}
