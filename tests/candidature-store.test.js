import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { enregistrerCandidature } from "../src/lib/candidature-store";
import { NC } from "../src/lib/nocodb";
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
    first: async () => sqlite.query(sql).get(...values)
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
test("a later cohort can create a new application while retaining the identity and old history", async () => {
  active = 1;
  await submit();
  active = 2;
  expect(await submit()).toEqual({ duplicate: false });
  expect(rows[NC.tables.formateurs]).toHaveLength(1);
  expect(rows[NC.tables.engagements].map((r) => r.cohortes_id)).toEqual([1, 2]);
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
test("ambiguous identities and historical paths without year require team review", async () => {
  rows[NC.tables.formateurs] = [{ Id: 1, email: "test@example.invalid" }, { Id: 2, email: "test@example.invalid" }];
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  rows[NC.tables.formateurs].pop();
  rows[NC.tables.engagements] = [{ Id: 3, formateurs_id: 1, cohortes_id: null }];
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes).toHaveLength(0);
});
test("a link accepted but not persisted never yields a false success", async () => {
  dropLink = true;
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(sqlite.query("SELECT state, phase, record_id FROM form_submissions").get()).toEqual({ state: "review", phase: "verifying", record_id: 101 });
  await expect(submit()).rejects.toMatchObject({ code: "verification" });
  expect(writes.filter((w) => w.kind === "create")).toHaveLength(2);
});
