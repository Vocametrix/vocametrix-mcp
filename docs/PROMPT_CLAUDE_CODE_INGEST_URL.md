# Prompt pour Claude Code — PR `vocametrix_ingest_url`

Tu es dans le repo `vocametrix-mcp`, sur la branche `main` à jour. La PR précédente (`fix(audio): make audio-input resolution robust on hosted/remote deployments`) a été mergée — son contenu est ta base.

Tu vas créer une nouvelle PR qui ajoute un tool atomique `vocametrix_ingest_url`.

## Ce que fait ce tool

Prendre une URL HTTPS publique vers un WAV (Google Drive direct-download, S3 public, Dropbox `?dl=1`, presigned URL, etc.), la fetch côté serveur Vocametrix, la re-stocker en blob, et retourner un `blobUrl` stable que l'utilisateur peut passer à n'importe quel tool d'analyse comme `audioPath`.

Pourquoi un tool séparé alors que `audioPath` accepte déjà les URLs HTTPS ? **Discoverability LLM.** Aujourd'hui le fait que `audioPath` accepte une URL est caché dans la description ; un tool nommé explicitement `ingest_url` fait que le LLM le choisit naturellement quand l'utilisateur colle un lien, au lieu de tenter du base64 inutilement.

## Étapes

### 1. Vérifier le contexte

Confirme :
- On est sur `main` à jour, working tree clean
- `package.json` → `"name": "@vocametrix/mcp-server"`
- Le commit le plus récent contient bien la PR précédente (cherche "make audio-input resolution robust" dans `git log`)

Sinon, arrête-toi et préviens-moi.

### 2. Créer la branche

```bash
git fetch origin
git checkout -b feat/ingest-url-tool origin/main
```

Si la branche existe déjà → demande-moi, n'écrase pas.

### 3. Créer le nouveau fichier `src/tools/atomic/ingest.ts`

Contenu **exact** (à coller tel quel) :

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, READONLY_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerIngestUrlTool(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_ingest_url",
    "Ingest a publicly fetchable audio URL into Vocametrix cloud storage and return a stable blobUrl. " +
    "Use this whenever the user provides a direct HTTPS URL pointing to a WAV file — Google Drive " +
    "direct-download links, S3 public objects, Dropbox links with ?dl=1, signed/presigned URLs, etc. " +
    "The URL is fetched once and re-stored on Vocametrix; the returned blobUrl is what you pass as " +
    "audioPath to any analysis tool. " +
    "This is the right tool when the user's input is a URL. " +
    "For files attached directly in the conversation (binary content, no URL), use " +
    "vocametrix_upload_audio with base64 instead.",
    {
      audioUrl: z.string().url().describe(
        "Public HTTPS URL pointing to a WAV file. Must be directly fetchable — no auth headers, " +
        "no login redirects, no HTML preview pages. For Google Drive use the direct-download form: " +
        "'https://drive.google.com/uc?export=download&id=FILE_ID'. For Dropbox append '?dl=1'."
      ),
    },
    READONLY_TOOL,
    async ({ audioUrl }) => {
      try {
        const blobUrl = await client.uploadBlobUrl(audioUrl);
        return ok({ blobUrl });
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
```

### 4. Wirer le tool dans `src/tools/index.ts`

Ouvre `src/tools/index.ts`, repère le pattern utilisé pour les autres tools atomiques (notamment `registerUploadTool`), et ajoute la nouvelle registration **juste après** celle de `registerUploadTool` (sémantiquement les deux sont liés : "obtenir un blobUrl").

Concrètement, deux modifications :
- Ajouter l'import `import { registerIngestUrlTool } from "./atomic/ingest.js";` à côté des autres imports atomiques
- Ajouter l'appel `registerIngestUrlTool(server, client);` à côté de l'appel `registerUploadTool(server, client);`

**Si `src/tools/index.ts` ne suit pas ce pattern exact, arrête-toi et montre-moi le fichier** — je te dirai où câbler.

### 5. Tests

Le comportement sous-jacent (fetch URL → upload blob) est déjà couvert par les tests `tests/audio-input.test.mjs` ajoutés dans la PR précédente (cas "https URL — calls fetch and returns its bytes" et "https URL with non-2xx response — surfaces the HTTP status").

Pour cette PR, **n'ajoute pas de nouveaux tests unitaires** — la logique réutilisée est déjà testée, et tester juste la registration apporte peu pour beaucoup de boilerplate. Vérifie simplement que la suite existante passe toujours :

```bash
npm install
npm run typecheck    # doit être clean
npm test             # doit afficher # pass 12, # fail 0
npm run build        # doit produire dist/ sans erreur
```

Si typecheck plante (signature de `registerIngestUrlTool` ou import), **arrête-toi et montre-moi l'erreur**, ne tente pas de corriger en devinant.

### 6. Mettre à jour le README

Dans `README.md`, dans la section **"How to pass audio to a tool"** (ajoutée par la PR précédente), il y a un tableau qui liste les inputs acceptés.

Ajoute une ligne **après** la ligne "Public `https://...` URL to a WAV file" :

```
| Public URL via `vocametrix_ingest_url` → returned blobUrl | ✅ recommended for URL inputs | ✅ |
```

Et ajoute le nouveau tool dans la section **"Tools"** du README — sous-section **"Speech and pronunciation"** ou crée un sous-bloc "Ingestion utilities" juste avant "Speech and pronunciation" si tu juges ça plus propre. Une ligne suffit :

```
| `vocametrix_ingest_url` | Ingest a public HTTPS WAV URL → returns a stable blobUrl |
```

Place-le à côté de `vocametrix_upload_audio` (si présent dans le tableau ; sinon dans un endroit cohérent — utilise ton jugement et arrête-toi pour me demander si rien ne convient).

### 7. Commit

Un seul commit, message :

```
feat(tools): add vocametrix_ingest_url for publicly-fetchable audio URLs

Adds a new atomic tool that takes a public HTTPS audio URL (Google Drive
direct-download, S3 public, Dropbox ?dl=1, presigned URLs, etc.), fetches
it, re-stores it on Vocametrix cloud storage, and returns a stable blobUrl
that callers pass as audioPath to analysis tools.

The audioPath schema already accepts public HTTPS URLs directly, but that
path is hidden inside the description and the LLM tends to default to
base64 upload via vocametrix_upload_audio even when the user provided a
URL. Surfacing a dedicated ingest_url tool makes the URL workflow
discoverable and lets the LLM pick the right path based on input type:

  - File attachment (binary)  -> vocametrix_upload_audio (base64)
  - URL string                -> vocametrix_ingest_url
  - Both return a blobUrl     -> passed as audioPath to analysis tools

Behavior delegates to client.uploadBlobUrl(), which already does
fetch -> re-upload; no new client method, no new dependencies. Tests
covering the underlying URL branch of resolveAudioInputToBuffer were
added in the previous PR.

README updated to list the new tool and reflect that URL-based inputs
should go through ingest_url for blobUrl stability.
```

### 8. Push et PR

```bash
git push -u origin feat/ingest-url-tool
gh pr create \
  --title "feat(tools): add vocametrix_ingest_url for publicly-fetchable audio URLs" \
  --body-file <(cat <<'EOF'
## Summary

Adds a new atomic tool `vocametrix_ingest_url` that takes a public HTTPS audio URL, fetches it, re-stores it on Vocametrix cloud storage, and returns a stable `blobUrl` for use as `audioPath` in analysis tools.

## Motivation

The `audioPath` schema already accepts public HTTPS URLs directly (since the previous PR), but that path is buried in the description and the LLM tends to default to base64 upload via `vocametrix_upload_audio` even when the user provided a URL. A dedicated `ingest_url` tool makes the URL workflow discoverable, and lets the LLM pick the right entry point based on the input type:

| User input | Tool to call | Returns |
|---|---|---|
| File attachment (binary) | `vocametrix_upload_audio` (base64) | `blobUrl` |
| Public URL string | `vocametrix_ingest_url` | `blobUrl` |

Both converge on a `blobUrl` which is then passed as `audioPath` to any analysis tool.

## What's in this PR

- **`src/tools/atomic/ingest.ts`** — new file, `registerIngestUrlTool`. Delegates to `client.uploadBlobUrl()` which already does fetch → re-upload. No new client methods.
- **`src/tools/index.ts`** — wires the new tool next to `registerUploadTool`.
- **`README.md`** — adds the new tool to the "Tools" section and adds a row to the "How to pass audio to a tool" table.

## What's NOT in this PR (intentional)

- No new unit tests. The URL fetch logic is already covered by `tests/audio-input.test.mjs` (`https URL — calls fetch and returns its bytes` and `https URL with non-2xx response — surfaces the HTTP status`), added in the previous PR. The new tool is pure wiring on top of already-tested code.
- No change to existing tools' descriptions or to the `audioPath` schema. The previous PR already mentions public URLs as a valid input type.

## Testing

```bash
npm install
npm run typecheck    # ✅ clean
npm test             # ✅ 12/12 pass (existing suite)
npm run build        # ✅ clean
```

Live test recommended post-deploy: in a Claude.ai conversation, paste a public WAV URL (e.g. Google Drive direct-download link) and ask for any analysis. The LLM should pick `vocametrix_ingest_url` automatically and chain it with the analysis tool.
EOF
) \
  --base main
```

### 9. Rapport final

- URL de la PR
- `git log --oneline origin/main..HEAD` (doit afficher exactement 1 commit)
- `git diff --stat origin/main..HEAD` (devrait être ~3 fichiers, ~+50/-0)
- Confirmation typecheck + test + build passent

## Contraintes (identiques à la PR précédente)

- **Ne fais aucune autre modification** au repo (pas de reformat, pas de bump, pas de tweak de dépendances).
- **Ne modifie aucun fichier hors de ceux listés** (`src/tools/atomic/ingest.ts` nouveau, `src/tools/index.ts` modifié, `README.md` modifié).
- **Arrête-toi et demande** si quoi que ce soit dévie : typecheck qui plante, pattern de `tools/index.ts` différent de ce que je décris, `gh` pas authentifié, etc.
