#!/usr/bin/env bash
# 校验 frontend/wailsjs 是否覆盖 Go 导出的 app.Service 方法（防手补漂移）。
# 用法：./scripts/check_wails_bindings.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_METHODS="$(mktemp)"
JS_METHODS="$(mktemp)"
trap 'rm -f "$GO_METHODS" "$JS_METHODS"' EXIT

# 导出方法：func (s *Service) Name( 且首字母大写
# 排除 Wails 生命周期（不上前端绑定）
extract_go() {
  if command -v rg >/dev/null 2>&1; then
    rg -oN --no-filename 'func \(s \*Service\) ([A-Z][A-Za-z0-9]+)\(' "$ROOT/internal/app"
  else
    grep -RhoE 'func \(s \*Service\) [A-Z][A-Za-z0-9]+\(' "$ROOT/internal/app" || true
  fi | sed -E 's/.*\) ([A-Z][A-Za-z0-9]+)\(.*/\1/' \
    | grep -Ev '^(Startup|Shutdown)$' | sort -u
}

extract_js() {
  if command -v rg >/dev/null 2>&1; then
    rg -oN --no-filename '^export function ([A-Z][A-Za-z0-9]+)\(' "$ROOT/frontend/wailsjs/go/app/Service.d.ts"
  else
    grep -E '^export function [A-Z][A-Za-z0-9]+\(' "$ROOT/frontend/wailsjs/go/app/Service.d.ts" || true
  fi | sed -E 's/^export function ([A-Z][A-Za-z0-9]+)\(.*/\1/' | sort -u
}

extract_go >"$GO_METHODS"
extract_js >"$JS_METHODS"

missing="$(comm -23 "$GO_METHODS" "$JS_METHODS" || true)"
extra="$(comm -13 "$GO_METHODS" "$JS_METHODS" || true)"

ok=1
if [[ -n "$missing" ]]; then
  echo "缺少前端绑定（请跑: wails generate module）:"
  echo "$missing" | sed 's/^/  - /'
  ok=0
fi
if [[ -n "$extra" ]]; then
  echo "前端多出绑定（可能已删 Go API，请重新 generate）:"
  echo "$extra" | sed 's/^/  - /'
  ok=0
fi
if [[ "$ok" -eq 1 ]]; then
  echo "wails bindings OK ($(wc -l <"$GO_METHODS" | tr -d ' ') methods)"
  exit 0
fi
exit 1
