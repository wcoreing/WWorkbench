# WNavicat 本地开发/构建（自动包含 $(go env GOPATH)/bin）
export PATH := $(shell go env GOPATH)/bin:$(PATH)

.PHONY: dev build install-wails

dev:
	wails dev

build:
	wails build

install-wails:
	go install github.com/wailsapp/wails/v2/cmd/wails@latest
