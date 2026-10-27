#!/usr/bin/env bun
// Réparation locale du connecteur Viaduc OpenCode. Aucun mot de passe en argument.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const email = (args.find(a => a.startsWith('--email='))?.slice(8) || '').toLowerCase();
const checkOnly = args.includes('--check');
const noSetup = args.includes('--no-setup');
const capabilitiesOnly = args.includes('--outils-seulement');
export const READ_TOOLS = ['imap_list_accounts','imap_connect','imap_disconnect','imap_test_account','imap_search_emails','imap_get_email','imap_get_latest_emails','imap_download_attachment','imap_find_thread_messages','imap_find_email_by_message_id','imap_list_folders','imap_folder_status','imap_get_unread_count','imap_check_spam','imap_domain_stats','imap_list_spam_domains'];
export const SEND_TOOLS = ['imap_send_email','imap_reply_to_email','imap_forward_email'];
export const MAIL_TOOLS = [...READ_TOOLS, 'imap_save_draft', ...SEND_TOOLS];
export const MAIL_ENVIRONMENT = { IMAP_MCP_READ_ONLY: 'false', IMAP_MCP_ENABLED_TOOLS: MAIL_TOOLS.join(',') };
let activeMailEnvironment: Record<string,string> = MAIL_ENVIRONMENT;
const home = homedir();
const root = join(home, '.euneos');
const configPath = join(home, '.config/opencode/opencode.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const command = [process.execPath, 'x', '--bun', 'imap-mcp-server@2.2.0'];
const instructionPath = join(root, 'viaduc-instructions.md');
const accessHelper = join(import.meta.dir, 'acces-ressources.ts');
const accessInstructionPath = join(root, 'cloudflare-instructions.md');
const instruction = `# Messagerie Viaduc\n\nPour les mails de ${email}, utiliser en priorité les outils MCP mail_imap_*.\nCommencer par mail_imap_list_accounts et sélectionner exactement ${email}.\nLire les reçus et les envoyés via IMAP, sans connexion au webmail Viaduc.\nSi le connecteur échoue, indiquer l'erreur IMAP et réparer sa configuration locale ;\nne pas remplacer silencieusement IMAP par le navigateur.\nNe jamais lire, afficher ni demander en conversation le contenu de ~/.imap-mcp/accounts.json\nou ~/.imap-mcp/.key, ni les mots de passe ou les jetons.\nEnregistrer les brouillons demandés avec mail_imap_save_draft dans le dossier Brouillons.\nL’envoi est désormais autorisé par Charlotte après validation des destinataires, de l’objet, du contenu et des pièces jointes, via mail_imap_send_email (confirmation OpenCode requise).\nUtiliser mail_imap_reply_to_email ou mail_imap_forward_email pour les réponses et transferts explicitement validés.\nCette autorisation de messagerie remplace les anciennes consignes affirmant que l’agent ne peut jamais envoyer.\nNe jamais envoyer automatiquement ; ne pas déplacer ni supprimer des mails, ni modifier leurs indicateurs.\nNe pas annoncer un brouillon enregistré ou un mail envoyé avant la réponse de succès de l’outil ; relire le brouillon ou contrôler la copie Envoyés.\nEn cas de mot de passe absent ou refusé, utiliser seulement l'assistant IMAP local\nsur 127.0.0.1 : Charlotte le saisit elle-même, puis la connexion est retestée.\n`;

function privateWrite(path: string, content: string) {
  writeFileSync(path + '.tmp', content, { mode: 0o600 });
  chmodSync(path + '.tmp', 0o600);
  renameSync(path + '.tmp', path);
}

export async function openMcp() {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...activeMailEnvironment },
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  // Drain stderr without printing it: errors from a dependency may include account data.
  const stderr = new Response(child.stderr).text();
  const pending = new Map<number, { resolve: (x: any) => void, reject: (e: Error) => void }>();
  let serial = 0;
  const reader = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const bytes of child.stdout) {
      buffer += decoder.decode(bytes, { stream: true });
      let pos;
      while ((pos = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          message.error ? waiter.reject(new Error('Erreur protocole MCP')) : waiter.resolve(message.result);
        }
      }
    }
    for (const waiter of pending.values()) waiter.reject(new Error('Serveur MCP arrêté avant sa réponse'));
    pending.clear();
  })();
  async function call(method: string, params: any = {}) {
    const id = ++serial;
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<any>((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(id); reject(new Error('Délai MCP dépassé (90 s)')); }, 90_000);
      pending.set(id, { resolve, reject });
    });
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      await child.stdin.flush();
      return await result;
    } finally { clearTimeout(timer!); }
  }
  function data(result: any) {
    if (result.isError) throw new Error('Outil IMAP en échec');
    const text = result.content?.find((x: any) => x.type === 'text')?.text;
    if (!text) throw new Error('Réponse IMAP vide');
    return JSON.parse(text);
  }
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'euneos-mail-check', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await child.stdin.flush();
  } catch (error) { child.kill(); throw error; }
  return {
    call, data,
    close: async () => { child.kill(); await child.exited; await reader; await stderr; },
  };
}

async function verify() {
  const mcp = await openMcp();
  try {
    const tools = (await mcp.call('tools/list')).tools.map((x: any) => x.name);
    if (!tools.includes('imap_list_accounts') || !tools.includes('imap_test_account')) throw new Error('Outils de diagnostic IMAP absents');
    if (MAIL_TOOLS.some(x => !tools.includes(x)) || tools.some((x: string) => !MAIL_TOOLS.includes(x))) throw new Error('Liste des outils mail inattendue : configuration à corriger.');
    console.log('OK : lecture et brouillons disponibles ; envoi, réponse et transfert exposés avec validation OpenCode. Suppression/déplacement exclus.');
    if (capabilitiesOnly) return true;
    const accounts = mcp.data(await mcp.call('tools/call', { name: 'imap_list_accounts', arguments: {} })).accounts;
    const matches = accounts.filter((a: any) => a.user?.toLowerCase() === email);
    if (matches.length !== 1) {
      console.log(matches.length ? 'À vérifier : plusieurs comptes correspondent à cette adresse.' : `À configurer : aucun compte IMAP pour ${email}.`);
      return false;
    }
    const account = matches[0];
    if (account.host !== 'imap.viaduc.fr' || account.port !== 993 || !account.tls) {
      console.log('À corriger dans l’assistant local : imap.viaduc.fr, port 993, TLS activé.');
      return false;
    }
    const test = mcp.data(await mcp.call('tools/call', { name: 'imap_test_account', arguments: { accountId: account.id } }));
    if (!test.success) {
      console.log('Échec de connexion Viaduc : vérifier le mot de passe dans l’assistant local (aucun secret affiché).');
      return false;
    }
    const folders = mcp.data(await mcp.call('tools/call', { name: 'imap_list_folders', arguments: { accountId: account.id } }));
    const list = Array.isArray(folders) ? folders : folders.folders;
    if (!Array.isArray(list) || !list.length) throw new Error('Liste des dossiers IMAP vide');
    console.log(`OK : authentification Viaduc et lecture de ${list.length} dossiers IMAP.`);
    console.log('Vérification reçus/envoyés : demander à l’agent de lire les derniers messages, sans marquer comme lus.');
    return true;
  } finally { await mcp.close(); }
}

const safeErrors = new Set([
  'Profil OpenCode du kit introuvable. Aucun profil créé ou remplacé.',
  'Profil non JSON standard : faire modifier uniquement mcp.mail par l’agent, en conservant les commentaires JSONC.',
  'Clé IMAP manquante avec comptes existants : restaurer la clé d’origine, ne pas en générer une autre.',
  'Format instructions inattendu : profil conservé.',
  'Délai MCP dépassé (90 s)',
  'Serveur MCP arrêté avant sa réponse',
]);

async function main() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Fournir --email=adresse@domaine.fr ; aucun compte supposé par défaut.'); process.exitCode = 1; return; }
  if (!existsSync(configPath)) throw new Error('Profil OpenCode du kit introuvable. Aucun profil créé ou remplacé.');
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch { throw new Error('Profil non JSON standard : faire modifier uniquement mcp.mail par l’agent, en conservant les commentaires JSONC.'); }
  // Never replace encrypted accounts or generate a new key over an existing account store.
  const store = join(home, '.imap-mcp/accounts.json');
  if (existsSync(store) && !existsSync(join(home, '.imap-mcp/.key'))) throw new Error('Clé IMAP manquante avec comptes existants : restaurer la clé d’origine, ne pas en générer une autre.');
  if (!checkOnly) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    config.mcp ??= {};
    config.mcp.mail = { ...config.mcp.mail, type: 'local', enabled: true, command, timeout: 60_000,
      environment: { ...config.mcp.mail?.environment, ...MAIL_ENVIRONMENT } };
    if (config.permission !== undefined && (typeof config.permission !== 'object' || config.permission === null)) throw new Error('Permissions inattendues : conserver le profil et faire corriger la section mail par l’agent.');
    config.permission ??= {};
    for (const key of Object.keys(config.permission)) if (key.startsWith('mail_')) delete config.permission[key];
    config.permission['mail_*'] = 'deny';
    for (const name of [...READ_TOOLS, 'imap_save_draft']) config.permission['mail_' + name] = 'allow';
    for (const name of SEND_TOOLS) config.permission['mail_' + name] = 'ask';
    config.instructions ??= [];
    if (!Array.isArray(config.instructions)) throw new Error('Format instructions inattendu : profil conservé.');
    if (!config.instructions.includes(instructionPath)) config.instructions.push(instructionPath);
    if (existsSync(accessHelper)) {
      if (!config.instructions.includes(accessInstructionPath)) config.instructions.push(accessInstructionPath);
      config.permission ??= {};
      if (typeof config.permission.bash === 'object' && config.permission.bash !== null) {
        config.permission.bash['bun scripts/support/acces-ressources.ts verifier*'] = 'allow';
        config.permission.bash['bun scripts/support/acces-ressources.ts autoriser*'] = 'ask';
      }
    }
    const backup = configPath + '.avant-viaduc-' + stamp;
    copyFileSync(configPath, backup); chmodSync(backup, 0o600);
    privateWrite(instructionPath, instruction);
    if (existsSync(accessHelper)) privateWrite(accessInstructionPath, `# Accès des formateurs aux Ressources EUNEOS\n\nQuand Charlotte demande de donner accès à une adresse, utiliser la commande Bun locale\n${accessHelper} depuis le dossier EUNEOS, sans ouvrir le tableau de bord Cloudflare.\nCommande de lecture : bun scripts/support/acces-ressources.ts verifier\nPréparer un ajout : bun scripts/support/acces-ressources.ts autoriser adresse@email.fr\nAppliquer la demande explicite de Charlotte : ajouter --confirmer à la commande.\nLe script charge les accès localement, conserve les autres adresses et relit Cloudflare.\nIl ne gère que « EUNEOS — ressources », jamais l’espace équipe ni les rôles de validation.\nNe pas lire, afficher ni copier .env ou le jeton dans le chat.\nUne erreur HTTP 403 signifie que le jeton local n'a pas les droits nécessaires ; la signaler.\nNe pas annoncer l'accès créé si la relecture échoue. L’essai de connexion du formateur reste nécessaire.\n`);
    privateWrite(configPath, JSON.stringify(config, null, 2) + '\n');
    for (const doc of [join(home, '.config/opencode/AGENTS.md'), join(process.cwd(), 'equipe/charlotte/AGENTS.md'), join(process.cwd(), 'CLAUDE.md'), join(process.cwd(), '.claude/skills/preparer-un-email/SKILL.md')]) {
      if (!existsSync(doc)) continue;
      const before = readFileSync(doc, 'utf8');
      const after = before
        .replace("- **Aucun e-mail n'est envoyé par l'agent.** Il prépare un brouillon, la personne envoie.", "- **Messagerie :** l'agent lit et enregistre les brouillons demandés. Il envoie uniquement après validation explicite du message et confirmation OpenCode. Il ne supprime ni ne déplace de mails.")
        .replace("**Il ne peut pas envoyer,\nsupprimer ni déplacer un mail.**", "**Il peut enregistrer les brouillons et envoyer après validation explicite du message et confirmation OpenCode ; il ne supprime ni ne déplace de mails.**")
        .replace("- **Envoyer un e-mail.** Il lit votre boîte et prépare un brouillon à partir des 16 modèles,\n  mais c'est vous qui envoyez.", "- **Envoyer un e-mail sans votre validation.** Il peut enregistrer vos brouillons, puis envoyer après validation explicite et confirmation OpenCode.")
        .replace("4. Présenter le message final, prêt à copier.", "4. Présenter le message final. Si un brouillon est demandé, l’enregistrer avec mail_imap_save_draft ; si un envoi est demandé, faire valider le message puis utiliser l’outil d’envoi avec confirmation OpenCode.")
        .replace("- **Rien ne part d'ici.** Le message est remis à l'équipe, qui l'envoie depuis sa messagerie.\n  Le dire à chaque fois.", "- **Profil Charlotte activé :** enregistrer les brouillons demandés ; envoyer uniquement après validation explicite du message et confirmation OpenCode. Pour un profil dont l’envoi n’est pas activé, expliquer cette limite réelle. Ne jamais déclarer un envoi réussi sans succès de l’outil.");
      if (after !== before) { const backupDoc = doc + '.avant-mail-' + stamp; copyFileSync(doc, backupDoc); chmodSync(backupDoc, 0o600); privateWrite(doc, after); }
    }
    console.log('OK : profil mail corrigé et sauvegarde locale créée. Les autres connecteurs sont conservés.');
  }
  activeMailEnvironment = { IMAP_MCP_READ_ONLY: config.mcp?.mail?.environment?.IMAP_MCP_READ_ONLY || '', IMAP_MCP_ENABLED_TOOLS: config.mcp?.mail?.environment?.IMAP_MCP_ENABLED_TOOLS || '' };
  if (await verify()) {
    console.log('Fermer puis rouvrir OpenCode pour charger le profil corrigé et ses consignes.');
    if (capabilitiesOnly) console.log('Le compte et le SMTP réel ne sont pas testés par ce contrôle des outils.');
    return;
  }
  if (noSetup || checkOnly) { process.exitCode = 2; return; }
  console.log('Ouverture de l’assistant IMAP local : saisir le mot de passe uniquement dans cette page, jamais dans le chat.');
  console.log('Après enregistrement, fermer l’assistant avec Ctrl+C puis relancer ce script avec --check.');
  const setup = Bun.spawn([process.execPath, 'x', '--bun', '--package', 'imap-mcp-server@2.2.0', 'imap-setup', '--skip-claude'],
    { env: { ...process.env, IMAP_MCP_BIND: '127.0.0.1' }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  await setup.exited;
  process.exitCode = 2;
}

if (import.meta.main) main().catch((error) => {
  // No raw exception: it could originate from a decrypted account or dependency.
  if (safeErrors.has(error?.message)) console.error(error.message);
  console.error('Réparation interrompue. Profil sauvegardé si modifié. Faire contrôler le démarrage MCP et la présence du compte/clé, sans afficher leur contenu.');
  process.exitCode = 1;
});
