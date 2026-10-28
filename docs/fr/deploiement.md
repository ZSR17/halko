[English](../deployment.md) · Français

# Déploiement

Halko se déploie en une image Docker qui contient l'API, l'application compilée et ffmpeg, publiée sur
`ghcr.io/zsr17/halko` pour linux/amd64, linux/arm64 et linux/arm/v7. Elle tourne sur un serveur ou un NAS
Linux, sur un Raspberry Pi (système 32 ou 64 bits), et sous Windows ou sur Mac avec Docker Desktop. Une
machine modeste suffit : 512 Mo de RAM.

## Prérequis

- **Docker** (avec Docker Compose de préférence).
- **HTTPS**, recommandé mais pas obligatoire : l'app marche aussi en HTTP simple (`http://adresse:3000`),
  mais le mot de passe, le jeton de l'appareil et les données passent alors en clair sur le réseau, et le
  navigateur peut effacer les données locales s'il manque de place. Sur un réseau privé, un reverse proxy avec sa propre autorité de certification convient, à condition
  d'installer le certificat racine sur chaque appareil.
- **Accès Internet sortant** pour le serveur, seulement pour le premier téléchargement de la bibliothèque
  d'exercices. L'app elle-même n'a pas besoin d'être exposée sur Internet :
  un accès local, plus un VPN pour l'extérieur, est l'usage prévu.

## Installation avec Docker Compose

Dans un nouveau dossier, récupère [`compose.yaml`](../../compose.yaml) depuis ce dépôt, puis :

```sh
# Mot de passe de l'app : demandé deux fois, jamais affiché ; affiche son empreinte
docker run --rm -it ghcr.io/zsr17/halko node --import tsx src/scripts/hash-password.ts
```

Mets cette empreinte dans un fichier `halko.env` à côté de `compose.yaml`, entre apostrophes (sinon
Compose prend chaque `$` pour une variable) :

```sh
APP_PASSWORD_HASH='scrypt$…'
```

```sh
docker compose up -d
docker logs -f halko     # « library import » : téléchargement de la bibliothèque au premier démarrage
```

Les données sont dans le volume Docker `halko-data`. Pour les garder plutôt dans un dossier de la machine,
remplace `halko-data:/data` par `./data:/data` : le serveur donne ce dossier à l'utilisateur `PUID`:`PGID`
(1000 par défaut, le premier utilisateur de la plupart des systèmes Linux) et tourne sous son nom ; mets-y
tes propres identifiants (`id -u`, `id -g`) s'ils diffèrent.

## Reverse proxy

N'importe quel reverse proxy HTTPS convient, avec trois réglages :

- **Taille des envois** : au moins 110 Mo, pour les vidéos (le serveur accepte 100 Mo).
- **Pas de mise en tampon** des réponses `text/event-stream` (`/api/v1/events`), sinon les autres appareils
  ne sont plus prévenus en temps réel.
- **Pas de page de connexion** devant l'app (authentification unique, etc.) : elle a son propre mot de
  passe, et une redirection casserait la synchronisation.

Si le proxy n'est pas sur la même machine ou le même réseau Docker, ajoute son adresse à `TRUST_PROXY` :
le serveur a besoin de la vraie adresse de l'appareil pour limiter les essais de connexion.

## Configuration

Variables d'environnement, dans `halko.env` ou dans `compose.yaml` :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `APP_PASSWORD_HASH` | *(vide)* | Empreinte scrypt du mot de passe. **Obligatoire** : sans elle, toute connexion est refusée. Entre apostrophes dans un fichier lu par Compose, sinon chaque `$` est pris pour une variable. |
| `TRUST_PROXY` | `127.0.0.1/32,172.16.0.0/12` | Proxys dont l'en-tête `X-Forwarded-For` est accepté. |
| `LOG_LEVEL` | `info` | Niveau des logs (`debug`, `info`, `warn`, `error`). |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Écoute du serveur. |
| `DATA_DIR` | `/data` | Base SQLite, médias et sauvegardes. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Conversion des vidéos (déjà dans l'image). |
| `PUID`, `PGID` | `1000`, `1000` | Utilisateur et groupe du serveur, propriétaires du dossier de données. |

## Ouvrir l'app

Ouvrir l'adresse du serveur dans un navigateur récent. Au premier lancement, l'app demande la langue et les
unités, puis le mot de passe.

## Sauvegardes

`data/` ci-dessous est le dossier de données : le volume `halko-data`, ou ton dossier.

- Chaque jour, le serveur copie la base dans `data/backups/` (`VACUUM INTO`) et garde les 7 dernières.
- Les médias sont dans `data/media/`. Sauvegarder tout `data/` suffit.
- Depuis l'app, Réglages → Mes données exporte toutes tes données en JSON.

Restaurer une copie : arrêter le conteneur, remplacer `data/halko.db` par une copie de `data/backups/`,
supprimer `halko.db-wal` et `halko.db-shm`, puis redémarrer.

## Mettre à jour

Chaque version est listée, avec ce qu'elle apporte, dans les [nouveautés](../../CHANGELOG.fr.md) et les
[releases](https://github.com/ZSR17/halko/releases) ; l'app affiche celle qui tourne dans Réglages → À propos.

```sh
docker compose pull
docker compose up -d
```

`latest` suit la version la plus récente. Pour ne jamais avoir d'étape à faire à la main, utilise plutôt
le tag de la version majeure (`ghcr.io/zsr17/halko:1`), ou `ghcr.io/zsr17/halko:1.0` pour les seuls
correctifs de la 1.0. Les migrations de la base s'appliquent
toutes seules au démarrage, et les appareils récupèrent la nouvelle version de l'app à leur prochaine
ouverture.

## Surveillance

`GET /api/health` répond `{ ok: true, version }` sans authentification. L'image a déjà un `HEALTHCHECK`
Docker qui l'utilise ; le même lien convient à un outil de surveillance.
