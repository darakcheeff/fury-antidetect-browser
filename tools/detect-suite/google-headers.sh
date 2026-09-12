#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors

# Does this browser send Chrome's Google-only request headers?
#
#   tools/detect-suite/google-headers.sh <browser-binary> [url]
#
# Real Chrome adds five headers to requests it makes to Google-owned hosts and
# to no one else: X-Client-Data (active field-trial ids, from the variations
# seed) and X-Browser-Validation / -Channel / -Year / -Copyright (Chrome-only
# code, not in Chromium). Nobody but Google can see them — they never reach a
# third-party origin — but www.google.com is where reCAPTCHA lives and
# fonts.gstatic.com is on a large share of the web, so "nobody but Google" is
# not a small audience.
#
# Measured 12.09.2026 on this Mac, Chrome 153.0.8010.36 vs the Fury core built
# from 153.0.8010.37, a page on github.io embedding reCAPTCHA:
#
#   Chrome: x-browser-validation on 12 requests to www.google.com and 6 to
#           fonts.gstatic.com; x-client-data on 15 and 6 (second launch — the
#           seed arrives on the first and applies on the next).
#   Fury:   none of the five, on any host.
#
# The headers are only visible in a net-log: they travel inside TLS and the
# relay sees a CONNECT tunnel. So this launches the browser with a throwaway
# profile and --log-net-log at IncludeSensitive, waits, kills it, and counts.
#
# The log contains cookies and every header of every request. It stays in
# $TMPDIR and is deleted on exit; pass KEEP=1 to keep it for a closer look, and
# do not commit one.
set -euo pipefail

BIN="${1:?browser binary}"
URL="${2:-https://patrickhlauke.github.io/recaptcha/}"
WAIT="${WAIT:-15}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/google-headers.XXXXXX")"
cleanup() { [ "${KEEP:-0}" = 1 ] && echo "kept: $WORK" || rm -rf "$WORK"; }
trap cleanup EXIT

"$BIN" --user-data-dir="$WORK/profile" --no-first-run --no-default-browser-check \
  --log-net-log="$WORK/netlog.json" --net-log-capture-mode=IncludeSensitive \
  --window-size=800,600 "$URL" >/dev/null 2>&1 &
PID=$!
sleep "$WAIT"
kill "$PID" 2>/dev/null || true
sleep 2

# A killed browser leaves the JSON unterminated, so this reads it as text: the
# header blocks are complete even when the closing brackets are not.
python3 - "$WORK/netlog.json" <<'PY'
import re, sys, collections
raw = open(sys.argv[1], errors="replace").read()
names = ("x-client-data", "x-browser-validation", "x-browser-channel",
         "x-browser-year", "x-browser-copyright")
seen = collections.Counter()
for block in re.findall(r'"headers":\[(.*?)\]', raw, re.S):
    host = re.search(r':authority: ([^"\\]*)', block)
    if not host:
        continue
    for n in names:
        if re.search(n, block, re.I):
            seen[(host.group(1), n)] += 1
if not seen:
    print("no Google-only headers on any host")
for (host, n), c in sorted(seen.items()):
    print(f"{host:40} {n:24} {c}")
PY
