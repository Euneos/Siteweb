import type { APIRoute } from 'astro'
import { PDFDocument } from 'pdf-lib'
import { getInternalContext, internalError, privateJson, readInternalBody, entryId, privateHeaders, internalEnvironment } from '../../../lib/internal-context'
import { WorkspaceError } from '../../../lib/internal-workspace'
import { getConvention, listConventions, normalizeStoredPayload, requestChanges, submitConvention, trainerAccountEmail } from '../../../lib/mission-convention'
import { generateContractPdf } from '../../../lib/mission-convention-pdf'
import { getDraft, listDrafts, saveDraft, submitDraft, supersedeDraft } from '../../../lib/mission-convention-drafts'
import { conventionMailEnabled, conventionNotificationRecipient, conventionNotificationReceipts, notifyConventionEvents } from '../../../lib/mission-convention-notifications'
import { parseConventionReview } from '../../../lib/mission-convention-review'

export const prerender = false
const requireAdmin = (team: boolean, admin: boolean) => {
  if (!team || !admin) throw new WorkspaceError(403, 'Validation réservée à la direction EUNEOS.')
}
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))]
  .map(x => x.toString(16).padStart(2, '0')).join('')
async function confirmFile(db: Parameters<typeof getConvention>[0], id: string, kind: string, digest: string) {
  const file = await db.prepare('SELECT sha256 FROM mission_convention_files WHERE convention_id=? AND kind=?')
    .bind(id, kind).first<{ sha256: string }>()
  if (file?.sha256 !== digest) throw new WorkspaceError(503, 'Dépôt incertain. Rechargez la page avant toute nouvelle action.')
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const ctx = await getInternalContext(request, locals, true)
    if (ctx instanceof Response) return ctx
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const kind = url.searchParams.get('kind')
    if (id && kind) {
      if (!['approved', 'trainer_signed', 'complete'].includes(kind)) throw new WorkspaceError(400, 'Document inconnu.')
      const row = await getConvention(ctx.db, entryId(id), ctx.identity, ctx.teamMember)
      if (!ctx.teamMember && kind === 'trainer_signed') throw new WorkspaceError(403, 'Document réservé à EUNEOS.')
      if (kind === 'approved' && !['approved', 'trainer_signed', 'complete'].includes(row.state)) throw new WorkspaceError(404, 'Document non disponible.')
      if (kind === 'complete' && row.state !== 'complete') throw new WorkspaceError(404, 'Document non disponible.')
      const file = await ctx.db.prepare('SELECT pdf FROM mission_convention_files WHERE convention_id=? AND kind=?')
        .bind(id, kind).first<{ pdf: ArrayBuffer | Uint8Array }>()
      if (!file) throw new WorkspaceError(404, 'Document non disponible.')
      return new Response(Uint8Array.from(new Uint8Array(file.pdf)), { headers: {
        ...privateHeaders, 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="convention-${id}-${kind}.pdf"`,
      } })
    }
    return privateJson({ conventions: await listConventions(ctx.db, ctx.identity, ctx.teamMember),
      drafts: await listDrafts(ctx.db, ctx.identity, ctx.teamMember),
      ...(ctx.teamMember ? {
        notifications: await conventionNotificationReceipts(ctx.db),
        notificationEmail: conventionNotificationRecipient,
        notificationsEnabled: conventionMailEnabled(internalEnvironment(locals), new URL(request.url).origin),
      } : {}),
      team: ctx.teamMember, admin: ctx.identity.admin, accountEmail: ctx.identity.email })
  } catch (error) { return internalError(error) }
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const ctx = await getInternalContext(request, locals, true)
    if (ctx instanceof Response) return ctx
    const body = await readInternalBody(request)
    const action = body.action
    if (!ctx.teamMember && ((action === 'save-draft' && body.revision === 0) || (action === 'submit' && !body.id))) {
      const drafts = await listDrafts(ctx.db, ctx.identity, false)
      if (drafts.length) throw new WorkspaceError(409, 'Un brouillon existe déjà pour votre compte. Rechargez la page et utilisez « Compléter le brouillon » pour poursuivre le même dossier.')
    }
    if (action === 'save-draft' || action === 'submit-draft') {
      const id = entryId(body.id)
      let owner = ctx.identity
      if (ctx.teamMember) {
        requireAdmin(ctx.teamMember, ctx.identity.admin)
        owner = { email: trainerAccountEmail(body.ownerEmail), admin: false }
      }
      if (body.revision !== 0 || action === 'submit-draft') {
        const existing = await getDraft(ctx.db, id, ctx.identity, ctx.teamMember)
        if (existing.owner_email !== owner.email) throw new WorkspaceError(409, 'Le compte formateur du brouillon ne peut pas être remplacé.')
      }
      const row = action === 'save-draft'
        ? await saveDraft(ctx.db, owner, ctx.identity, id, body.revision, body.payload, body.note)
        : await submitDraft(ctx.db, owner, id, body.revision, body.payload)
      const notification = action === 'submit-draft'
        ? await notifyConventionEvents(ctx.db, internalEnvironment(locals), row.id, new URL(request.url).origin) : undefined
      return privateJson({ id: row.id, notification })
    }
    if (action === 'submit') {
      const id = body.id ? entryId(body.id) : undefined
      let owner = ctx.identity
      if (ctx.teamMember) {
        requireAdmin(ctx.teamMember, ctx.identity.admin)
        const email = trainerAccountEmail(body.ownerEmail)
        if (id) {
          const existing = await getConvention(ctx.db, id, ctx.identity, true)
          if (existing.owner_email !== email) throw new WorkspaceError(409, 'Le compte formateur d’une convention ne peut pas être remplacé.')
        }
        owner = { email, admin: false }
      }
      const row = await submitConvention(ctx.db, owner, body.payload, id)
      const notification = await notifyConventionEvents(ctx.db, internalEnvironment(locals), row.id, new URL(request.url).origin)
      return privateJson({ id: row.id, state: row.state, notification })
    }
    requireAdmin(ctx.teamMember, ctx.identity.admin)
    const id = entryId(body.id)
    if (action === 'supersede-draft') {
      const draft = await supersedeDraft(ctx.db,ctx.identity,id,body.revision,entryId(body.conventionId))
      return privateJson({id:draft.id,submitted_id:draft.submitted_id})
    }
    if (action === 'changes') {
      const row = await requestChanges(ctx.db, id, ctx.identity, body.note)
      return privateJson({ id, state: row.state })
    }
    if (action === 'approve' || action === 'save-review') {
      const row = await getConvention(ctx.db, id, ctx.identity, true)
      if (row.state !== 'submitted') throw new WorkspaceError(409, 'La convention a changé. Rechargez la page.')
      const payload = normalizeStoredPayload(row.payload)
      if (action === 'approve' && body.confirmed !== true) throw new WorkspaceError(400, 'Vérifiez les missions et accords préalables avant validation.')
      const {representative,case2Euros:euros,feesDecision,feesDetails,feesEuros} = parseConventionReview(body,payload,action === 'approve')
      if (body.expectedUpdatedAt !== row.updated_at) throw new WorkspaceError(409, 'La vérification a changé. Rechargez la page pour retrouver les dernières décisions.')
      if (action === 'save-review') {
        const result = await ctx.db.prepare(`UPDATE mission_conventions SET representative=?,case2_euros=?,fees_decision=?,fees_details=?,fees_euros=?,reviewed_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND state='submitted' AND updated_at=?`)
          .bind(representative,euros,feesDecision,feesDetails,feesEuros,ctx.identity.email,id,row.updated_at).run()
        if (result.meta.changes !== 1) throw new WorkspaceError(409, 'La vérification a changé. Rechargez la page.')
        const saved = await getConvention(ctx.db,id,ctx.identity,true)
        if (saved.representative !== representative || saved.case2_euros !== euros || saved.fees_decision !== feesDecision || saved.fees_details !== feesDetails || saved.fees_euros !== feesEuros)
          throw new WorkspaceError(503, 'Enregistrement de la vérification non confirmé. Rechargez la page.')
        return privateJson({id,state:saved.state,updated_at:saved.updated_at})
      }
      const fees = feesDecision === 'accord' ? feesDetails : 'aucun'
      const fontResponse = await fetch(new URL('/fonts/OpenSans-convention.ttf', request.url))
      if (!fontResponse.ok) throw new WorkspaceError(503, 'Police PDF indisponible. Réessayez plus tard.')
      const pdf = await generateContractPdf(payload, representative, euros, await fontResponse.arrayBuffer(), fees, feesDecision === 'accord' ? feesEuros! : 0)
      if (pdf.byteLength > 750_000) throw new WorkspaceError(413, 'PDF trop volumineux pour cet espace.')
      const digest = await hash(pdf)
      const results = await ctx.db.batch([
        ctx.db.prepare(`UPDATE mission_conventions SET state='approved',representative=?,case2_euros=?,fees_decision=?,fees_details=?,fees_euros=?,reviewed_by=?,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='submitted' AND updated_at=?`)
          .bind(representative, euros, feesDecision, feesDetails, feesDecision === 'accord' ? feesEuros : 0, ctx.identity.email, id, row.updated_at),
        ctx.db.prepare(`INSERT INTO mission_convention_files(convention_id,kind,pdf,sha256,uploaded_by)
          SELECT id,'approved',?,?,? FROM mission_conventions WHERE id=? AND state='approved'`)
          .bind(pdf, digest, ctx.identity.email, id),
      ])
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new WorkspaceError(409, 'Validation non confirmée. Rechargez la page.')
      const verified = await getConvention(ctx.db, id, ctx.identity, true)
      if (verified.state !== 'approved') throw new WorkspaceError(503, 'Validation incertaine. Rechargez la page.')
      await confirmFile(ctx.db, id, 'approved', digest)
      return privateJson({ id, state: verified.state, sha256: digest })
    }
    throw new WorkspaceError(400, 'Action inconnue.')
  } catch (error) { return internalError(error) }
}

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const ctx = await getInternalContext(request, locals, true)
    if (ctx instanceof Response) return ctx
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
      throw new WorkspaceError(403, 'Rechargez la page avant de réessayer.')
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf') throw new WorkspaceError(415, 'Choisissez un PDF.')
    if (Number(request.headers.get('Content-Length') || '0') > 750_000) throw new WorkspaceError(413, 'PDF limité à 750 Ko.')
    const url = new URL(request.url)
    const id = entryId(url.searchParams.get('id'))
    const kind = url.searchParams.get('kind')
    if (kind !== 'trainer_signed' && kind !== 'complete') throw new WorkspaceError(400, 'Étape inconnue.')
    if (kind === 'complete') requireAdmin(ctx.teamMember, ctx.identity.admin)
    const row = await getConvention(ctx.db, id, ctx.identity, ctx.teamMember)
    const expected = kind === 'trainer_signed' ? 'approved' : 'trainer_signed'
    if (row.state !== expected || (kind === 'trainer_signed' && ctx.teamMember)) throw new WorkspaceError(409, 'Étape déjà traitée ou non disponible.')
    const pdf = new Uint8Array(await request.arrayBuffer())
    if (pdf.length < 100 || pdf.length > 750_000 || new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-')
      throw new WorkspaceError(400, 'PDF invalide ou trop volumineux (750 Ko maximum).')
    try { const parsed = await PDFDocument.load(pdf, { ignoreEncryption: false }); if (!parsed.getPageCount()) throw new Error() }
    catch { throw new WorkspaceError(400, 'Le PDF est illisible ou protégé par mot de passe.') }
    const digest = await hash(pdf)
    const results = await ctx.db.batch([
      ctx.db.prepare(`UPDATE mission_conventions SET state=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND state=?`).bind(kind, id, expected),
      ctx.db.prepare(`INSERT INTO mission_convention_files(convention_id,kind,pdf,sha256,uploaded_by)
        SELECT id,?,?,?,? FROM mission_conventions WHERE id=? AND state=?`)
        .bind(kind, pdf, digest, ctx.identity.email, id, kind),
    ])
    if (results[0].meta.changes < 1 || results[1].meta.changes < 1) throw new WorkspaceError(409, 'Dépôt non confirmé. Rechargez la page.')
    const verified = await getConvention(ctx.db, id, ctx.identity, ctx.teamMember)
    if (verified.state !== kind) throw new WorkspaceError(503, 'Dépôt incertain. Rechargez la page.')
    await confirmFile(ctx.db, id, kind, digest)
    const notification = kind === 'trainer_signed'
      ? await notifyConventionEvents(ctx.db, internalEnvironment(locals), id, new URL(request.url).origin) : undefined
    return privateJson({ id, state: verified.state, sha256: digest, notification })
  } catch (error) { return internalError(error) }
}
