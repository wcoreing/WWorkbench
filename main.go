package main

import (
	"embed"
	"log"

	"WNavicat/internal/adapter"
	mysqladapter "WNavicat/internal/adapter/mysql"
	"WNavicat/internal/app"
	"WNavicat/internal/conn"
	"WNavicat/internal/data"
	dockersvc "WNavicat/internal/docker"
	"WNavicat/internal/environment"
	"WNavicat/internal/meta"
	"WNavicat/internal/notebook"
	"WNavicat/internal/portforward"
	"WNavicat/internal/query"
	"WNavicat/internal/session"
	sftpsvc "WNavicat/internal/sftp"
	"WNavicat/internal/store"
	"WNavicat/internal/terminal"
	"WNavicat/internal/tunnel"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
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

	tp := tunnel.NewProvider()
	connSvc := conn.NewService(st, registry, tp)
	sshHostSvc := terminal.NewHostService(st)
	termMgr := terminal.NewManager(sshHostSvc)
	forwardMgr := portforward.NewManager(st, sshHostSvc)
	sftpMgr := sftpsvc.NewManager(sshHostSvc)
	sessMgr := session.NewManager(registry, st, tp)
	metaSvc := meta.NewService(sessMgr)
	querySvc := query.NewService(sessMgr, st)
	dataSvc := data.NewService(sessMgr)
	dockerMgr := dockersvc.NewManager(st)
	envMgr := environment.NewManager()
	notebookSvc := notebook.NewService(st)

	api := app.NewService(AppVersion, st, connSvc, sshHostSvc, termMgr, forwardMgr, sftpMgr, dockerMgr, envMgr, notebookSvc, sessMgr, metaSvc, querySvc, dataSvc)

	err = wails.Run(&options.App{
		Title:     "WNavicat",
		Width:     1400,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 30, G: 30, B: 30, A: 1},
		OnStartup:        api.Startup,
		OnShutdown:       api.Shutdown,
		Bind: []interface{}{
			api,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
