#!/bin/bash
# Diagnostic d'un poste EUNEOS.
#
# Regarde l'installation de ce Mac (OpenCode, le dossier EUNEOS, la mise à jour automatique,
# le profil, les accès, la planification) et écrit un rapport sur le Bureau.
#
# Il ne change aucun réglage et ne touche à aucun fichier de travail : il lit, il interroge
# GitHub pour savoir si le dossier est à jour, et il lance deux lectures de la base.
# Le rapport ne contient ni mot de passe ni jeton : des versions, des dates, des noms de
# fichiers et des présences. Rien n'est envoyé : le fichier reste sur le Bureau.
#
#   Depuis le dossier EUNEOS :   bash scripts/diagnostic-poste.sh
#   Depuis le Terminal, même si le dossier est ancien ou cassé :
#     curl -fsSL https://raw.githubusercontent.com/Euneos/Siteweb/main/scripts/diagnostic-poste.sh | bash
set -u

APP="${EUNEOS_APP:-/Applications/OpenCode.app}"
CLI="$APP/Contents/Resources/opencode-cli"
CONFIG="$HOME/.config/opencode"
JOURNAL="$HOME/.local/share/opencode/log/opencode.log"
ACCES="$HOME/.euneos"
VERSION_MINI="2.4.0" # première version où la planification est une fonction standard
PY="$(command -v python3 2>/dev/null || true)"
BUN="$HOME/.bun/bin/bun"; [ -x "$BUN" ] || BUN="$(command -v bun 2>/dev/null || true)"

NB_PB=0; NB_VOIR=0; BILAN=""
titre() { printf '\n== %s\n' "$1"; }
ok()    { printf '  OK        %s\n' "$1"; }
info()  { printf '            %s\n' "$1"; }
voir()  { printf '  À VOIR    %s\n' "$1"; NB_VOIR=$((NB_VOIR + 1)); BILAN="${BILAN}  - à voir : $1"$'\n'; }
pb()    { printf '  PROBLÈME  %s\n' "$1"; NB_PB=$((NB_PB + 1)); BILAN="${BILAN}  - PROBLÈME : $1"$'\n'; }

# macOS n'a pas de commande `timeout` : on coupe au bout de N secondes avec perl.
avec_delai() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }
numero() { printf '%s' "$1" | awk -F. '{ printf "%d%03d%03d", $1, $2, $3 }'; }
court() { printf '%s' "$1" | sed "s|$HOME|~|g"; }

# json <fichier> <expression Python sur d> : affiche le résultat, rien si le fichier est illisible.
json() {
  [ -n "$PY" ] || return 1
  "$PY" -c 'import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
r = eval(sys.argv[2])
print("" if r is None else r)' "$1" "$2" 2>/dev/null
}

trouver_dossier() {
  local ici c
  ici="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  for c in "$ici" "$HOME/Documents/EUNEOS" "$HOME/EUNEOS"; do
    if [ -n "$c" ] && [ -f "$c/equipe/membres.json" ]; then printf '%s' "$c"; return; fi
  done
}

# ---------------------------------------------------------------------------------------

partie_opencode() {
  titre "1. OpenCode"
  if [ ! -d "$APP" ]; then pb "OpenCode n'est pas dans Applications."; return; fi
  VERSION="$(/usr/bin/defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  local derniere
  # Pas « releases/latest » : GitHub y désigne encore la branche 1.x. On prend le plus grand numéro publié.
  derniere="$(curl -fsS --max-time 8 'https://api.github.com/repos/anomalyco/opencode/releases?per_page=30' 2>/dev/null |
    sed -n 's/.*"tag_name": *"v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' |
    awk -F. '{ printf "%d%03d%03d %s\n", $1, $2, $3, $0 }' | sort -rn | head -1 | awk '{ print $2 }')"
  if [ -z "$VERSION" ]; then
    voir "Version d'OpenCode illisible."
  elif [ "$(numero "$VERSION")" -lt "$(numero "$VERSION_MINI")" ]; then
    pb "OpenCode $VERSION : trop ancien pour la planification (il faut $VERSION_MINI ou plus). Quitter complètement (Cmd+Q) puis rouvrir."
  elif [ -n "$derniere" ] && [ "$(numero "$VERSION")" -lt "$(numero "$derniere")" ]; then
    voir "OpenCode $VERSION, la dernière version est $derniere. Quitter complètement (Cmd+Q) puis rouvrir."
  else
    ok "OpenCode $VERSION${derniere:+ (dernière version publiée : $derniere)}"
  fi
  [ -n "$derniere" ] || info "Dernière version publiée : non vérifiée (pas de réponse de GitHub)."

  if [ -x "$CLI" ]; then
    local service
    service="$(avec_delai 15 "$CLI" service status 2>/dev/null | head -1)"
    if [ -n "$service" ]; then ok "Moteur d'OpenCode en marche"; else voir "Moteur d'OpenCode arrêté (OpenCode est-il ouvert ?)."; fi
  else
    voir "Outil en ligne de commande d'OpenCode introuvable dans l'application."
  fi
}

partie_dossier() {
  titre "2. Dossier EUNEOS"
  if [ -z "$D" ]; then pb "Dossier EUNEOS introuvable (ni ~/Documents/EUNEOS, ni ~/EUNEOS)."; return; fi
  ok "Dossier : $(court "$D")"
  if ! git -C "$D" rev-parse --git-dir >/dev/null 2>&1; then pb "Ce dossier n'est pas relié à GitHub (pas de dépôt git)."; return; fi

  info "Origine : $(git -C "$D" remote get-url origin 2>/dev/null | sed 's|//[^/@]*@|//|')"
  info "Branche : $(git -C "$D" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  info "Dernier mouvement : $(git -C "$D" log -g -1 --format='%gd %gs' --date=format:'%d/%m/%Y %H:%M' 2>/dev/null | cut -c1-110)"
  info "Version en place : $(git -C "$D" log -1 --format='%h du %cd' --date=format:'%d/%m/%Y %H:%M' 2>/dev/null)"

  if GIT_TERMINAL_PROMPT=0 avec_delai 30 git -C "$D" fetch --quiet origin main 2>/dev/null; then
    local retard avance
    retard="$(git -C "$D" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
    avance="$(git -C "$D" rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
    info "Version en ligne : $(git -C "$D" log -1 --format='%h du %cd' --date=format:'%d/%m/%Y %H:%M' origin/main 2>/dev/null)"
    if [ "$retard" = "0" ]; then ok "Dossier à jour"; else pb "Dossier en retard de $retard modification(s) sur la version en ligne."; fi
    [ "$avance" = "0" ] || voir "$avance modification(s) enregistrée(s) sur ce poste et jamais publiée(s)."
  else
    voir "GitHub injoignable : impossible de dire si le dossier est à jour."
  fi

  local modifs
  modifs="$(git -C "$D" status --porcelain 2>/dev/null)"
  if [ -z "$modifs" ]; then
    ok "Aucun fichier modifié en attente"
  else
    voir "$(printf '%s\n' "$modifs" | grep -c .) fichier(s) modifié(s) ou ajouté(s) sur ce poste, non enregistré(s) :"
    printf '%s\n' "$modifs" | head -12 | sed 's/^/              /'
  fi
}

partie_synchro() {
  titre "3. Mise à jour automatique du dossier"
  [ -n "$D" ] || { info "Sans dossier, rien à vérifier."; return; }
  local plugin="$D/.opencode/plugin/euneos-sync.ts" rep f
  if [ ! -f "$plugin" ]; then
    pb "Le module de mise à jour (.opencode/plugin/euneos-sync.ts) est absent."
  elif grep -q '^export default' "$plugin"; then
    ok "Module de mise à jour au format OpenCode 2"
  else
    pb "Module de mise à jour à l'ancien format : OpenCode 2 ne le charge pas, le dossier ne se met plus à jour tout seul. Demander une fois à l'agent : « mets le dossier à jour »."
  fi

  for rep in "$D/.opencode/plugin" "$D/.opencode/plugins" "$CONFIG/plugin" "$CONFIG/plugins"; do
    [ -d "$rep" ] || continue
    for f in "$rep"/*; do
      [ -f "$f" ] || continue
      [ "$f" = "$plugin" ] || info "Autre module présent : $(court "$f")"
    done
  done

  if [ -f "$JOURNAL" ]; then
    local charge echec
    charge="$(grep 'loading plugin' "$JOURNAL" | grep 'euneos-sync' | tail -1 | sed -n 's/.*timestamp=\([^ ]*\).*/\1/p')"
    echec="$(grep 'failed to load plugin' "$JOURNAL" | grep 'euneos-sync' | tail -1 | sed -n 's/.*timestamp=\([^ ]*\).*/\1/p')"
    if [ -z "$charge" ] && [ -z "$echec" ]; then
      info "Journal d'OpenCode : aucune trace du module (dossier jamais ouvert depuis le dernier nettoyage du journal ?)."
    elif [ -n "$echec" ] && { [ -z "$charge" ] || [ ! "$charge" \> "$echec" ]; }; then
      pb "Au dernier démarrage, OpenCode n'a pas réussi à charger le module ($echec, heure universelle)."
    else
      ok "Module chargé sans erreur au dernier démarrage ($charge, heure universelle)"
    fi
    local nb
    nb="$(grep -c 'failed to load plugin' "$JOURNAL" 2>/dev/null || true)"
    if [ "${nb:-0}" != "0" ]; then
      info "Échecs de chargement de modules dans le journal, toutes dates confondues : $nb"
      grep 'failed to load plugin' "$JOURNAL" | sed -n 's/.*target=\([^ ]*\).*/\1/p' | sed "s|$HOME|~|" |
        sort | uniq -c | sort -rn | head -5 | sed 's/^ */              /'
    fi
  else
    info "Journal d'OpenCode introuvable ($(court "$JOURNAL"))."
  fi

  local trace="$ACCES/derniere-synchro.json"
  if [ -f "$trace" ]; then
    local quand resultat profil
    quand="$(json "$trace" 'd.get("quand")')"
    resultat="$(json "$trace" 'd.get("recuperation")')"
    profil="$(json "$trace" 'd.get("profil")')"
    if [ "$resultat" = "ok" ]; then
      ok "Dernier passage : $quand (heure universelle), profil : $profil"
    else
      voir "Dernier passage : $quand (heure universelle), récupération : ${resultat:-inconnue}. Une modification locale bloque peut-être la mise à jour."
    fi
  else
    voir "La mise à jour automatique n'a encore jamais tourné sur ce poste (pas de trace)."
  fi
}

partie_profil() {
  titre "4. Profil de la personne"
  PRENOM=""
  if [ -n "$D" ]; then
    local env="$D/.env" cle manquantes=""
    if [ -f "$env" ]; then
      for cle in NOCODB_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID EUNEOS_EMAIL EUNEOS_RESPONSABLES; do
        grep -q "^$cle=." "$env" || manquantes="$manquantes $cle"
      done
      if [ -z "$manquantes" ]; then ok "Fichier .env complet (droits $(stat -f %Lp "$env" 2>/dev/null))"; else pb "Fichier .env : valeur absente pour$manquantes."; fi
      [ -n "$PY" ] && PRENOM="$("$PY" -c 'import json, re, sys
env = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^EUNEOS_EMAIL=(.+)$", env, re.M)
membres = json.load(open(sys.argv[2], encoding="utf-8"))
print(membres.get(m.group(1).strip().lower(), "") if m else "")' "$env" "$D/equipe/membres.json" 2>/dev/null)"
      if [ -n "$PRENOM" ]; then ok "Poste reconnu : $PRENOM"; else voir "L'adresse du fichier .env ne correspond à aucun membre de l'équipe : le profil ne sera pas mis à jour."; fi
    else
      pb "Fichier .env absent du dossier : ni base, ni calendrier."
    fi
  fi

  local installe="$CONFIG/AGENTS.md"
  if [ ! -f "$installe" ]; then
    voir "Aucune consigne personnelle installée ($(court "$installe"))."
  elif [ -n "$PRENOM" ] && [ -f "$D/equipe/$PRENOM/AGENTS.md" ]; then
    if cmp -s "$installe" "$D/equipe/$PRENOM/AGENTS.md"; then
      ok "Consignes personnelles identiques à celles du dossier"
    else
      voir "Consignes personnelles différentes de celles du dossier ($(diff "$D/equipe/$PRENOM/AGENTS.md" "$installe" | grep -c '^[<>]') ligne(s) d'écart). À la prochaine mise à jour, celles du dossier les remplacent (une copie de l'ancienne version est gardée)."
    fi
    if git -C "$D" show "origin/main:equipe/$PRENOM/AGENTS.md" >/dev/null 2>&1; then
      git -C "$D" show "origin/main:equipe/$PRENOM/AGENTS.md" | cmp -s - "$installe" ||
        info "Elles diffèrent aussi de la version en ligne."
    fi
  else
    info "Consignes personnelles présentes, du $(stat -f '%Sm' -t '%d/%m/%Y %H:%M' "$installe" 2>/dev/null)."
  fi

  local f cle valeur trouve=0
  for f in "$CONFIG/opencode.json" "$CONFIG/opencode.jsonc" "$CONFIG/config.json" \
    "$D/opencode.json" "$D/opencode.jsonc" "$D/.opencode/opencode.json" "$D/.opencode/opencode.jsonc"; do
    [ -f "$f" ] || continue
    trouve=1
    local cles
    cles="$(json "$f" '", ".join(d.keys())')"
    if [ -z "$cles" ]; then
      voir "Réglages illisibles : $(court "$f") (fichier abîmé, ou avec des commentaires)."
    else
      ok "Réglages : $(court "$f"), modifié le $(stat -f '%Sm' -t '%d/%m/%Y %H:%M' "$f" 2>/dev/null)"
      info "Rubriques : $cles"
      info "Modèle : $(json "$f" 'd.get("model", "non précisé ici")') · règles de permission : $(json "$f" 'sum(len(v) if isinstance(v, dict) else 1 for v in d.get("permission", {}).values())') · connexions : $(json "$f" '", ".join(d.get("mcp", {}).keys()) or "aucune"')"
      local inattendues
      inattendues="$(json "$f" '", ".join(k for k in d if k not in ("$schema", "model", "instructions", "mcp", "permission"))')"
      # Seuls les noms sont affichés : une rubrique ajoutée peut contenir une clé d'accès.
      [ -z "$inattendues" ] || voir "Rubrique(s) ajoutée(s) sur ce poste dans $(court "$f") : $inattendues."
      # Ces deux-là ne contiennent que des interrupteurs : on peut les montrer.
      for cle in experimental automations; do
        valeur="$(json "$f" "json.dumps(d['$cle'], ensure_ascii=False)[:200] if '$cle' in d else ''")"
        [ -z "$valeur" ] || info "$cle = $valeur"
      done
    fi
    if grep -qi 'schedule' "$f"; then
      voir "Ancien réglage de planification (« schedules ») dans $(court "$f") : sans effet depuis OpenCode 2.4, à retirer."
    fi
  done
  [ "$trouve" = 1 ] || pb "Aucun fichier de réglages OpenCode sur ce poste."
  case "$D" in "$HOME/Documents/EUNEOS") ;; "") ;; *) info "Le dossier n'est pas à l'emplacement habituel (~/Documents/EUNEOS)." ;; esac
}

partie_acces() {
  titre "5. Accès et outils"
  local f manquants="" chemin
  for f in nocodb-mcp-url nocodb-mcp-token google-client-id google-client-secret excel-dir bunx uvx; do
    [ -s "$ACCES/$f" ] || manquants="$manquants $f"
  done
  if [ -z "$manquants" ]; then ok "Fichiers d'accès présents ($(court "$ACCES"))"; else pb "Fichiers d'accès absents ou vides dans $(court "$ACCES") :$manquants."; fi
  for f in bunx uvx; do
    [ -s "$ACCES/$f" ] || continue
    chemin="$(cat "$ACCES/$f")"
    [ -x "$chemin" ] || pb "L'outil désigné par $f n'existe plus à cet endroit : $(court "$chemin")."
  done
  if [ -s "$ACCES/excel-dir" ]; then
    chemin="$(cat "$ACCES/excel-dir")"
    if [ ! -d "$chemin" ]; then
      pb "Le dossier des fichiers Excel n'existe plus (Google Drive pour ordinateur est-il lancé ?)."
    else
      case "$chemin" in
        *CloudStorage/GoogleDrive-*) ok "Fichiers Excel : dossier Google Drive présent" ;;
        *) voir "Fichiers Excel : dossier local provisoire, pas le Drive de l'équipe." ;;
      esac
    fi
  fi
  case "$PRENOM" in
    charlotte | candice)
      if [ -d "$HOME/.imap-mcp" ] && [ -n "$(ls -A "$HOME/.imap-mcp" 2>/dev/null)" ]; then ok "Boîte mail configurée"; else pb "Boîte mail non configurée sur ce poste."; fi
      ;;
  esac
  info "git : $(git --version 2>/dev/null | awk '{ print $3 }') · bun : $([ -n "$BUN" ] && "$BUN" --version 2>/dev/null || echo absent) · python3 : $([ -n "$PY" ] && echo présent || echo absent)"
}

partie_essais() {
  titre "6. Essais de fonctionnement (lecture seule)"
  [ -n "$D" ] || { info "Sans dossier, pas d'essai."; return; }
  if [ -z "$BUN" ]; then
    pb "bun est absent : les lectures de la base et du calendrier ne peuvent pas tourner."
  else
    if (cd "$D" && avec_delai 60 "$BUN" scripts/base.mjs campagne 2>/dev/null | grep -q 'Campagne'); then ok "Base des dossiers : répond"; else pb "Base des dossiers : pas de réponse (bun scripts/base.mjs campagne)."; fi
    if (cd "$D" && avec_delai 60 "$BUN" scripts/calendrier.ts mois "$(date +%Y-%m)" equipe >/dev/null 2>&1); then ok "Calendrier : répond"; else pb "Calendrier : pas de réponse (bun scripts/calendrier.ts mois)."; fi
  fi
  if [ -x "$CLI" ]; then
    local connexions
    connexions="$(cd "$D" && avec_delai 60 "$CLI" mcp list 2>/dev/null)"
    if [ -z "$connexions" ]; then
      info "Connexions de l'agent : état non lu (OpenCode fermé, ou version trop ancienne)."
    else
      printf '%s\n' "$connexions" | sed 's/^/              /'
      if printf '%s\n' "$connexions" | grep -v '^[[:space:]]*$' | grep -qv 'connected'; then
        voir "Au moins une connexion de l'agent n'est pas établie (liste ci-dessus)."
      else
        ok "Toutes les connexions de l'agent sont établies"
      fi
    fi
  fi
}

partie_planification() {
  titre "7. Planification"
  if [ -n "${VERSION:-}" ] && [ "$(numero "$VERSION")" -lt "$(numero "$VERSION_MINI")" ]; then
    info "Pas de planification fiable avant OpenCode $VERSION_MINI (ici : $VERSION) : voir le point 1."
  fi
  [ -x "$CLI" ] && [ -n "$PY" ] || { info "Liste des tâches planifiées : non lue."; return; }
  local reponse
  reponse="$(cd "${D:-$HOME}" && avec_delai 30 "$CLI" api GET /api/experimental/automation 2>/dev/null)"
  if [ -z "$reponse" ]; then info "Liste des tâches planifiées : pas de réponse (OpenCode fermé, ou version trop ancienne)."; return; fi
  printf '%s' "$reponse" | "$PY" -c 'import datetime, json, sys
try:
    taches = json.load(sys.stdin).get("data", [])
except Exception:
    print("            Réponse illisible."); sys.exit(0)
def quand(v):
    if isinstance(v, (int, float)) and v > 0:
        return datetime.datetime.fromtimestamp(v / 1000 if v > 1e11 else v).strftime("%d/%m/%Y %H:%M")
    return str(v) if v else "-"
if not taches:
    print("            Aucune tâche planifiée sur ce poste.")
for t in taches:
    d = t.get("trigger") or {}
    rythme = d.get("cron") or d.get("every") or d.get("at") or d.get("event") or "?"
    print("            « %s » · %s %s%s · état : %s · prochain passage : %s · passages : %s · dernier : %s (%s)" % (
        t.get("name"), d.get("type"), rythme, (" " + (t.get("tz") or d.get("tz"))) if (t.get("tz") or d.get("tz")) else "",
        t.get("status"), quand(t.get("nextDueAt")), t.get("runCount"), quand(t.get("lastRunAt")), t.get("lastOutcome") or "-"))' 2>/dev/null ||
    info "Liste des tâches planifiées : illisible."
}

principal() {
  echo "DIAGNOSTIC DU POSTE EUNEOS — $(date '+%d/%m/%Y %H:%M')"
  echo "macOS $(sw_vers -productVersion 2>/dev/null) ($(uname -m))"
  D="$(trouver_dossier)"; VERSION=""; PRENOM=""
  partie_opencode
  partie_dossier
  partie_synchro
  partie_profil
  partie_acces
  partie_essais
  partie_planification
  titre "BILAN${PRENOM:+ — poste de $PRENOM}"
  if [ "$NB_PB" = 0 ] && [ "$NB_VOIR" = 0 ]; then
    echo "  Tout est en ordre."
  else
    echo "  $NB_PB problème(s), $NB_VOIR point(s) à voir."
    printf '%s' "$BILAN"
  fi
}

RAPPORT="${EUNEOS_RAPPORT:-$HOME/Desktop/diagnostic-euneos-$(date +%Y-%m-%d-%H%M).txt}"
[ -d "$(dirname "$RAPPORT")" ] || RAPPORT="${TMPDIR:-/tmp}/diagnostic-euneos-$(date +%Y-%m-%d-%H%M).txt"
# </dev/null : lancé par « curl … | bash », aucune commande ne doit avaler la suite du script.
principal 2>&1 </dev/null | tee "$RAPPORT"
printf '\nRapport enregistré : %s\nÀ envoyer à Charly.\n' "$RAPPORT"
