# The dev WebDAV "NAS": Apache httpd with mod_dav, Basic auth and generated sample pictures (entrypoint.sh).
# Run it with npm run webdav:start (docker compose), see README.md.
FROM httpd:2.4-alpine

# ImageMagick with the JPEG, WebP and HEIC coders for the sample pictures, DejaVu as the font of their labels and
# exiftool for the EXIF orientation of the sideways test picture. PNG comes with the base imagemagick package.
# Alpine's libheif brings decoders only; the x265 plugin is the HEVC encoder, without it ImageMagick lists HEIC as
# read-only and the entrypoint skips the HEIC sample.
RUN apk add --no-cache imagemagick imagemagick-jpeg imagemagick-webp imagemagick-heic libheif-x265 font-dejavu exiftool

# mod_dav and mod_dav_fs ship commented out (the Basic auth modules are already on). The DAV setup lives in its own
# file, the lock database needs a directory writable by the httpd user (www-data in this image, not daemon).
RUN sed -i \
      -e 's/^#\(LoadModule dav_module \)/\1/' \
      -e 's/^#\(LoadModule dav_fs_module \)/\1/' \
      conf/httpd.conf \
    && printf '\nInclude conf/mupibox-dav.conf\n' >> conf/httpd.conf \
    && htpasswd -cb conf/htpasswd mupibox mupibox \
    && mkdir -p /var/lib/dav /data \
    && chown www-data:www-data /var/lib/dav /data

COPY mupibox-dav.conf conf/mupibox-dav.conf
COPY --chmod=755 entrypoint.sh /entrypoint.sh

RUN httpd -t

VOLUME /data
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
