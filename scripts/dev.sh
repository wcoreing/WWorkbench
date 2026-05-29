#!/usr/bin/env bash
# 将 go install 的工具加入 PATH 后启动 Wails 开发模式
set -e
export PATH="$(go env GOPATH)/bin:${PATH}"
cd "$(dirname "$0")/.."
exec wails dev "$@"
