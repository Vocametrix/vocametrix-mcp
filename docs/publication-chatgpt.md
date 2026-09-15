# Publication publique de Vocametrix dans ChatGPT

État au 12 septembre 2026 : connexion OAuth et appel réel confirmés dans ChatGPT.
Le plugin reste en mode développement. Aucun dossier public n’a été soumis.

## Où commencer

Portail : https://platform.openai.com/plugins

Sélectionner l’organisation de Vocametrix, vérifier l’identité de Vocametrix OÜ,
puis créer un plugin « With MCP ». Le déposant doit être propriétaire de
l’organisation ou avoir « Apps Management: Write ».

## Éléments déjà disponibles

- Nom : Vocametrix.
- Serveur universel : https://independent-happiness-production-75b7.up.railway.app/chatgpt/mcp
- Authentification : OAuth, compte Vocametrix avec crédits API.
- Site : https://www.vocametrix.com
- Confidentialité : https://www.vocametrix.com/privacy
- Conditions : https://www.vocametrix.com/terms
- Logo source : `docs/vocametrix-plugin-icon.png` (version compacte pour le test).
- Test ChatGPT : https://chatgpt.com/c/6aa541fc-6180-83eb-a439-d1664551182a

Ne pas publier la clé personnelle, le secret client OAuth ou les identifiants du
plugin privé dans le site, la description publique ou les exemples.

## À préparer avant de soumettre

- Identité de l’éditeur vérifiée et contact de support public.
- Logo final et descriptions anglaises expliquant les usages et les crédits API.
- Compte de démonstration distinct, avec crédits suffisants et accès reproductible.
- Vérification du domaine : servir le jeton exact fourni par le portail à
  `/.well-known/openai-apps-challenge` sur l’hôte autorisé. Ne pas inventer de jeton.
- Scan des outils et correction des annotations selon leurs effets réels.
- Vérification des réponses : données personnelles, identifiants internes et
  informations de débogage ne doivent pas être renvoyés inutilement.
- Vérification des exigences OAuth de restriction par domaine d’organisation :
  le guide actuel demande UserInfo, email vérifié et scopes openid/email pour ce
  mécanisme. Notre configuration actuelle n’annonce que `vocametrix:api` ; ce
  point doit être traité avant de déclarer cette compatibilité.
- Revue des fonctionnalités et descriptions cliniques contre les règles de
  publication ; le succès technique ne vaut pas approbation du périmètre.
- Pays de disponibilité et notes de version.

## Tests du dossier (à exécuter, pas des résultats déclarés)

Positifs : connexion d’un compte éligible ; conversion phonétique ; génération
de mots ciblés ; import d’un vrai WAV autorisé et analyse appropriée ; renouvellement
de la connexion suivi d’un appel.

Négatifs : clé invalide ; crédits insuffisants ; appel après révocation. Documenter
pour chacun les entrées, les outils attendus, les fixtures et le comportement observé.
Le test audio reste à réaliser. Aucune mesure ne doit être inventée.

## Publication

Compléter et vérifier le brouillon, soumettre à OpenAI, traiter les retours, puis
publier après approbation. Ne mettre « disponible publiquement » et le lien
d’installation public sur la landing page qu’après vérification de cette publication.

Source officielle consultée :
https://developers.openai.com/plugins/deploy/submission
