#!/usr/bin/env bash
# 将生图切图结果同步到正式图标目录（唯一运行时资源）。
# 用法:
#   ./frontend/scripts/sync-icons.sh
#   ./frontend/scripts/sync-icons.sh /path/to/cut-icons-dir
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:-$ROOT/frontend/design-draft/icons}"
DST="$ROOT/frontend/src/assets/icons"

if [[ ! -d "$SRC" ]]; then
  echo "source not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DST"
# 只同步主图，跳过 @64 与校验临时文件
copied=0
for f in "$SRC"/*.png; do
  base="$(basename "$f")"
  [[ "$base" == _* ]] && continue
  [[ "$base" == *"@"* ]] && continue
  cp "$f" "$DST/$base"
  copied=$((copied + 1))
done

echo "synced $copied icons → $DST"
ls "$DST" | wc -l | xargs echo "assets/icons count:"
