import type { APIRoute } from 'astro'
export const prerender = false
/** Retired before activation. Never accept another legacy Google event. */
const retired: APIRoute = async () =>
  Response.json(
    { code: 'legacy_retired' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
export const GET = retired
export const POST = retired
