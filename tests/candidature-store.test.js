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
    if (url.origin !== "https://app.nocodb.com" || !Object.values(NC.tables).includes(table) || !["GET", "POST"].includes(method))
      throw new Error(`Unexpected mocked request: ${method} ${url}`);
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
    if (loseResponse && [NC.tables.engagements, NC.tables.participations].includes(table))
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

const schoolIdentity = { nom: "Collège témoin", ville: "Ville témoin", cp: "05100" };
const submitSchool = (identity = schoolIdentity) => submit({ kind: "etablissement", identity });
function existingSchool(identity = schoolIdentity, cohorts = [2]) {
  rows[NC.tables.etablissements] = [{ Id: 7, ...identity }];
  rows[NC.tables.participations] = cohorts.map((cohort, index) => ({
    Id: index + 4, etablissements_id: 7, cohortes_id: cohort, statut: "Engage",
  }));
}

// Keys seeded with the pre-fix algorithm, independently of the store's matcher.
async function schoolReceiptKey(identity, cohort = 2) {
  const parts = [identity.nom, identity.cp, identity.ville].map(value =>
    String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr"));
  const bytes = new TextEncoder().encode(JSON.stringify(["etablissement", parts, cohort]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
async function legacySchoolReceipt(identity, state, cohort = 2) {
  const key = await schoolReceiptKey(identity, cohort);
  sqlite.query("INSERT INTO form_submissions (submission_key, form_type, cohort_id, state, phase) VALUES (?, 'etablissement', ?, ?, 'creating_identity')")
    .run(key, cohort, state);
  return key;
}
async function canonicalSchoolReceiptKey(identity, cohort = 2) {
  const text = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cp = String(identity.cp).trim();
  const digits = /^(\d+)(?:\.0+)?$/.exec(cp)?.[1];
  return "school:v2:" + await schoolReceiptKey({
    nom: text(identity.nom), ville: text(identity.ville),
    cp: digits === undefined ? cp : digits.replace(/^0+(?=\d)/, ""),
  }, cohort);
}

for (const [stored, entered] of [
  ["49000.0", "49000"], ["5100.0", "05100"], ["5100", "05100"], [5100, "05100"],
  ["05100", "5100.0"], ["05100.00", "05100"], ["2078.0", "2078"], [2078, "2078"],
  [" 49000.0 ", "49000"], ["02078", "2078"], ["sw1a 1aa", "SW1A 1AA"],
]) {
  test(`school postcode ${JSON.stringify(stored)} matches ${entered} without mutating the stored identity or dossier`, async () => {
    existingSchool({ ...schoolIdentity, cp: stored });
    const original = structuredClone(rows);
    expect(await submitSchool({ ...schoolIdentity, cp: entered })).toEqual({ duplicate: true });
    expect(rows).toEqual(original);
    expect(writes).toHaveLength(0);
  });
}

for (const identity of [
  { nom: " COLLEGE\u00a0  TEMOIN ", ville: "  VILLE\nTEMOIN  ", cp: "05100" },
  { nom: "Colle\u0300ge te\u0301moin", ville: "Ville te\u0301moin", cp: "05100" },
]) {
  test(`school name and city match with accents and whitespace: ${JSON.stringify(identity)}`, async () => {
    existingSchool({ ...schoolIdentity, cp: "5100.0" });
    expect(await submitSchool(identity)).toEqual({ duplicate: true });
    expect(writes).toHaveLength(0);
  });
}

for (const distinct of [
  { ville: "Autre ville" }, { cp: "05200" }, { nom: "Collège différent" },
  { nom: "Collègetémoin" }, { nom: "Collège-témoin" }, { ville: "Ville-témoin" },
  { cp: "5100.5" }, { cp: "5.1e3" }, { cp: "5100,0" }, { cp: "5 100" },
  { cp: "5100A" }, { cp: "9007199254740993" },
]) {
  test(`school matcher preserves distinct names, locations and non-integer postcodes: ${JSON.stringify(distinct)}`, async () => {
    const identity = { ...schoolIdentity, ...distinct };
    existingSchool({ ...schoolIdentity, cp: distinct.cp === "9007199254740993" ? "9007199254740992" : "5100.0" });
    expect(await submitSchool(identity)).toEqual({ duplicate: false });
    expect(rows[NC.tables.etablissements]).toEqual([expect.objectContaining({ Id: 7 }), { Id: 100, ...identity }]);
    expect(rows[NC.tables.participations]).toHaveLength(2);
  });
}

test("a new Tunisian school keeps its four-digit postcode with a canonical receipt", async () => {
  const identity = { nom: "École témoin", ville: "La Marsa", cp: "2078" };
  expect(await submitSchool(identity)).toEqual({ duplicate: false });
  expect(rows[NC.tables.etablissements]).toEqual([{ Id: 100, ...identity }]);
  expect(sqlite.query("SELECT submission_key, state FROM form_submissions").all()).toEqual([
    { submission_key: await canonicalSchoolReceiptKey(identity), state: "complete" },
  ]);
});

for (const variant of [
  { ...schoolIdentity, cp: "5100.0" },
  { nom: "College temoin", ville: "Ville temoin", cp: "05100" },
]) {
  for (const exactFirst of [true, false]) {
    test(`ambiguous school variants require review even with an exact match (${JSON.stringify(variant)}, exact first: ${exactFirst})`, async () => {
      const candidates = [{ Id: 7, ...schoolIdentity }, { Id: 8, ...variant }];
      rows[NC.tables.etablissements] = exactFirst ? candidates : candidates.toReversed();
      await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
      expect(writes).toHaveLength(0);
      expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get().n).toBe(0);
    });
  }
}

test("same-name schools in different cities are not ambiguous even with the same postcode", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" });
  rows[NC.tables.etablissements].unshift({ Id: 8, ...schoolIdentity, ville: "Autre ville" });
  expect(await submitSchool()).toEqual({ duplicate: true });
  expect(sqlite.query("SELECT parent_id, record_id FROM form_submissions").get()).toEqual({ parent_id: 7, record_id: 4 });
  expect(writes).toHaveLength(0);
});

for (const cohorts of [[2, 2], [1, 2, 2], [null, 2], [2, null]]) {
  test(`multiple current or unscoped school dossiers require review: ${JSON.stringify(cohorts)}`, async () => {
    existingSchool({ ...schoolIdentity, cp: "5100.0" }, cohorts);
    const original = structuredClone(rows);
    await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
    expect(rows).toEqual(original);
    expect(writes).toHaveLength(0);
    expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get().n).toBe(0);
  });
}

test("school dossier matching stays scoped to the active cohort and matched school", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, [1, 1, 2]);
  rows[NC.tables.participations].unshift({ Id: 9, etablissements_id: 8, cohortes_id: 2 });
  expect(await submitSchool()).toEqual({ duplicate: true });
  expect(sqlite.query("SELECT parent_id, record_id FROM form_submissions").get()).toEqual({ parent_id: 7, record_id: 6 });
  expect(writes).toHaveLength(0);
});

test("legacy postcode matching reuses the school for a new cohort without rewriting earlier dossiers", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, [1, 1]);
  const previous = structuredClone(rows[NC.tables.participations]);
  expect(await submitSchool()).toEqual({ duplicate: false });
  expect(rows[NC.tables.etablissements]).toEqual([{ Id: 7, ...schoolIdentity, cp: "5100.0" }]);
  expect(rows[NC.tables.participations]).toEqual([...previous, {
    Id: 100, statut: "Candidature recue", etablissements_id: 7, cohortes_id: 2,
  }]);
  expect(writes.filter(w => w.kind === "create")).toEqual([{ table: NC.tables.participations, kind: "create" }]);
});

for (const cp of ["05100", "5100.0", "2078"]) {
  for (const state of ["processing", "review", "complete"]) {
    test(`old school ${state} receipt (${cp}) with unknown remote IDs keeps its original claim`, async () => {
      const identity = { ...schoolIdentity, cp };
      const key = await legacySchoolReceipt(identity, state);
      const previous = sqlite.query("SELECT * FROM form_submissions").all();
      failRead = true; // Receipt protection must work without any business read.
      const retry = submitSchool({ ...identity, nom: "  COLLE\u0300GE\u00a0 TÉMOIN ", ville: " VILLE\tTÉMOIN " });
      if (state === "complete") expect(await retry).toEqual({ duplicate: true });
      else await expect(retry).rejects.toMatchObject({ code: state === "processing" ? "en_cours" : "verification" });
      expect(sqlite.query("SELECT * FROM form_submissions WHERE submission_key = ?").all(key)).toEqual(previous);
      expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get().n).toBe(state === "complete" ? 2 : 1);
      expect(writes).toHaveLength(0);
    });
  }
}

test("an old completed school receipt does not consume a later cohort", async () => {
  await legacySchoolReceipt(schoolIdentity, "complete", 1);
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, [1]);
  expect(await submitSchool()).toEqual({ duplicate: false });
  expect(sqlite.query("SELECT cohort_id, state FROM form_submissions ORDER BY cohort_id").all()).toEqual([
    { cohort_id: 1, state: "complete" }, { cohort_id: 2, state: "complete" },
  ]);
  expect(rows[NC.tables.etablissements]).toHaveLength(1);
  expect(rows[NC.tables.participations].map(row => row.cohortes_id)).toEqual([1, 2]);
});

test("a lost school application response retains the canonical reservation and blocks a retry", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, []);
  loseResponse = true;
  await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
  const previous = sqlite.query("SELECT * FROM form_submissions").all();
  expect(previous).toEqual([expect.objectContaining({
    submission_key: await canonicalSchoolReceiptKey(schoolIdentity), state: "review", parent_id: 7, record_id: null,
  })]);
  loseResponse = false;
  failRead = true;
  await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
  expect(sqlite.query("SELECT * FROM form_submissions").all()).toEqual(previous);
  expect(rows[NC.tables.etablissements]).toHaveLength(1);
  expect(rows[NC.tables.participations]).toHaveLength(1);
  expect(writes).toEqual([{ table: NC.tables.participations, kind: "create" }]);
});

test("concurrent identical school submissions reuse one legacy identity and create one dossier", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, []);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => submitSchool()));
  expect(results.filter(r => r.status === "fulfilled" && !r.value.duplicate)).toHaveLength(1);
  expect(rows[NC.tables.etablissements]).toHaveLength(1);
  expect(rows[NC.tables.participations]).toEqual([
    { Id: 100, statut: "Candidature recue", etablissements_id: 7, cohortes_id: 2 },
  ]);
  expect(await submitSchool()).toEqual({ duplicate: true });
  expect(writes.filter(w => w.kind === "create")).toHaveLength(1);
});

const schoolVariants = [
  schoolIdentity,
  { ...schoolIdentity, cp: "5100.0" },
  { ...schoolIdentity, cp: "5100" },
  { ...schoolIdentity, cp: "05100.00" },
  { ...schoolIdentity, nom: "College temoin", ville: "Ville temoin" },
  { nom: " COLLEGE\u00a0  TEMOIN ", ville: " VILLE\tTEMOIN ", cp: "5100.0" },
];

for (const existing of [false, true]) {
  test(`concurrent school spelling and postcode variants share one reservation (existing identity: ${existing})`, async () => {
    if (existing) existingSchool({ ...schoolIdentity, cp: "5100.0" }, []);
    const results = await Promise.allSettled(schoolVariants.map(identity => submitSchool(identity)));
    expect(results.filter(result => result.status === "fulfilled" && !result.value.duplicate)).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason.code).toBe("en_cours");
    }
    expect(rows[NC.tables.etablissements]).toHaveLength(1);
    expect(rows[NC.tables.participations]).toHaveLength(1);
    expect(rows[NC.tables.participations][0]).toMatchObject({
      etablissements_id: existing ? 7 : 100, cohortes_id: 2,
    });
    expect(writes.filter(write => write.kind === "create")).toHaveLength(existing ? 1 : 2);
    const receipts = sqlite.query("SELECT * FROM form_submissions").all();
    expect(receipts).toEqual([expect.objectContaining({
      submission_key: await canonicalSchoolReceiptKey(schoolIdentity), state: "complete",
    })]);
    for (const identity of schoolVariants) expect(await submitSchool(identity)).toEqual({ duplicate: true });
    expect(sqlite.query("SELECT * FROM form_submissions").all()).toEqual(receipts);
    expect(writes.filter(write => write.kind === "create")).toHaveLength(existing ? 1 : 2);
  });
}

test("canonical school reservations do not serialize homonyms in different cities", async () => {
  const other = { ...schoolIdentity, ville: "Autre ville" };
  expect(await Promise.all([submitSchool(), submitSchool(other)])).toEqual([{ duplicate: false }, { duplicate: false }]);
  expect(rows[NC.tables.etablissements]).toHaveLength(2);
  expect(rows[NC.tables.participations]).toHaveLength(2);
  expect(sqlite.query("SELECT state FROM form_submissions").all()).toEqual([{ state: "complete" }, { state: "complete" }]);
});

for (const state of ["processing", "review"]) {
  for (const identity of schoolVariants.slice(1)) {
    test(`uncorrelated legacy ${state} school receipt blocks a different raw key: ${JSON.stringify(identity)}`, async () => {
      await legacySchoolReceipt(identity, state);
      const previous = sqlite.query("SELECT * FROM form_submissions").all();
      failRead = true;
      await expect(submitSchool()).rejects.toMatchObject({
        code: "verification", message: "Uncorrelated legacy school receipt blocks this cohort until reconciliation",
      });
      expect(sqlite.query("SELECT * FROM form_submissions").all()).toEqual(previous);
      expect(writes).toHaveLength(0);
    });
  }
}

test("an uncorrelated legacy school receipt fails closed even for an apparently unrelated name", async () => {
  await legacySchoolReceipt({ ...schoolIdentity, nom: "Autre école" }, "review");
  await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(0);
});

for (const cohort of [1, 99]) {
  test(`an uncertain legacy school receipt from cohort ${cohort} does not block the active cohort`, async () => {
    await legacySchoolReceipt({ ...schoolIdentity, cp: "5100.0" }, "review", cohort);
    expect(await submitSchool()).toEqual({ duplicate: false });
    expect(sqlite.query("SELECT state FROM form_submissions WHERE cohort_id = ?").get(cohort).state).toBe("review");
    expect(rows[NC.tables.participations]).toHaveLength(1);
  });
}

test("uncorrelated trainer receipts in the same cohort do not block schools", async () => {
  await legacyReceipt("review", 2);
  expect(await submitSchool()).toEqual({ duplicate: false });
});

for (const reference of ["parent", "record"]) {
  for (const related of [false, true]) {
    test(`a legacy receipt with a surviving ${reference} ID is correlated before writing (same school: ${related})`, async () => {
      const identity = { ...schoolIdentity, cp: "5100.0", ville: related ? schoolIdentity.ville : "Autre ville" };
      existingSchool(identity, reference === "record" ? [2] : []);
      const key = await legacySchoolReceipt(identity, "review");
      sqlite.query("UPDATE form_submissions SET parent_id = ?, record_id = ? WHERE submission_key = ?")
        .run(reference === "parent" ? 7 : null, reference === "record" ? 4 : null, key);
      const previous = sqlite.query("SELECT * FROM form_submissions WHERE submission_key = ?").get(key);
      if (related) {
        await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
        expect(writes).toHaveLength(0);
      } else {
        expect(await submitSchool()).toEqual({ duplicate: false });
        expect(rows[NC.tables.etablissements]).toHaveLength(2);
      }
      expect(sqlite.query("SELECT * FROM form_submissions WHERE submission_key = ?").get(key)).toEqual(previous);
    });
  }
}

for (const [parent, record] of [[7, null], [null, 4]]) {
  test(`dangling legacy receipt IDs (${parent}, ${record}) cannot bypass reconciliation`, async () => {
    const key = await legacySchoolReceipt({ ...schoolIdentity, cp: "5100.0" }, "review");
    sqlite.query("UPDATE form_submissions SET parent_id = ?, record_id = ? WHERE submission_key = ?").run(parent, record, key);
    await expect(submitSchool()).rejects.toMatchObject({ code: "verification" });
    expect(writes).toHaveLength(0);
    expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get().n).toBe(1);
  });
}

test("a correlated completed legacy receipt prevents a new dossier even if the old dossier is absent", async () => {
  existingSchool({ ...schoolIdentity, cp: "5100.0" }, []);
  const key = await legacySchoolReceipt({ ...schoolIdentity, cp: "5100.0" }, "complete");
  sqlite.query("UPDATE form_submissions SET parent_id = 7, record_id = 4 WHERE submission_key = ?").run(key);
  const previous = sqlite.query("SELECT * FROM form_submissions WHERE submission_key = ?").get(key);
  expect(await submitSchool()).toEqual({ duplicate: true });
  expect(sqlite.query("SELECT * FROM form_submissions WHERE submission_key = ?").get(key)).toEqual(previous);
  expect(writes).toHaveLength(0);
});

test("a new uncertain canonical write blocks every spelling without blocking other schools", async () => {
  loseResponse = true;
  await expect(submitSchool(schoolVariants[1])).rejects.toMatchObject({ code: "verification" });
  const count = writes.length;
  const previous = sqlite.query("SELECT * FROM form_submissions").all();
  for (const identity of schoolVariants) await expect(submitSchool(identity)).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(count);
  expect(sqlite.query("SELECT * FROM form_submissions").all()).toEqual(previous);
  loseResponse = false;
  expect(await submitSchool({ ...schoolIdentity, ville: "Autre ville" })).toEqual({ duplicate: false });
});

test("a read-only failure releases only the new canonical reservation and allows a spelling variant retry", async () => {
  failRead = true;
  await expect(submitSchool()).rejects.toThrow("Offline read");
  expect(sqlite.query("SELECT count(*) AS n FROM form_submissions").get().n).toBe(0);
  expect(writes).toHaveLength(0);
  failRead = false;
  expect(await submitSchool(schoolVariants[1])).toEqual({ duplicate: false });
  expect(await submitSchool()).toEqual({ duplicate: true });
  expect(rows[NC.tables.participations]).toHaveLength(1);
});
