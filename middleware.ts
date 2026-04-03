import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Deprecated in Next.js 16 — real auth logic lives in proxy.ts
// This file is kept only to satisfy the backward-compat function export check.
// The empty matcher ensures it runs on zero routes.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
