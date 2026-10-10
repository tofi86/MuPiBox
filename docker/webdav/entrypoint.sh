#!/bin/sh
# Entrypoint of the dev WebDAV container: on the first start (no or an empty /data/photos) a tree of sample
# pictures is generated with ImageMagick, then httpd runs in the foreground. /data is the named volume of
# docker-compose.yml, so the pictures survive restarts; npm run webdav:reset drops them.
#
# The tree mirrors what a family NAS looks like to the box's photo feature: a root folder with albums (subfolders),
# loose pictures beside them, an empty folder, Synology's @eaDir and macOS' ._ files (both have to be skipped),
# a sideways JPEG with EXIF Orientation 6 and, when ImageMagick can write it, an iPhone-style HEIC.
set -eu

DATA=/data
PHOTOS=$DATA/photos
# The TTF itself instead of the family name: ImageMagick's font lookup on Alpine depends on fontconfig's cache.
FONT=/usr/share/fonts/dejavu/DejaVuSans.ttf
[ -f "$FONT" ] || FONT=DejaVu-Sans

# picture <file> <WxH> <colour> <text> [more magick arguments]
# A solid canvas with a white label in the middle, so every picture is told apart at a glance. 8 bit like a
# phone's pictures (ImageMagick's canvas is 16 bit and would give 16-bit PNGs and 12-bit HEICs).
picture() {
  file=$1 size=$2 colour=$3 text=$4
  shift 4
  magick -size "$size" "xc:$colour" -gravity center -font "$FONT" -pointsize 140 -fill white \
    -annotate 0 "$text" -depth 8 "$@" "$file"
}

COLOURS='#c0392b #27ae60 #2980b9 #8e44ad #d35400 #16a085 #2c3e50 #f39c12 #e84393 #0984e3 #6c5ce7 #7f8c8d'
colour() { echo "$COLOURS" | cut -d' ' -f "$1"; }

generate() {
  tmp=$DATA/.photos.tmp
  rm -rf "$tmp"
  root="$tmp/Familie 2026"
  mkdir -p "$root/Zoo" "$root/Oma 70" "$root/Leer" "$root/@eaDir"

  echo "webdav: generating sample pictures in $PHOTOS ..."

  for i in $(seq 1 12); do
    picture "$root/Zoo/$(printf 'IMG_%04d.jpg' "$i")" 1600x1200 "$(colour "$i")" "Zoo $i"
  done

  # A portrait HEIC the way an iPhone saves it; needs ImageMagick's HEIC coder with an encoder (libheif-x265).
  if magick -list format | grep -qi 'HEIC.*rw'; then
    if picture "$root/Zoo/IMG_0003.heic" 1200x1600 "$(colour 3)" 'Zoo 3 HEIC' 2>/dev/null; then
      echo "webdav: HEIC written"
    else
      rm -f "$root/Zoo/IMG_0003.heic"
      echo "webdav: HEIC skipped, ImageMagick cannot encode it"
    fi
  else
    echo "webdav: HEIC skipped, no HEIC coder in ImageMagick"
  fi

  for i in $(seq 1 6); do
    picture "$root/Oma 70/$(printf 'IMG_%04d.jpg' "$((100 + i))")" 1600x1200 "$(colour "$((i + 2))")" "Oma 70 $i"
  done
  # IMG_0102: a portrait picture stored on its side, as cameras do. The upright 1200x1600 picture is rotated
  # 90 degrees counter-clockwise into a 1600x1200 file and tagged Orientation 6 ("Rotate 90 CW"): a viewer that
  # honours EXIF turns it back and the label reads normally, one that does not shows the label lying on its side.
  picture "$root/Oma 70/IMG_0102.jpg" 1200x1600 "$(colour 4)" 'Oma 70 2' -rotate -90
  exiftool -q -n -Orientation=6 -overwrite_original "$root/Oma 70/IMG_0102.jpg"

  # Pictures lying directly in the root: they become the album named after the root.
  picture "$root/IMG_loose_1.jpg" 1600x1200 "$(colour 9)" 'Lose 1'
  picture "$root/IMG_loose_2.png" 1600x1200 "$(colour 10)" 'Lose 2 PNG'
  picture "$root/IMG_loose_3.webp" 1600x1200 "$(colour 11)" 'Lose 3 WebP'

  # Junk the box has to skip: Synology's thumbnail folder, an AppleDouble file, a text file between the pictures.
  printf 'not a picture, Synology @eaDir junk\n' > "$root/@eaDir/SYNO_DUMMY.jpg"
  printf 'not a picture, macOS AppleDouble junk\n' > "$root/Zoo/._IMG_0001.jpg"
  printf 'Zoo, Sommer 2026\n' > "$root/Zoo/notes.txt"

  mv "$tmp" "$PHOTOS"
  echo "webdav: done"
}

if [ ! -d "$PHOTOS" ] || [ -z "$(ls -A "$PHOTOS")" ]; then
  rm -rf "$PHOTOS"
  generate
fi

# A placeholder for the music side of the NAS pages (the box lists it, nothing plays it).
if [ ! -d "$DATA/Musik" ]; then
  mkdir -p "$DATA/Musik/Test"
  printf 'placeholder, not an mp3\n' > "$DATA/Musik/Test/track.mp3"
fi

# httpd runs as www-data and must read everything; write access lets cover uploads be tried against this NAS.
chown -R www-data:www-data "$DATA"

exec httpd-foreground "$@"
