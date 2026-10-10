# Dev WebDAV "NAS"

A small WebDAV server for developing the NAS and photo features without a real NAS: Apache httpd (`httpd:2.4-alpine`)
with `mod_dav`, Basic auth and a generated tree of sample pictures. Nothing in here ends up on a box.

```bash
npm run webdav:start   # build the image and start the container (mupibox-webdav, http://localhost:8081)
npm run webdav:stop    # stop it, the generated data stays in the named volume
npm run webdav:reset   # stop it and drop the volume; the next start generates the sample data again
```

The sample pictures are generated on the first start (about ten seconds); `docker logs mupibox-webdav` shows
when httpd is up. `docker compose` reports the container as healthy once it answers.

## Using it

- Credentials: user `mupibox`, password `mupibox`.
- From a backend running on the Mac (`npm run serve:backend-api`): NAS address `localhost:8081`, http, no path.
- From the production-like container (`npm run docker:start`): NAS address `webdav`, port 80, http. Both
  containers are on the Docker network `mupibox-dev`, which either script creates when it is missing.
- Pick `/photos/Familie 2026` as a photo folder in the app; `/Musik` is a placeholder for the music side.

A quick check by hand:

```bash
curl -u mupibox:mupibox -X PROPFIND -H 'Depth: 1' http://localhost:8081/
```

## The generated tree

```
/data
├── Musik/Test/track.mp3                     placeholder, not a real mp3
└── photos/Familie 2026/
    ├── Zoo/IMG_0001.jpg … IMG_0012.jpg      12 landscape JPEGs, "Zoo 1" … "Zoo 12"
    ├── Zoo/IMG_0003.heic                    portrait HEIC (see below)
    ├── Zoo/._IMG_0001.jpg, Zoo/notes.txt    junk the box has to skip
    ├── Oma 70/IMG_0101.jpg … IMG_0106.jpg   6 JPEGs; IMG_0102.jpg is a portrait picture stored sideways
    │                                        with EXIF Orientation 6, upright only when EXIF is honoured
    ├── IMG_loose_1.jpg, IMG_loose_2.png, IMG_loose_3.webp   loose pictures: the album named after the root
    ├── Leer/                                empty folder, must not become an album
    └── @eaDir/SYNO_DUMMY.jpg                Synology thumbnail folder, must be skipped
```

Every picture is a solid colour with its name as a white label, so a wrong picture or a wrong rotation is obvious
on the display.

## Your own pictures

Copy folders into the volume, then reload the NAS page in the app (the box caches a folder listing for a minute):

```bash
docker cp ~/Pictures/Urlaub mupibox-webdav:/data/photos/
docker exec mupibox-webdav chown -R www-data:www-data /data
```

Or bind-mount a folder of your own instead of the named volume: replace `webdav-data:/data` in
`docker-compose.yml` with for example `~/Pictures/nas:/data`. The sample data is only generated when
`/data/photos` is missing or empty, so an own tree is left alone.

## HEIC

`IMG_0003.heic` is written by ImageMagick and needs the HEIC coder plus an HEVC encoder (`imagemagick-heic` and
`libheif-x265` on Alpine). If an Alpine release drops the encoder, the entrypoint logs "HEIC skipped" and
generates everything else.
