[English](../api.md) · Français

# API

Toutes les routes `/api/v1/*` demandent l'en-tête `Authorization: Bearer <jeton>`, sauf la connexion.
Les corps sont en JSON et validés par les schémas zod de `shared/`.

## Serveur

| Route | Rôle |
| --- | --- |
| `GET /api/health` | État du serveur et version (public, utilisé par le healthcheck Docker). |
| `GET /api/v1/storage` | Place occupée par la base et les médias. |

## Connexion et appareils

| Route | Rôle |
| --- | --- |
| `POST /api/v1/auth/login` `{ password, deviceName }` | Crée un appareil, renvoie `{ token, deviceId }`. Public, 10 essais par minute. |
| `POST /api/v1/auth/logout` | Déconnecte l'appareil courant. |
| `GET /api/v1/devices` | Appareils connectés. |
| `DELETE /api/v1/devices/:id` | Déconnecte un appareil (son jeton cesse de fonctionner). |

## Synchronisation

| Route | Rôle |
| --- | --- |
| `POST /api/v1/sync` `{ since, instance?, changes }` | Envoie les lignes modifiées, renvoie `{ instance, rev, changes, hasMore, remaining, rejected }`. Si `instance` (la base de la dernière synchro de l'appareil) n'est pas celle du serveur, rien n'est enregistré : l'appareil doit repartir de zéro. |
| `GET /api/v1/events` | Flux SSE : `{"rev":N}` quand les données changent. |
| `DELETE /api/v1/exercises/:id/override` | Supprime ta version d'un exercice de la bibliothèque. |

Le fonctionnement de la synchro est décrit dans [architecture.md](architecture.md#synchronisation).

Les exercices reçus ont quatre champs de plus que ceux envoyés : `mediaUrls` (les adresses des médias),
`customized` (un exercice de la bibliothèque que tu as modifié), `sourceRef` (l'identifiant
free-exercise-db d'un exercice de la bibliothèque, le même sur tous les serveurs, qui le désigne dans le
fichier d'une séance partagée : `shared/src/share.ts`) et `translations`. Pour un exercice de
la bibliothèque, `name` et `instructions` sont en anglais, et `translations` donne les autres langues :
`{ "fr": { "name": "…", "instructions": ["…"] } }`. Une langue absente s'affiche en anglais. Ta version
d'un exercice et tes propres exercices ont `translations: {}` : leur texte s'affiche tel quel.

Un exercice qui travaille un côté à la fois (un bras, une jambe, planche latérale…) a `unilateral: true` :
chaque série se fait d'un côté puis de l'autre, et ses répétitions, son temps et sa distance sont par côté.
Les exercices de la bibliothèque arrivent marqués (`server/src/import/library/unilateral.json`) ; ce
n'est pas réglable par l'utilisateur, et ce qu'un appareil envoie pour un exercice de la bibliothèque est
ignoré. Dans une séance (`workoutItems`), un exercice en durée peut se faire en série normale,
sans côtés (`bySide: false` ; `null` : côté par côté), et `switchS` donne les secondes pour changer de
côté (`null` : 5 s) ; les deux sont toujours envoyés. Une série effectuée (`setLogs`) a
`unilateral: true` quand elle a été faite côté par côté.

## Médias

| Route | Rôle |
| --- | --- |
| `POST /api/v1/media` | Corps = le fichier, `Content-Type` = son type (`image/*` ou `video/*`), 100 Mo max. Renvoie `{ ids, urls }`. `?crop=x,y,w,h` (fractions de 0 à 1) ne garde que cette partie d'une photo, prise sur l'originale. 415 si le type n'est pas pris en charge, 503 si ffmpeg est absent. |
| `POST /api/v1/media/from-url` `{ url, crop?, frameFirst? }` | Le serveur télécharge l'image, le GIF ou la vidéo du lien (http/https ; 20 Mo pour une image, 100 Mo pour un GIF ou une vidéo) et le garde comme un envoi. Un contenu annoncé comme données binaires est reconnu à ses premiers octets. Avec `frameFirst: true`, une photo fixe n'est pas gardée : réponse 422 `needs_framing`, pour la cadrer puis renvoyer le lien avec `crop` ; un GIF animé ou une vidéo est gardé tout de suite. 400 si le lien est invalide ou vise une adresse privée (aussi après redirection), 413 si le fichier est trop lourd, 415 si ce n'est ni une image ni une vidéo, 502 s'il est introuvable. |
| `GET /media/<sha256>.webp\|mp4` | Le fichier, mis en cache définitivement. Public pour que les balises `<img>` et `<video>` fonctionnent ; les noms ne se devinent pas. |
