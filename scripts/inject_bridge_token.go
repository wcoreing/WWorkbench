//go:build ignore

package main

import (
	"fmt"
	"path/filepath"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/store"
)

func main() {
	dataDir, err := store.DataDir()
	if err != nil {
		panic(err)
	}
	st, err := store.New(dataDir)
	if err != nil {
		panic(err)
	}
	defer st.Close()
	tok, err := st.BrowserBridgeToken()
	if err != nil {
		panic(err)
	}
	extDir := filepath.Join(dataDir, "browser-ext")
	if err := browser.InjectBridgeToken(extDir, tok); err != nil {
		panic(err)
	}
	fmt.Printf("ok ext=%s token_len=%d\n", extDir, len(tok))
}
