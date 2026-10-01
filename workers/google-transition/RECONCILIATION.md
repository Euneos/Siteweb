# Google transition: stable identities and private business mapping

This document describes code, not a deployed or enabled configuration. Do not
commit real source IDs, mappings, names, emails or response contents here.

## Identity compatibility

The existing receipt keys and every historical revision remain intact. No reset,
deletion or rebootstrap is needed. `source_row` in the poller is now an immutable
**lineage number**; newly allocated numbers exceed the existing maximum. The
physical row observed at capture is recorded as `raw_payload.physicalRow` and in
the NocoDB journal `ligne_source`. Existing captures fall back to their old row.
The hook continues receiving a stable lineage number as its source row.

Each full snapshot is reconciled before its bounded scan. The initial timestamp
anchors a lineage; exact content matches are consumed one-to-one. Sorting does
not revise it, and two genuinely identical responses remain two responses.
Legacy revisions that copied another timestamp into a row during sorting remain
stored evidence, but do not replace that row's original identity. True edits
keep monotonically increasing revisions, including A → B → A. A timestamp
collision without a unique remaining match, or a new timestamp while any prior
response is missing from the full snapshot, creates raw evidence marked `identity_ambiguous`.
It cannot auto-project. Sheets cannot expose the original immutable Forms response
ID, so ambiguous cases cannot safely be inferred from export contents alone.

The complete history read is capped at 20,000 captures per source. Exceeding it
stops that source with `identity_history_limit`; it never truncates and then
mistakes missing history for new responses. Scan cursor and external HTTP/D1
limits are unchanged. `/check` uses exactly the same reconciliation, read-only.

## Private configuration

Each `SOURCES` item retains its real French `label`, existing `spreadsheetId`,
`sheetId` and `firstRow`. Contact/deployment retain their existing `kind`, mapping
and receiver configuration. Other families use `personProjection` **instead of**
`kind`. Both together are rejected.

Example below is wholly fictional; replace the digest with SHA256 of
`JSON.stringify(exactOrderedHeaders)`. Every ordered column must be selected once
in `mapping` or `captureOnly`. Duplicate labels use
`{ "label": "Question", "occurrence": 2, "column": 16 }`. The one-based position
is mandatory when a label occurs more than once. Unknown columns or a changed
header digest stop projection while preserving the whole response.

```json
{
  "label": "Préformation — exemple fictif",
  "spreadsheetId": "fictional_sheet_id_00001",
  "sheetId": 0,
  "firstRow": 2,
  "projectionFirstRow": 52,
  "personProjection": {
    "family": "preformation_a",
    "headerDigest": "REPLACE_WITH_AUDITED_SHA256",
    "tables": {
      "people": "fictionalpeople00001",
      "records": "fictionalrecords0001"
    },
    "mapping": {
      "timestamp": "Horodateur",
      "email": "Email professionnel",
      "name": "Nom et prénom",
      "cohort": "Année scolaire",
      "establishment": "Établissement"
    },
    "captureOnly": ["Question pédagogique"],
    "createMissingAdults": true,
    "cohorts": [{
      "id": 2,
      "answers": ["2026–2027", "2026-2027", "2026 2027"],
      "establishments": [{
        "answer": "École fictive",
        "schoolId": 9,
        "participationId": 7
      }]
    }]
  }
}
```

`answer` is also supported as a single cohort alias. Aliases are literal published
answers after trimming, not approximate year parsing. Aliases shared by distinct
cohorts are rejected. School aliases can be separate `establishments` entries
pointing to the same confirmed school/dossier; an alias cannot point to two targets.
`name` is a complete name. Alternatively use both `firstName` and `lastName`.
Existing NocoDB names must match the complete declared name, in first-last or
last-first order; no token splitting or guessed corrections. Matching ignores only
case and whitespace, retains accents, and requires an exact normalized email.

For trainer agreements use `family: "accord_formateur"`, `tables.people` = trainer
table and `tables.records` = trainer journey table. Add mapping selectors
`agreement` and `agreementDate`, plus the **exact affirmative** `agreementAnswer`.
French `dd/mm/yyyy` / `dd-mm-yyyy` or ISO agreement dates are accepted. They cannot
be after the submission date. Only `accord_signe` and `date_accord` can change.
Existing contrary dates are reviewable conflicts, never overwritten.

If that source has no cohort question, omit `mapping.cohort` and explicitly
configure either a numbered `fixedCohort` or the audited nullable scope:

```json
{
  "fixedCohort": null,
  "cohorts": [{ "id": null }]
}
```

Nullable scope is allowed only for trainer families. It reads **all** that
trainer's journeys, filters merged ones, and requires exactly one active journey
whose cohort really is empty. A null journey plus another active journey is
ambiguous, even if only one has a null cohort. No cohort is assigned or inferred.
For numbered scopes the exact matching cohort is required. A source spanning
unlabelled years cannot safely be configured with a fabricated fixed cohort.

Private source arrays may span contiguous `SOURCES`, `SOURCES_2`, …, `SOURCES_12`.
Each is a complete JSON array under the platform's 5 KB secret limit. A missing
middle part or duplicate source is rejected. Do not split one source object across
parts. Keep the real source's French label; family identifiers are configuration
keys, not replacements for labels.

## Dispatcher and field effects

| Family | Identity / records tables | Automatic field effects |
| --- | --- | --- |
| `preformation_a` | adults / participations | `date_pre_recu`; optional confirmed missing-adult creation |
| `accord_formateur` | trainers / journeys | `accord_signe`, `date_accord` |
| `postformation_b`, `evaluation_formation` | adults / participations | Receipt linkage only; no survey-score or status update |
| `suivi_j45` | adults / participations | Optional audited `date_suivi_recu` projection; otherwise linkage only |
| `candidature_formateur` | trainers / journeys | Optional audited empty candidature fields; otherwise linkage only |
| `bilan_formateur` | trainers / journeys | Receipt linkage only |
| `candidature_etablissement` | schools / participations | Optional audited empty candidature fields; otherwise linkage only |
| `bilan_etablissement`, `activites_jeunes` | schools / participations | Receipt linkage only |
| Existing `kind: contact` / `deploiement` | existing receiver mapping | Existing receiver policy unchanged |
| No audited mapping | raw journal only | Explicit `mapping_not_configured`, remains pending |

Adult families require the declared cohort and an audited establishment → school /
participation mapping. That participation must still belong to that school and
cohort and must not be merged. Exact-email queries reject multiple candidates or
truncated pagination; missing email is not replaced by a name guess. School
families use exact school name and an email in the referent, director,
institutional or logistical-contact fields, then an unambiguous participation.
Anonymous evaluations, absent year/school information, unknown schools, spelling
conflicts and ambiguous matches remain pending. A complete plan must be derived
from explicit mapping; the form title is never used to infer cohort or identity.

Other-family linkage is `partial` / `linked_raw_only`, with explicit target IDs
and empty `fields` lists. The substantive answers remain in the source journal.
This does **not** report a fully integrated candidature, bilan or evaluation.
No automatic approval, status change, participant-training validation or email
is introduced. The optional candidature/J45 policy and its exact allowlist are
documented in [google-application-fields](../../docs/google-application-fields.md).
Existing nonempty values and source questions outside that policy are preserved.

## Missing-adult creation and durability

Creation is opt-in (`createMissingAdults: true`), only for preformation A, after
an exact valid email has no existing match. A same complete-name candidate in the
confirmed dossier, even without an email, blocks creation. A truncated dossier
inventory also blocks it. The name is retained whole in `nom`, `prenom` is empty.
No `statut` value is supplied or changed. The code is:

```text
AD-G- + SHA256(participationId + ':' + lowerCaseEmail).slice(0, 12)
```

The additive `google_transition_person_claims` table in `schema.sql` must exist
**before** enabling creations. Its key is the full SHA256 above. A reservation is
durable, shared across responses and never expires. A different response cannot
create the same person after an uncertain write, even if NocoDB searches are still
empty. Do not clear a claim to "retry" without reconciling its remote result.

Plans/configuration digests are persisted before mutation. A durable `writing`
marker precedes POST/PATCH. After a lost response, matching persisted fields and
relations can certify completion; an empty read never authorizes re-creation.
Explicit rejected 429s may retry with backoff. If a schema/transport failure or an
uncertain partial write cannot be verified, its receipt stays pending. NocoDB has
no conditional transaction here: the worker lease and creation claim serialize
this worker, while before/after reads detect observable concurrent changes; avoid
manual concurrent edits during projection activation.

## Journal and activation

Proofs reuse `detail_reprise` in the existing journal. The wire field `sourceKey`
is the exact response identity (`response_key` in D1, `cle_reponse` in NocoDB),
not the shared `spreadsheetId:sheetId` source key. This binds each annotation to
one answer revision and lets the review page reject evidence from another answer:

```text
[EUNEOS_GOOGLE_RECONCILIATION_V1]{"version":1,"sourceKey":"response_key","targets":[{"table":"tableId","id":7,"fields":["date_pre_recu"]}],"state":"integrated","reasons":[],"at":"ISO timestamp"}[/EUNEOS_GOOGLE_RECONCILIATION_V1]
```

`fields` lists actually written/verified fields; related targets can have an empty
list. Existing human text, extra annotation keys, earlier target/field evidence
and unresolved reasons are retained. Only the worker's initial
`projection_pending` / `mapping_not_configured` placeholder reasons are replaced.
Preserved unresolved reasons keep the receipt partial and `À rapprocher`.

This change does not automatically revisit historical captures. Future-only
eligibility still requires revision 1, the audited first-new lineage cutoff and
an explicit `PROJECTION_START_AT`; previous capture-only receipts are not silently
promoted when a mapping is later added. Historical repair remains a separately
reviewed backfill. Configure first, validate `/check`, then enable only after
schema and private mappings are verified. Never enable a flag as a backlog replay.

Local verification: `bun test tests/google*.test.*`, Worker TypeScript check and
`wrangler deploy --dry-run --config workers/google-transition/wrangler.toml`.
Tests use only synthetic sources and NocoDB responses. No actual deployment,
source configuration or production response submission is part of this change.

### Code-only Worker fixes after source activation

A receipt-annotation fix requires only new Worker code; it does not require a
source configuration replacement, schema migration, historical replay or `/ingest`.
Use the current production configuration, not an earlier activation manifest.

Before publishing, read and privately retain the live Worker settings/deployment
version. Check the existing `STATE` database identity, `SOURCES` through
`SOURCES_7`, other secret names, `INPUT_MODE`, both enablement flags and the exact
`PROJECTION_START_AT`. Do not print secret values or copy private mappings here.

Prepare a temporary Wrangler configuration from the reviewed Worker TOML with an
absolute `main` path. **Remove its entire `vars` section** and set `keep_vars=true`.
The repository's `ENABLED=false` and `PROJECTION_ENABLED=false` are bootstrap
values: `--keep-vars` alone does not prevent explicit local values overwriting
production. Preserve the existing D1 binding and supply the verified account ID.
With the pinned installed Wrangler, deploy that configuration using `--keep-vars`,
without `--var`, `--secrets-file`, secret bulk commands or D1 commands. Existing
source chunks, thresholds, cutover and authentication secrets must remain intact.

After deployment, compare the live variable values and secret-binding names with
the saved settings, check the deployed version, and use authenticated read-only
health checks. Existing completed annotations are not rewritten by a code deploy;
a separately reviewed targeted correction may repair a historical annotation.
Never replay or clear a receipt merely to update its presentation. Reason-label
translations are site-client code and reach users through the normal Pages release,
independently of the Worker code-only deployment.
