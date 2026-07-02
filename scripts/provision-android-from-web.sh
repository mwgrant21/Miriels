#!/usr/bin/env bash
# Provision the Android TarotApp test device with the user's real WEB history.
# Dev/test only -- NOT part of the app, NOT committed-as-shipped. Re-runnable.
#
# What it does:
#   1. Snapshots the web memory.db (flatten WAL, set user_version=1 so Android's
#      SQLiteOpenHelper opens it without firing onCreate).
#   2. Pushes it to the device app-private databases/memory.db (binary-safe via
#      adb push -> run-as dd).
#   3. Mirrors readings/patterns/daily JSON for the given slug into filesDir/data.
#   4. Leaves the device's own readers.json untouched (so test readers don't appear).
#
# Usage: bash provision-android-from-web.sh [slug]   (default slug: matt)
set -euo pipefail
export MSYS_NO_PATHCONV=1

SLUG="${1:-matt}"
WEB="C:/Users/Matt/projects/tarot"
ADB="C:/Users/Matt/AppData/Local/Android/Sdk/platform-tools/adb.exe"
PKG="com.matt.tarot"
TMP="C:/Users/Matt/AppData/Local/Temp/claude/provision-android"
mkdir -p "$TMP"

echo "== 1. snapshot web memory.db (flatten WAL + user_version=1) =="
cp "$WEB/data/memory.db" "$TMP/memory.db"
[ -f "$WEB/data/memory.db-wal" ] && cp "$WEB/data/memory.db-wal" "$TMP/memory.db-wal" || true
[ -f "$WEB/data/memory.db-shm" ] && cp "$WEB/data/memory.db-shm" "$TMP/memory.db-shm" || true
node -e "
const D=require('$WEB/node_modules/better-sqlite3');
const db=new D('$TMP/memory.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('journal_mode = DELETE');   // collapse to a single self-contained file
db.pragma('user_version = 1');        // match Android SQLiteOpenHelper version
db.close();
console.log('  snapshot flattened, user_version=1');
"
rm -f "$TMP/memory.db-wal" "$TMP/memory.db-shm"

push_runas() {  # $1 = local file, $2 = device-relative path under the app home
  local local_file="$1" rel="$2"
  local dir="${rel%/*}"
  "$ADB" push "$local_file" /data/local/tmp/prov.tmp >/dev/null
  "$ADB" shell chmod 644 /data/local/tmp/prov.tmp
  # direct-exec run-as chdir's to the app home, so this relative mkdir lands correctly
  [ "$dir" != "$rel" ] && "$ADB" shell run-as "$PKG" mkdir -p "$dir" 2>/dev/null || true
  "$ADB" shell run-as "$PKG" dd if=/data/local/tmp/prov.tmp of="$rel" bs=64k >/dev/null 2>&1
  "$ADB" shell rm -f /data/local/tmp/prov.tmp
}

echo "== 2. stop app + push memory.db =="
"$ADB" shell am force-stop "$PKG"
push_runas "$TMP/memory.db" "databases/memory.db"
"$ADB" shell run-as "$PKG" rm -f databases/memory.db-wal databases/memory.db-shm databases/memory.db-journal

echo "== 3. mirror readings/patterns/daily for slug=$SLUG =="
for sub in readings patterns daily; do
  src="$WEB/data/$sub/$SLUG.json"
  if [ -f "$src" ]; then
    push_runas "$src" "files/data/$sub/$SLUG.json"
    echo "  pushed $sub/$SLUG.json"
  else
    echo "  (skip $sub/$SLUG.json -- not present in web)"
  fi
done

echo "== 4. verify =="
"$ADB" exec-out run-as "$PKG" cat databases/memory.db > "$TMP/verify.db"
node -e "
const D=require('$WEB/node_modules/better-sqlite3');
const db=new D('$TMP/verify.db',{readonly:true});
console.log('  on-device user_version =', db.pragma('user_version',{simple:true}));
for(const r of db.prepare(\"SELECT type,count(*) c FROM memories WHERE reader_slug='$SLUG' GROUP BY type ORDER BY c DESC\").all()) console.log('   ', r.type, r.c);
db.close();
"
echo "Provisioned device with web slug=$SLUG. (readers.json left untouched.)"
