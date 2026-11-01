#!/usr/bin/env bash
# Upload prebuilt areas to Cloudflare R2: areas first (cached a week), the index last,
# so it never lists a file that is not there yet. Needs AWS_* and R2_ENDPOINT from the workflow.
set -e
D="$1"; test -f "$D/index.json" || exit 0
command -v aws >/dev/null || pip install --quiet awscli
EP="${R2_ENDPOINT%/}"; EP="${EP%/firstline-regions}"
aws s3 sync "$D" s3://firstline-regions/b2 --endpoint-url "$EP" --exclude index.json --size-only \
  --content-type application/octet-stream --cache-control "public, max-age=604800" --only-show-errors
aws s3 cp "$D/index.json" s3://firstline-regions/b2/index.json --endpoint-url "$EP" \
  --content-type application/json --cache-control "public, max-age=300" --only-show-errors
echo "R2: $(ls "$D"/*.bin 2>/dev/null | wc -l) Dateien abgeglichen"
