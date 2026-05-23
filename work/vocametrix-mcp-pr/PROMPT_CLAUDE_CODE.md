# Prompt pour Claude Code

Tu es dans le repo `vocametrix-mcp`. Dans ce dossier tu trouveras :

- `vocametrix-mcp-audio-fix.patch` — patch `git format-patch` de 3 commits
- `PR_BODY.md` — description complète de la PR, en markdown, prête à utiliser comme `--body-file`
- `HOW_TO_OPEN_PR.md` — instructions de référence (pour ton info uniquement)
- `review/` — copies des fichiers finaux pour relecture humaine (à ignorer pour l'opération)

## Ce que tu dois faire

1. **Vérifier le contexte** : lis `package.json` et confirme que `name` vaut `@vocametrix/mcp-server`. Sinon, arrête-toi et préviens-moi.

2. **Préparer la branche** :
   - `git fetch origin`
   - Si la branche locale `fix/remote-friendly-audio-resolution` existe déjà, demande-moi quoi faire (la supprimer ? changer de nom ?). Ne l'écrase pas en silence.
   - Sinon : `git checkout -b fix/remote-friendly-audio-resolution origin/main`

3. **Appliquer le patch** : `git am vocametrix-mcp-audio-fix.patch`
   - Si `git am` échoue (conflit, fichier manquant), arrête-toi, fais `git am --abort`, et explique-moi exactement où ça a planté. Ne tente pas de résoudre les conflits seul.

4. **Vérifier que tout passe localement, dans cet ordre, en t'arrêtant à la première erreur** :
   - `npm install`
   - `npm run typecheck` — doit être clean
   - `npm test` — doit afficher `# pass 12` et `# fail 0`
   - `npm run build` — doit produire `dist/` sans erreur

5. **Pusher la branche** : `git push -u origin fix/remote-friendly-audio-resolution`

6. **Créer la PR** avec `gh` CLI :
   ```bash
   gh pr create \
     --title "fix(audio): make audio-input resolution robust on hosted/remote deployments" \
     --body-file PR_BODY.md \
     --base main
   ```
   - Si `gh` n'est pas authentifié ou pas installé, arrête-toi et dis-le-moi — je créerai la PR manuellement via l'URL de comparaison que GitHub renverra au `git push`.

7. **Nettoyer les fichiers de transfert** UNIQUEMENT après que la PR est créée avec succès :
   - Supprime `vocametrix-mcp-audio-fix.patch`, `PR_BODY.md`, `HOW_TO_OPEN_PR.md`, et le dossier `review/`. Ces fichiers étaient uniquement le pont entre la conversation Claude.ai et toi, ils n'ont rien à faire dans le repo.
   - Ne fais PAS de commit après ce nettoyage : la branche poussée contient déjà ce qu'elle doit contenir, ces fichiers étaient juste posés à côté en local.

## Rapport attendu en fin de tâche

- URL de la PR créée
- Résumé : `git log --oneline origin/main..HEAD` (doit montrer exactement 3 commits)
- `git diff --stat origin/main..HEAD` (doit montrer 7 fichiers, ~+270/-28)
- Confirmation que les 4 vérifications locales sont passées
- Confirmation que les fichiers de transfert ont été nettoyés

## Contraintes

- **Ne fais aucune autre modification au repo** (pas de reformat, pas de bump de version, pas de tweak de dépendances, pas de squash).
- **Ne modifie pas les messages de commit** ni l'auteur des commits du patch.
- **Arrête-toi et demande-moi** si quoi que ce soit dévie de la procédure ci-dessus : conflit, test qui échoue, `gh` qui plante, branche existante, etc. Pas d'auto-réparation silencieuse.

## Contexte (pour ton info)

Cette PR corrige un bug : la fonction `resolveToBuffer` du MCP Vocametrix fait `readFileSync` en dernier recours sur tout input qui n'est ni une URL ni un data URL. Sur le serveur Railway (hébergé), quand un utilisateur attache un audio dans Claude.ai, le LLM passe un identifiant opaque comme `audioPath`, le `readFileSync` plante en `ENOENT`, et le LLM n'a aucun signal pour s'auto-corriger. La PR refuse explicitement ces inputs avec un message d'erreur qui dit au LLM quel tool appeler (`vocametrix_upload_audio`) et dans quel ordre. Elle ajoute aussi 12 tests unitaires, un flag opt-in `VOCAMETRIX_MCP_LOCAL_FS=1` pour les déploiements stdio/local qui doivent lire le filesystem, et la doc README associée.
