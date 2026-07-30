#!/bin/sh
set -eu

exec node "$(dirname "$0")/scan-sensitive.mjs" "$@"
