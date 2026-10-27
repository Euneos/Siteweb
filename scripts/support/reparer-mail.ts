#!/usr/bin/env bun
// Réparation locale du connecteur Viaduc OpenCode. Aucun mot de passe en argument.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const email = (args.find(a => a.startsWith('--email='))?.slice(8) || '').toLowerCase();
const checkOnly = args.includes('--check');
const noSetup = args.includes('--no-setup');
const home = homedir();
const root = join(home, '.euneos');
const configPath = join(home, '.config/opencode/opencode.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const command = [process.execPath, 'x', '--bun', 'imap-mcp-server@2.2.0'];
const instructionPath = join(root, 'viaduc-instructions.md');
const accessHelper = join(import.meta.dir, 'acces-ressources.ts');
const accessInstructionPath = join(root, 'cloudflare-instructions.md');
const instruction = `# Messagerie Viaduc\n\nPour les mails de ${email}, utiliser en priorité les outils MCP mail_imap_*.\nCommencer par mail_imap_list_accounts et sélectionner exactement ${email}.\nLire les reçus et les envoyés via IMAP, sans connexion au webmail Viaduc.\nSi le connecteur échoue, indiquer l'erreur IMAP et réparer sa configuration locale ;\nne pas remplacer silencieusement IMAP par le navigateur.\nNe jamais lire, afficher ni demander en conversation le contenu de ~/.imap-mcp/accounts.json\nou ~/.imap-mcp/.key, ni les mots de passe ou les jetons.\nNe jamais envoyer, déplacer, supprimer des mails ni modifier leurs indicateurs.\nEn cas de mot de passe absent ou refusé, utiliser seulement l'assistant IMAP local\nsur 127.0.0.1 : Charlotte le saisit elle-même, puis la connexion est retestée.\n`;

function privateWrite(path: string, content: string) {
  writeFileSync(path + '.tmp', content, { mode: 0o600 });
  chmodSync(path + '.tmp', 0o600);
  renameSync(path + '.tmp', path);
}

async function openMcp() {
  const child = Bun.spawn(command, {
    env: { ...process.env, IMAP_MCP_READ_ONLY: 'true', IMAP_MCP_ENABLED_TOOLS: '' },
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
    if (tools.some((x: string) => /imap_(send|reply|forward|delete|move|mark|add_account|update_account)/.test(x))) throw new Error('Mode lecture seule non respecté');
    console.log('OK : serveur MCP démarré avec Bun, outils de lecture disponibles.');
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
      environment: { ...config.mcp.mail?.environment, IMAP_MCP_READ_ONLY: 'true', IMAP_MCP_ENABLED_TOOLS: '' } };
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
    console.log('OK : profil mail corrigé et sauvegarde locale créée. Les autres connecteurs sont conservés.');
  }
  if (await verify()) {
    console.log('Fermer puis rouvrir OpenCode pour charger le profil corrigé et ses consignes.');
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
