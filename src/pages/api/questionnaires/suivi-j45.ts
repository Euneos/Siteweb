import type { APIRoute } from 'astro'
import { postformationPost } from '../../../lib/postformation-route'
export const prerender = false
export const POST: APIRoute = (context) => postformationPost(context, 'suivi-j45')
