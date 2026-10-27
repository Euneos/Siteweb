#!/usr/bin/env bun
// Admission nominative aux seules Ressources EUNEOS. Charge le jeton local sans l'afficher.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';


function settings() {
  const env: Record<string, string> = {};
  const path = resolve(process.cwd(), '.env');
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(CLOUDFLARE_[A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!account || !/^[a-f0-9]{32}$/.test(account)) throw new Error('Compte Cloudflare absent ou invalide dans la configuration locale.');
  if (!token) throw new Error('Jeton local absent. Exécuter depuis le dossier EUNEOS du kit ; ne jamais coller le jeton dans le chat.');
  return { token, account };
}

export function appended(policy: any, email: string) {
  if (policy.decision !== 'allow') throw new Error('La règle Ressources doit être de type Allow.');
  if (policy.reusable || policy.app_count > 1) throw new Error('Règle réutilisée : modification refusée pour protéger les autres applications.');
  if (!Array.isArray(policy.include) || policy.include.some((x: any) => !x.email || Object.keys(x).length !== 1)) {
    throw new Error('La liste nominative contient des sélecteurs inattendus. Modification refusée.');
  }
  const emailExists = policy.include.some((x: any) => x.email.email?.toLowerCase() === email);
  const writable = ['name', 'decision', 'include', 'exclude', 'require', 'precedence', 'session_duration',
    'isolation_required', 'purpose_justification_required', 'purpose_justification_prompt', 'approval_required', 'approval_groups'];
  const readonly = ['id', 'created_at', 'updated_at', 'reusable', 'app_count', 'uid'];
  if (Object.keys(policy).some(k => !writable.includes(k) && !readonly.includes(k))) {
    throw new Error('Un paramètre de règle inconnu doit être conservé : mise à jour automatique refusée.');
  }
  const body = Object.fromEntries(writable.filter(k => policy[k] !== undefined).map(k => [k, structuredClone(policy[k])]));
  if (!emailExists) body.include.push({ email: { email } });
  return { body, emailExists };
}

async function main() {
  const [action = 'verifier', rawEmail, confirmation] = process.argv.slice(2);
  if (!['verifier', 'autoriser'].includes(action)) throw new Error('Usage : bun acces-ressources.ts verifier | autoriser adresse@email.fr --confirmer');
  const email = rawEmail?.trim().toLowerCase();
  if (action === 'autoriser' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Adresse e-mail complète nécessaire.');
  const { token, account } = settings();
  const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}/access`;
  async function api(path: string, body?: any) {
    const response = await fetch(apiRoot + path, { method: body ? 'PUT' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    let data: any;
    try { data = await response.json(); } catch { throw new Error(`Réponse Cloudflare non JSON (HTTP ${response.status}).`); }
    if (!response.ok || !data.success) {
      const codes = (data.errors || []).map((x: any) => x.code).filter((x: any) => Number.isInteger(x)).join(',');
      throw new Error(`Cloudflare refuse l’opération (HTTP ${response.status}, code ${codes || 'inconnu'}). Vérifier Access: Apps and Policies — Edit sur EUNEOS.`);
    }
    return data.result;
  }
  const apps = await api('/apps?per_page=100');
  const resources = apps.filter((a: any) => a.name === 'EUNEOS — ressources');
  const teams = apps.filter((a: any) => a.name === 'EUNEOS — équipe');
  if (resources.length !== 1 || teams.length !== 1) throw new Error('Applications Ressources / équipe non identifiées de façon unique. Aucune écriture.');
  const APP = resources[0].id, TEAM = teams[0].id;
  const application = await api(`/apps/${APP}`);
  if (application.name !== 'EUNEOS — ressources') throw new Error('L’application ciblée n’est plus « EUNEOS — ressources ». Arrêt.');
  if (!application.destinations?.length || application.destinations.some((d: any) => d.type !== 'public' || !/^(?:\*\.)?(?:euneos-site\.pages\.dev|(?:www\.)?euneos\.fr)\/(?:api\/)?interne\/ressources$/.test(d.uri))) {
    throw new Error('Les destinations de cette application dépassent les Ressources. Aucune écriture.');
  }
  const policies = await api(`/apps/${APP}/policies`);
  if (policies.length !== 1 || policies[0].decision !== 'allow') throw new Error('Plusieurs règles ou règle inattendue : aucune écriture automatique.');
  const POLICY = policies[0].id;
  const path = `/apps/${APP}/policies/${POLICY}`;
  const policy = await api(path);
  const teamBefore = await api(`/apps/${TEAM}/policies`);
  console.log('Compte EUNEOS · application EUNEOS — ressources · règle nominative vérifiée.');
  console.log(`Adresses déjà admises : ${policy.include?.length ?? 0}. Espace équipe exclu de la commande.`);
  if (action === 'verifier') return;
  const { body, emailExists } = appended(policy, email!);
  if (emailExists) { console.log(`Déjà autorisée : ${email}. Aucune modification.`); return; }
  if (confirmation !== '--confirmer') {
    console.log(`Préparation : ajouter ${email} aux seules Ressources, en conservant toutes les autres entrées.`);
    console.log('Pour appliquer après accord de Charlotte : relancer la même commande avec --confirmer.');
    return;
  }
  // Detect a change since the initial read before doing any write.
  if (JSON.stringify(await api(path)) !== JSON.stringify(policy)) throw new Error('La règle a changé pendant la préparation. Relancer pour la relire.');
  await api(path, body);
  const after = await api(path);
  const expected = appended(after, email!);
  if (!expected.emailExists || JSON.stringify(expected.body) !== JSON.stringify(body)) throw new Error('La règle relue diffère de la modification attendue : contrôler Cloudflare.');
  if (JSON.stringify(await api(`/apps/${TEAM}/policies`)) !== JSON.stringify(teamBefore)) throw new Error('Les règles équipe ont changé pendant l’opération : contrôler leur auteur et leur portée.');
  console.log(`OK : ${email} admise aux Ressources ; relecture Cloudflare confirmée, règles équipe inchangées.`);
  console.log('La personne peut tester sa connexion sur https://euneos.fr/interne/ressources ; son essai reste nécessaire.');
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
