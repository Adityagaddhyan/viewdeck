#!/usr/bin/env bash
# Starts a throwaway, TLS-enabled Postgres for PostgresDriver integration tests.
#
# Why TLS with a fake hostname: the server cert is issued for DNS:db.viewdeck.test
# while tests connect to 127.0.0.1. That reproduces the SSM-tunnel situation and
# proves `ssl.servername` + `ssl.ca` give working verify-full TLS.
#
# Usage:  scripts/start-test-postgres.sh                 print export lines
#         scripts/start-test-postgres.sh <cmd> [args...]  start, then run cmd with the env set
#         (npm run test:integration does the latter). Port: $VIEWDECK_PG_TEST_PORT or 55432.
# Stop:   pg_ctl -D .pgtest/data stop
#
# Needs Postgres server binaries (e.g. `brew install postgresql@18`).
# Data lives in ./.pgtest (gitignored).
set -euo pipefail

# macOS: postgres aborts with "postmaster became multithreaded during startup" when the
# inherited locale is unset or invalid (common when launched from GUI apps). Pin a valid one.
export LC_ALL=C

PORT="${VIEWDECK_PG_TEST_PORT:-55432}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/.pgtest"
PASSWORD="viewdeck-test"

BIN=""
for d in /opt/homebrew/opt/postgresql@18/bin /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@18/bin /usr/lib/postgresql/*/bin; do
  if [ -x "$d/postgres" ]; then BIN="$d"; break; fi
done
if [ -z "$BIN" ]; then
  BIN="$(dirname "$(command -v postgres || true)")"
fi
[ -x "$BIN/postgres" ] || { echo "Postgres server binaries not found (brew install postgresql@18)" >&2; exit 1; }

mkdir -p "$ROOT/tls"
cd "$ROOT/tls"
if [ ! -f server.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=ViewDeck Test CA" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=db.viewdeck.test" >/dev/null 2>&1
  printf "subjectAltName=DNS:db.viewdeck.test\n" > san.ext
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 3650 -extfile san.ext >/dev/null 2>&1
  chmod 600 server.key
fi

# A half-initialised cluster (an earlier run that failed mid-way) is rebuilt.
if [ ! -f "$ROOT/.configured" ] && [ -d "$ROOT/data" ]; then
  "$BIN/pg_ctl" -D "$ROOT/data" stop >/dev/null 2>&1 || true
  rm -r -- "$ROOT/data"
fi
if [ ! -d "$ROOT/data" ]; then
  "$BIN/initdb" -D "$ROOT/data" -U postgres --auth=trust >/dev/null
fi

if ! "$BIN/pg_ctl" -D "$ROOT/data" status >/dev/null 2>&1; then
  # unix_socket_directories='' : long temp paths exceed the 103-byte socket limit on macOS.
  "$BIN/pg_ctl" -D "$ROOT/data" -l "$ROOT/pg.log" -w start -o \
    "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=$ROOT/tls/server.crt -c ssl_key_file=$ROOT/tls/server.key" >/dev/null
fi

if [ ! -f "$ROOT/.configured" ]; then
  "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -qc "ALTER ROLE postgres PASSWORD '$PASSWORD'"
  # Require SCRAM so tests exercise the password callback.
  sed -i.bak -E 's/^(host.*)trust$/\1scram-sha-256/' "$ROOT/data/pg_hba.conf"
  "$BIN/pg_ctl" -D "$ROOT/data" reload >/dev/null
  touch "$ROOT/.configured"
fi

export VIEWDECK_PG_TEST_PORT="$PORT"
export VIEWDECK_PG_TEST_PASSWORD="$PASSWORD"
export VIEWDECK_PG_TEST_CA="$ROOT/tls/ca.crt"
if [ "$#" -gt 0 ]; then
  cd "$ROOT/.."
  exec "$@"
fi
echo "export VIEWDECK_PG_TEST_PORT=$PORT"
echo "export VIEWDECK_PG_TEST_PASSWORD=$PASSWORD"
echo "export VIEWDECK_PG_TEST_CA=$ROOT/tls/ca.crt"
