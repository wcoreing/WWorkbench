package main

import (
	"context"
	"embed"
	"log"

	"WWorkbench/internal/adapter"
	mysqladapter "WWorkbench/internal/adapter/mysql"
	pgadapter "WWorkbench/internal/adapter/postgresql"
	sqliteadapter "WWorkbench/internal/adapter/sqlite"
	"WWorkbench/internal/app"
	"WWorkbench/internal/conn"
	"WWorkbench/internal/data"
	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/environment"
	"WWorkbench/internal/meta"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/portforward"
	"WWorkbench/internal/query"
	"WWorkbench/internal/session"
	sftpsvc "WWorkbench/internal/sftp"
	"WWorkbench/internal/store"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	dataDir, err := store.DataDir()
	if err != nil {
		log.Fatal(err)
	}
	st, err := store.New(dataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	if err := tunnel.InitKnownHosts(dataDir); err != nil {
		log.Fatal(err)
	}

	registry := adapter.NewRegistry()
	mysqladapter.Register(registry)
	pgadapter.Register(registry)
	sqliteadapter.Register(registry)

	tp := tunnel.NewProvider()
	connSvc := conn.NewService(st, registry, tp)
	sshHostSvc := terminal.NewHostService(st)
	termMgr := terminal.NewManager(sshHostSvc)
	forwardMgr := portforward.NewManager(st, sshHostSvc)
	dockerMgr := dockersvc.NewManager(st)
	sftpMgr := sftpsvc.NewManager(sshHostSvc, dockerMgr)
	sessMgr := session.NewManager(registry, st, tp)
	metaSvc := meta.NewService(sessMgr)
	querySvc := query.NewService(sessMgr, st)
	dataSvc := data.NewService(sessMgr)
	envMgr := environment.NewManager(sshHostSvc)
	notebookSvc := notebook.NewService(st)

	api := app.NewService(AppVersion, st, connSvc, sshHostSvc, termMgr, forwardMgr, sftpMgr, dockerMgr, envMgr, notebookSvc, sessMgr, metaSvc, querySvc, dataSvc)

	err = wails.Run(&options.App{
		Title:     "WWorkbench",
		Width:     1400,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		Mac: &mac.Options{
			// 只要透明 WebView；不要 WindowIsTranslucent（会铺暗色 vibrancy，看起来像死黑）
			WebviewIsTransparent: true,
			WindowIsTranslucent:  false,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
		OnStartup: api.Startup,
		OnDomReady: func(ctx context.Context) {
			makeWindowTransparent()
		},
		OnShutdown: api.Shutdown,
		Bind: []interface{}{
			api,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
