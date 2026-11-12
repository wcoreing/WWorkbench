# WWorkbench 本地开发/构建（自动包含 $(go env GOPATH)/bin）
export PATH := $(shell go env GOPATH)/bin:$(PATH)

.PHONY: dev build install-wails check-bindings

dev:
	wails dev

build:
	wails build

install-wails:
	go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 改 Go 导出 API 后：wails generate module，再用本目标防手补漂移
check-bindings:
	@bash scripts/check_wails_bindings.sh
