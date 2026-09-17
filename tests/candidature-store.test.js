import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { enregistrerCandidature } from "../src/lib/candidature-store";
import { NC } from "../src/lib/nocodb";
import { POST as trainerPost } from "../src/pages/api/candidature-formateur";
const originalFetch = globalThis.fetch;
let sqlite;
let db;
let rows;
let writes;
let active = 2;
let loseResponse = false;
let failRead = false;
let dropLink = false;
let nextId = 100;
beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_form_submissions.sql", import.meta.url), "utf8"));
  db = { prepare: (sql) => ({ bind: (...values) => ({
    run: async () => {
      const result = sqlite.query(sql).run(...values);
      return { meta: { changes: result.changes } };
    },
    first: async () => sqlite.query(sql).get(...values),
    all: async () => ({ results: sqlite.query(sql).all(...values) })
  }) }) };
  rows = Object.fromEntries(Object.values(NC.tables).map((id) => [id, []]));
  writes = [];
  active = 2;
  nextId = 100;
  loseResponse = false;
  failRead = false;
  dropLink = false;
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    const path = url.pathname.split("/");
    const table = path[4];
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (failRead && table !== NC.tables.cohortes)
        throw new Error("Offline read");
      let list = table === NC.tables.cohortes ? [{ Id: 1, active: active === 1 }, { Id: 2, active: active === 2 }] : rows[table];
      if (path[6])
        return Response.json(list.find((row) => row.Id === Number(path[6])));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return Response.json({ list: list.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= list.length } });
    }
    const body = JSON.parse(String(init?.body));
    if (path[5] === "links") {
      writes.push({ table, kind: "link" });
      const record = rows[table].find((row) => row.Id === Number(path[8]));
      const field = path[6] === NC.liens["engagements.formateur"] ? "formateurs_id" : path[6] === NC.liens["participations.etablissement"] ? "etablissements_id" : "cohortes_id";
      if (!dropLink)
        record[field] = body[0].Id;
      return Response.json(true);
    }
    writes.push({ table, kind: "create" });
    const record = { Id: nextId++, ...body[0] };
    rows[table].push(record);
    if (loseResponse && table === NC.tables.engagements)
      throw new Error("Response lost after commit");
    return Response.json([record]);
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  sqlite.close();
});
const submit = (overrides = {}) => enregistrerCandidature({
  db,
  token: "test-token",
  kind: "formateur",
  identity: { nom: "Martin", email: "test@example.invalid" },
  application: { statut: "Candidature recue" },
  ...overrides
});
test("concurrent identical submissions create one identity and one linked application", async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => submit()));
  expect(results.filter((r) => r.status === "fulfilled" && !r.value.duplicate)).toHaveLength(1);
  expect(writes.filter((w) => w.kind === "create")).toHaveLength(2);
  expect(rows[NC.tables.engagements]).toEqual([expect.objectContaining({ formateurs_id: 100, cohortes_id: 2 })]);
  expect(await submit()).toEqual({ duplicate: true });
  expect(writes.filter((w) => w.kind === "create")).toHaveLength(2);
});
test("reuses an existing current-year application without overwriting its status", async () => {
  rows[NC.tables.formateurs] = [{ Id: 9, email: "somebody@example.invalid" }, { Id: 7, email: "TEST@example.invalid" }];
  rows[NC.tables.engagements] = [{ Id: 4, formateurs_id: 7, cohortes_id: 2, statut: "Valide" }];
  expect(await submit()).toEqual({ duplicate: true });
  expect(writes).toHaveLength(0);
  expect(rows[NC.tables.engagements][0].statut).toBe("Valide");
});
test("a trainer keeps one public application when the active cohort changes", async () => {
  active = 1;
  await submit();
  active = 2;
  expect(await submit()).toEqual({ duplicate: true });
  expect(rows[NC.tables.formateurs]).toHaveLength(1);
  expect(rows[NC.tables.engagements].map((r) => r.cohortes_id)).toEqual([1]);
});
test("schools may still apply in a later cohort without replacing their old dossier", async () => {
  const school = { kind: "etablissement", identity: { nom: "École Test", ville: "Paris", cp: "75001" } };
  active = 1;
  await submit(school);
  active = 2;
  expect(await submit(school)).toEqual({ duplicate: false });
  expect(rows[NC.tables.etablissements]).toHaveLength(1);
  expect(rows[NC.tables.participations].map((r) => r.cohortes_id)).toEqual([1, 2]);
});
test("normalises email spacing and case before claiming", async () => {
  await submit();
  expect(await submit({ identity: { email: " TEST@EXAMPLE.INVALID " } })).toEqual({ duplicate: true });
  expect(rows[NC.tables.formateurs]).toHaveLength(1);
});
test("school identity includes location and does not depend on the submitting referent", async () => {
  const identity = { nom: "Lycée Test", ville: "Paris", cp: "75001", referent_email: "one@example.invalid" };
  await submit({ kind: "etablissement", identity });
  expect(await submit({ kind: "etablissement", identity: { ...identity, referent_email: "two@example.invalid" } })).toEqual({ duplicate: true });
  expect(await submit({ kind: "etablissement", identity: { ...identity, ville: "Lyon", cp: "69001" } })).toEqual({ duplicate: false });
  expect(rows[NC.tables.etablissements]).toHaveLength(2);
});
test("an uncertain NocoDB POST is never repeated and the created rows remain available for recovery", async () => {
  loseResponse = true;
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  const writeCount = writes.length;
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(writeCount);
  expect(rows[NC.tables.formateurs]).toHaveLength(1);
  expect(rows[NC.tables.engagements]).toHaveLength(1);
  expect(sqlite.query("SELECT state, parent_id FROM form_submissions").get()).toEqual({ state: "review", parent_id: 100 });
});
test("a read-only outage releases the receipt and permits a safe retry", async () => {
  failRead = true;
  await expect(submit()).rejects.toThrow("Offline read");
  expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get()).toEqual({ n: 0 });
  expect(writes).toHaveLength(0);
  failRead = false;
  expect(await submit()).toEqual({ duplicate: false });
});
test("no active cohort refuses before any receipt or business write", async () => {
  active = 0;
  await expect(submit()).rejects.toMatchObject({ code: "indisponible" });
  expect(writes).toHaveLength(0);
  expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get()).toEqual({ n: 0 });
});
test("ambiguous trainer identities or multiple applications require team review", async () => {
  rows[NC.tables.formateurs] = [{ Id: 1, email: "test@example.invalid" }, { Id: 2, email: "test@example.invalid" }];
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  rows[NC.tables.formateurs].pop();
  rows[NC.tables.engagements] = [{ Id: 3, formateurs_id: 1, cohortes_id: null }, { Id: 4, formateurs_id: 1, cohortes_id: 1 }];
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(0);
});

for (const cohort of [null, 1, 2]) {
  for (const statut of ["Candidature recue", "En formation", "Valide", "Abandonne", "Formé mais à valider", "Terminé mais veut réassister"]) {
    test(`existing trainer application (${cohort}, ${statut}) is retained even without an active cohort`, async () => {
      active = 0;
      rows[NC.tables.formateurs] = [{ Id: 7, email: "test@example.invalid" }];
      const original = { Id: 4, formateurs_id: 7, cohortes_id: cohort, statut, date_validation: "2026-06-01", promotion: "Avril" };
      rows[NC.tables.engagements] = [{ ...original }];
      expect(await submit()).toEqual({ duplicate: true });
      expect(writes).toHaveLength(0);
      expect(rows[NC.tables.engagements]).toEqual([original]);
    });
  }
}

test("a school dossier without cohort still requires review", async () => {
  rows[NC.tables.etablissements] = [{ Id: 7, nom: "École Test", ville: "Paris", cp: "75001" }];
  rows[NC.tables.participations] = [{ Id: 4, etablissements_id: 7, cohortes_id: null }];
  await expect(submit({ kind: "etablissement", identity: rows[NC.tables.etablissements][0] })).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(0);
});

async function legacyReceipt(state, cohort = 99, email = "test@example.invalid") {
  const bytes = new TextEncoder().encode(JSON.stringify(["formateur", [email], cohort]));
  const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  sqlite.query("INSERT INTO form_submissions (submission_key, form_type, cohort_id, state, phase) VALUES (?, 'formateur', ?, ?, 'creating_application')").run(key, cohort, state);
}
for (const state of ["processing", "review", "complete"]) {
  test(`legacy ${state} receipt from a removed cohort is not bypassed by the lifetime key`, async () => {
    await legacyReceipt(state);
    if (state === "complete") expect(await submit()).toEqual({ duplicate: true });
    else await expect(submit()).rejects.toMatchObject({ code: "verification" });
    expect(writes).toHaveLength(0);
    expect(sqlite.query("SELECT state FROM form_submissions WHERE cohort_id = 99").get().state).toBe(state);
  });
}
test("an unrelated legacy receipt does not block a new trainer", async () => {
  await legacyReceipt("review", 1, "another@example.invalid");
  expect(await submit()).toEqual({ duplicate: false });
});
test("a pending legacy receipt wins over another completed receipt", async () => {
  await legacyReceipt("complete", 1);
  await legacyReceipt("review", 2);
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(0);
});

test("the public trainer endpoint returns already received without any Brevo call", async () => {
  rows[NC.tables.formateurs] = [{ Id: 7, email: "test@example.invalid" }];
  rows[NC.tables.engagements] = [{ Id: 4, formateurs_id: 7, cohortes_id: null, statut: "Valide" }];
  const data = {
    nom: "Martin", prenom: "Test", ville: "Paris", cp: "75001", email: "test@example.invalid", telephone: "0102030405", profession: "Formation",
    formation_instructeur: "Oui, je suis instructeur·rice certifié·e MBSR", experience_animation: "Non", pratique_personnelle: "Pratique", annees_experience: "3", interventions_animees: "Formation", motivation: "Motivation", disponible_2026_27: "Oui",
    etab_pressenti: "Oui", etab_pressenti_nom: "École Test", etab_pressenti_adresse: "1 rue Test", etab_pressenti_ville: "Paris", etab_pressenti_cp: "75001", etab_pressenti_academie: "Paris", etab_pressenti_type: "Collège", direction_nom: "Direction", direction_email: "direction@example.invalid", accord_principe: "Oui", consentement: "Oui, je confirme",
  };
  let brevoCalls = 0;
  const nocoFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.brevo.com")) { brevoCalls++; throw new Error("Unexpected email"); }
    return nocoFetch(url, init);
  };
  const response = await trainerPost({
    request: new Request("https://euneos.fr/api/candidature-formateur", { method: "POST", headers: { origin: "https://euneos.fr" }, body: new URLSearchParams(data) }),
    locals: { runtime: { env: { FORM_SUBMISSIONS: db, NOCODB_TOKEN: "test-token", BREVO_API_KEY: "test-only" } } },
    redirect: (url, status) => new Response(null, { status, headers: { Location: url } }),
  });
  expect(response.headers.get("Location")).toBe("/candidater/formateur?ok=deja");
  expect(brevoCalls).toBe(0);
  expect(writes).toHaveLength(0);
});
test("a link accepted but not persisted never yields a false success", async () => {
  dropLink = true;
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(sqlite.query("SELECT state, phase, record_id FROM form_submissions").get()).toEqual({ state: "review", phase: "verifying", record_id: 101 });
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes.filter((w) => w.kind === "create")).toHaveLength(2);
});
