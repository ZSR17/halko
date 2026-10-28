English · [Français](fr/deploiement.md)

# Deployment

Halko is deployed as one Docker image holding the API, the built app and ffmpeg, published on
`ghcr.io/zsr17/halko` for linux/amd64, linux/arm64 and linux/arm/v7. It runs on a Linux server or NAS, on
a Raspberry Pi (32 or 64-bit system), and on Windows or a Mac with Docker Desktop. A modest machine is
enough: 512 MB of RAM.

## Requirements

- **Docker** (preferably with Docker Compose).
- **HTTPS**, recommended but not required: the app also works over plain HTTP (`http://address:3000`),
  but the password, the device token and the data then go over the network in clear text, and the browser
  may erase the local data when short of space. On a private network, a reverse proxy with its own certificate authority works, provided the root certificate is
  installed on each device.
- **Outgoing Internet access** for the server, only for the first download of the exercise library. The
  app itself does not need to be exposed to the Internet: local access, plus a VPN from outside, is the
  intended use.

## Installation with Docker Compose

In a new folder, get [`compose.yaml`](../compose.yaml) from this repository, then:

```sh
# App password: asked twice, never shown; prints its hash
docker run --rm -it ghcr.io/zsr17/halko node --import tsx src/scripts/hash-password.ts
```

Put that hash in a `halko.env` file next to `compose.yaml`, between single quotes (otherwise Compose takes
each `$` for a variable):

```sh
APP_PASSWORD_HASH='scrypt$…'
```

```sh
docker compose up -d
docker logs -f halko     # "library import": download of the library on first start
```

The data lives in the `halko-data` Docker volume. To keep it in a folder of the host instead, replace
`halko-data:/data` with `./data:/data`: the server gives that folder to the user `PUID`:`PGID` (1000 by
default, the first user of most Linux systems) and runs as them; set both to your own ids (`id -u`,
`id -g`) if they differ.

## Reverse proxy

Any HTTPS reverse proxy works, with three settings:

- **Upload size**: at least 110 MB, for videos (the server accepts 100 MB).
- **No buffering** of `text/event-stream` responses (`/api/v1/events`), otherwise the other devices are no
  longer told in real time.
- **No login page** in front of the app (single sign-on, etc.): it has its own password, and a redirect
  would break the sync.

If the proxy is not on the same machine or Docker network, add its address to `TRUST_PROXY`: the server
needs the device's real address to limit login attempts.

## Configuration

Environment variables, in `halko.env` or in `compose.yaml`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PASSWORD_HASH` | *(empty)* | scrypt hash of the password. **Required**: without it, every login is refused. Between single quotes in a file read by Compose, otherwise each `$` is taken for a variable. |
| `TRUST_PROXY` | `127.0.0.1/32,172.16.0.0/12` | Proxies whose `X-Forwarded-For` header is accepted. |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`). |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Where the server listens. |
| `DATA_DIR` | `/data` | SQLite database, media and backups. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Video conversion (already in the image). |
| `PUID`, `PGID` | `1000`, `1000` | User and group the server runs as, owner of the data folder. |

## Opening the app

Open the server's address in a recent browser. On first launch, the app asks for the language and the
units, then for the password.

## Backups

`data/` below is the data folder: the `halko-data` volume, or your folder.

- Every day, the server copies the database into `data/backups/` (`VACUUM INTO`) and keeps the last 7.
- The media are in `data/media/`. Backing up all of `data/` is enough.
- From the app, Settings → My data exports all your data as JSON.

To restore a copy: stop the container, replace `data/halko.db` with a copy from `data/backups/`, delete
`halko.db-wal` and `halko.db-shm`, then restart.

## Updating

Each version is listed, with what it brings, in the [changelog](../CHANGELOG.md) and the
[releases](https://github.com/ZSR17/halko/releases); the app shows the one it runs in Settings → About.

```sh
docker compose pull
docker compose up -d
```

`latest` follows the newest version. To update without ever needing a manual step, use the major
version's tag instead (`ghcr.io/zsr17/halko:1`), or `ghcr.io/zsr17/halko:1.0` for the fixes of 1.0 only. Database migrations apply by themselves on start, and devices get the new
version of the app the next time they open it.

## Monitoring

`GET /api/health` answers `{ ok: true, version }` without authentication. The image already has a Docker
`HEALTHCHECK` using it; the same link suits a monitoring tool.
