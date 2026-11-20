#!/usr/bin/env bash
# 将 go install 的工具加入 PATH 后启动 Wails 开发模式
# debounce：合并短时间内的多文件改动，避免连改 version/bindings 触发二次完整重启
set -e
export PATH="$(go env GOPATH)/bin:${PATH}"
cd "$(dirname "$0")/.."
if [[ "$*" != *"-debounce"* ]]; then
  set -- -debounce 800 "$@"
fi
exec wails dev "$@"
