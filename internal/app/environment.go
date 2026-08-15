package app

import (
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListEnvRuntimes 列出本机运行时状态。
func (s *Service) ListEnvRuntimes() ApiResult[[]model.RuntimeDO] {
	list := s.env.ListRuntimes()
	return OkResult(list)
}

// ListEnvVersions 列出某语言可切换版本。
func (s *Service) ListEnvVersions(lang string) ApiResult[[]model.RuntimeVersionDO] {
	list, err := s.env.ListVersions(lang)
	if err != nil {
		return ErrResult[[]model.RuntimeVersionDO](err)
	}
	if list == nil {
		list = []model.RuntimeVersionDO{}
	}
	return OkResult(list)
}

// UseEnvVersion 切换运行时版本。
func (s *Service) UseEnvVersion(lang, version string) ApiResult[bool] {
	if err := s.env.UseVersion(lang, version); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// InstallEnvManager 安装语言版本管理工具（nvm / goenv / brew / sdkman）。
func (s *Service) InstallEnvManager(lang string) ApiResult[bool] {
	if err := s.env.InstallManager(lang); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// InstallEnvVersion 安装运行时版本。
func (s *Service) InstallEnvVersion(lang, version string) ApiResult[bool] {
	if err := s.env.InstallVersion(lang, version); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// EnsureEnvVersion 安装（若缺失）并切换运行时版本。
func (s *Service) EnsureEnvVersion(lang, version string) ApiResult[bool] {
	if err := s.env.EnsureVersion(lang, version); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// UninstallEnvVersion 卸载运行时版本。
func (s *Service) UninstallEnvVersion(lang, version string) ApiResult[bool] {
	if err := s.env.UninstallVersion(lang, version); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListEnvPresets 列出环境预设。
func (s *Service) ListEnvPresets() ApiResult[[]model.EnvPresetDO] {
	list, err := s.store.ListEnvPresets()
	if err != nil {
		return ErrResult[[]model.EnvPresetDO](err)
	}
	if list == nil {
		list = []model.EnvPresetDO{}
	}
	return OkResult(list)
}

// SaveEnvPreset 保存环境预设。
func (s *Service) SaveEnvPreset(p model.EnvPresetDO) ApiResult[model.EnvPresetDO] {
	op := workbench.RadarOpUpdate
	if _, err := s.store.GetEnvPreset(p.ID); err != nil {
		op = workbench.RadarOpCreate
	}
	if err := s.store.SaveEnvPreset(p); err != nil {
		return ErrResult[model.EnvPresetDO](err)
	}
	out, err := s.store.GetEnvPreset(p.ID)
	if err != nil {
		return ErrResult[model.EnvPresetDO](err)
	}
	if s.radar != nil {
		s.radar.EmitEnvPreset(op, out.ID, "ui-env-preset-save", out.Name, false)
	}
	return OkResult(*out)
}

// DeleteEnvPreset 删除环境预设。
func (s *Service) DeleteEnvPreset(id string) ApiResult[bool] {
	if err := s.store.DeleteEnvPreset(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitEnvPreset(workbench.RadarOpDelete, id, "ui-env-preset-delete", "", false)
	}
	return OkResult(true)
}

// ApplyEnvPreset 应用环境预设。
func (s *Service) ApplyEnvPreset(id string) ApiResult[model.EnvApplyResultDO] {
	preset, err := s.store.GetEnvPreset(id)
	if err != nil {
		return ErrResult[model.EnvApplyResultDO](err)
	}
	preset.Active = true
	if err := s.store.SaveEnvPreset(*preset); err != nil {
		return ErrResult[model.EnvApplyResultDO](err)
	}
	if s.radar != nil {
		s.radar.EmitEnvPreset(workbench.RadarOpUpdate, preset.ID, "ui-env-preset-apply", preset.Name, false)
	}
	warnings := s.env.ApplyPreset(*preset)
	return OkResult(model.EnvApplyResultDO{Warnings: warnings})
}

// ScanEnvProjects 扫描项目目录的版本线索。
func (s *Service) ScanEnvProjects(root string) ApiResult[[]model.ProjectEnvHintDO] {
	if root == "" {
		var err error
		root, err = s.store.GetAppSetting(store.SettingEnvScanPath)
		if err != nil {
			return ErrResult[[]model.ProjectEnvHintDO](err)
		}
	}
	list, err := s.env.ScanProjects(root)
	if err != nil {
		return ErrResult[[]model.ProjectEnvHintDO](err)
	}
	if list == nil {
		list = []model.ProjectEnvHintDO{}
	}
	return OkResult(list)
}

// wireEnvEvents 注册环境安装日志事件。
func (s *Service) wireEnvEvents() {
	s.env.SetInstallLogHandler(func(lang, line string) {
		runtime.EventsEmit(s.ctx, "env:install-log", map[string]string{
			"lang": lang,
			"line": line,
		})
	})
}

// PickEnvScanDirectory 选择项目扫描目录。
func (s *Service) PickEnvScanDirectory() ApiResult[string] {
	path, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择项目扫描目录",
	})
	if err != nil {
		return ErrResult[string](err)
	}
	if path != "" {
		_ = s.store.SetAppSetting(store.SettingEnvScanPath, path)
	}
	return OkResult(path)
}

// GetEnvScanPath 获取上次扫描目录。
func (s *Service) GetEnvScanPath() ApiResult[string] {
	path, err := s.store.GetAppSetting(store.SettingEnvScanPath)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(path)
}
