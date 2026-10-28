English · [Français](fr/api.md)

# API

Every `/api/v1/*` route needs the `Authorization: Bearer <token>` header, except login. Bodies are JSON
and validated by the zod schemas of `shared/`.

## Server

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Server status and version (public, used by the Docker healthcheck). |
| `GET /api/v1/storage` | Space used by the database and the media. |

## Login and devices

| Route | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` `{ password, deviceName }` | Creates a device, returns `{ token, deviceId }`. Public, 10 attempts per minute. |
| `POST /api/v1/auth/logout` | Logs the current device out. |
| `GET /api/v1/devices` | Connected devices. |
| `DELETE /api/v1/devices/:id` | Logs a device out (its token stops working). |

## Sync

| Route | Purpose |
| --- | --- |
| `POST /api/v1/sync` `{ since, instance?, changes }` | Sends the changed rows, returns `{ instance, rev, changes, hasMore, remaining, rejected }`. If `instance` (the database of the device's last sync) is not the server's, nothing is stored: the device must start over. |
| `GET /api/v1/events` | SSE stream: `{"rev":N}` when the data changes. |
| `DELETE /api/v1/exercises/:id/override` | Deletes your version of a library exercise. |

How sync works is described in [architecture.md](architecture.md#sync).

Exercises received have four more fields than the ones sent: `mediaUrls` (the media addresses),
`customized` (a library exercise you changed), `sourceRef` (the free-exercise-db id of a library exercise,
the same on every server, which names it in a shared workout file: `shared/src/share.ts`) and
`translations`. For a library exercise, `name` and
`instructions` are in English, and `translations` gives the other languages:
`{ "fr": { "name": "…", "instructions": ["…"] } }`. A missing language shows in English. Your version of
an exercise and your own exercises have `translations: {}`: their text is shown as is.

An exercise working one side at a time (one arm, one leg, side plank…) has `unilateral: true`: each set
is done on one side then the other, and its reps, time and distance are per side. Library exercises come
marked (`server/src/import/library/unilateral.json`); it is not set by the user, and what a device sends
for a library exercise is ignored. In a workout (`workoutItems`), a
timed one can be done as a plain set, without sides (`bySide: false`; `null`: side by side), and
`switchS` gives the seconds to change sides (`null`: 5 s); both are always sent. A
set performed (`setLogs`) has `unilateral: true` when it was done side by side.

## Media

| Route | Purpose |
| --- | --- |
| `POST /api/v1/media` | Body = the file, `Content-Type` = its type (`image/*` or `video/*`), 100 MB max. Returns `{ ids, urls }`. `?crop=x,y,w,h` (fractions from 0 to 1) keeps only that part of a photo, taken from the original. 415 if the type is not supported, 503 if ffmpeg is missing. |
| `POST /api/v1/media/from-url` `{ url, crop?, frameFirst? }` | The server downloads the picture, GIF or video of the link (http/https; 20 MB for a picture, 100 MB for a GIF or a video) and keeps it like an upload. Content announced as binary data is recognised by its first bytes. With `frameFirst: true`, a still photo is not kept: 422 `needs_framing` response, to frame it then send the link again with `crop`; an animated GIF or a video is kept right away. 400 if the link is invalid or targets a private address (also after a redirect), 413 if the file is too large, 415 if it is neither a picture nor a video, 502 if it cannot be found. |
| `GET /media/<sha256>.webp\|mp4` | The file, cached forever. Public so that `<img>` and `<video>` tags work; the names cannot be guessed. |
