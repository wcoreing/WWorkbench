//go:build windows

package environment

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const (
	envBroadcastTimeoutMS = 5000
	hwndBroadcast         = 0xffff
	wmSettingChange       = 0x001A
	smtoAbortIfHung       = 0x0002
	wwbShellMarkerBegin   = "# >>> wworkbench-toolchain >>>"
	wwbShellMarkerEnd     = "# <<< wworkbench-toolchain <<<"
	wwbCmdMarker          = "wworkbench-toolchain"
)

// persistToolchainEnv 写入用户级环境变量、Shell 钩子并广播刷新。
func persistToolchainEnv(lang, homeOrRoot, bin string) error {
	_ = bin
	k, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()

	switch lang {
	case langGo:
		if err := k.SetStringValue("GOROOT", homeOrRoot); err != nil {
			return err
		}
	case langJava:
		if err := k.SetStringValue("JAVA_HOME", homeOrRoot); err != nil {
			return err
		}
	}

	pathVal, _, err := k.GetStringValue("Path")
	if err == registry.ErrNotExist {
		pathVal, _, err = k.GetStringValue("PATH")
	}
	if err != nil && err != registry.ErrNotExist {
		return err
	}
	parts := rebuildWorkbenchPathBins(splitPathList(pathVal))
	newPath := strings.Join(parts, string(filepath.ListSeparator))
	if err := k.SetExpandStringValue("Path", newPath); err != nil {
		return err
	}
	if err := writeWindowsShellHooks(); err != nil {
		return err
	}
	_ = enableCurrentUserPSRemoteSigned()
	broadcastEnvChange()
	return nil
}

// enableCurrentUserPSRemoteSigned 允许当前用户加载 PowerShell Profile。
func enableCurrentUserPSRemoteSigned() error {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		"Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force")
	return cmd.Run()
}

// writeWindowsShellHooks 写入 env.ps1 / env.cmd，并接入 PowerShell Profile 与 CMD AutoRun。
// Windows 合并 PATH 时 Machine 在 User 之前，系统 Go 会盖住用户 PATH，必须在 shell 启动后再前置。
func writeWindowsShellHooks() error {
	dir, err := workbenchEnvDir()
	if err != nil {
		return err
	}
	ps1 := filepath.Join(dir, "env.ps1")
	cmd := filepath.Join(dir, "env.cmd")
	if err := os.WriteFile(ps1, []byte(windowsEnvPS1()), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(cmd, []byte(windowsEnvCMD()), 0o644); err != nil {
		return err
	}
	if err := ensurePowerShellProfiles(ps1); err != nil {
		return err
	}
	return ensureCmdAutoRun(cmd)
}

// windowsEnvPS1 返回动态读取 current 并前置 PATH 的 PowerShell 脚本。
func windowsEnvPS1() string {
	return `# managed by WWorkbench — do not edit
$ErrorActionPreference = 'SilentlyContinue'
$wwb = Join-Path $HOME '.wworkbench\toolchains'
$goVer = (Get-Content (Join-Path $wwb 'go\current') -TotalCount 1 | ForEach-Object { $_.Trim() })
if ($goVer) {
  $goRoot = Join-Path $wwb "go\versions\$goVer"
  $goBin = Join-Path $goRoot 'bin'
  if (Test-Path (Join-Path $goBin 'go.exe')) {
    $env:GOROOT = $goRoot
    $env:Path = "$goBin;$env:Path"
  }
}
$javaVer = (Get-Content (Join-Path $wwb 'java\current') -TotalCount 1 | ForEach-Object { $_.Trim() })
if ($javaVer) {
  $javaHome = Join-Path $wwb "java\versions\$javaVer"
  $javaBin = Join-Path $javaHome 'bin'
  if (Test-Path (Join-Path $javaBin 'java.exe')) {
    $env:JAVA_HOME = $javaHome
    $env:Path = "$javaBin;$env:Path"
  }
}
$phpVer = (Get-Content (Join-Path $wwb 'php\current') -TotalCount 1 | ForEach-Object { $_.Trim() })
if ($phpVer) {
  $phpDir = Join-Path $wwb "php\versions\$phpVer"
  if (Test-Path (Join-Path $phpDir 'php.exe')) {
    $env:Path = "$phpDir;$env:Path"
  }
}
`
}

// windowsEnvCMD 返回 CMD 启动钩子。
func windowsEnvCMD() string {
	return `@echo off
REM managed by WWorkbench — do not edit
set "WWB_TC=%USERPROFILE%\.wworkbench\toolchains"
if exist "%WWB_TC%\go\current" (
  set /p WWB_GO=<"%WWB_TC%\go\current"
  if exist "%WWB_TC%\go\versions\%WWB_GO%\bin\go.exe" (
    set "GOROOT=%WWB_TC%\go\versions\%WWB_GO%"
    set "PATH=%GOROOT%\bin;%PATH%"
  )
)
if exist "%WWB_TC%\java\current" (
  set /p WWB_JAVA=<"%WWB_TC%\java\current"
  if exist "%WWB_TC%\java\versions\%WWB_JAVA%\bin\java.exe" (
    set "JAVA_HOME=%WWB_TC%\java\versions\%WWB_JAVA%"
    set "PATH=%JAVA_HOME%\bin;%PATH%"
  )
)
if exist "%WWB_TC%\php\current" (
  set /p WWB_PHP=<"%WWB_TC%\php\current"
  if exist "%WWB_TC%\php\versions\%WWB_PHP%\php.exe" (
    set "PATH=%WWB_TC%\php\versions\%WWB_PHP%;%PATH%"
  )
)
`
}

// ensurePowerShellProfiles 确保两套 Profile 加载 env.ps1。
func ensurePowerShellProfiles(envPS1 string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	profiles := []string{
		filepath.Join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
		filepath.Join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
	}
	snippet := wwbShellMarkerBegin + "\n" +
		`. '` + strings.ReplaceAll(envPS1, `'`, `''`) + `'` + "\n" +
		wwbShellMarkerEnd + "\n"
	for _, profile := range profiles {
		if err := upsertTextBlock(profile, wwbShellMarkerBegin, wwbShellMarkerEnd, snippet); err != nil {
			return err
		}
	}
	return nil
}

// ensureCmdAutoRun 设置 CMD 启动时调用 env.cmd。
func ensureCmdAutoRun(envCmd string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Command Processor`, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		var created bool
		k, created, err = registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Command Processor`, registry.SET_VALUE|registry.QUERY_VALUE)
		_ = created
		if err != nil {
			return err
		}
	}
	defer k.Close()
	call := `if exist "` + envCmd + `" call "` + envCmd + `"`
	existing, _, err := k.GetStringValue("AutoRun")
	if err != nil && err != registry.ErrNotExist {
		return err
	}
	if strings.Contains(existing, envCmd) {
		return nil
	}
	var next string
	if strings.TrimSpace(existing) == "" {
		next = call
	} else {
		next = call + " & " + existing
	}
	_ = wwbCmdMarker
	return k.SetStringValue("AutoRun", next)
}

// upsertTextBlock 在文件中写入/替换标记块。
func upsertTextBlock(path, begin, end, block string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	content := ""
	if err == nil {
		content = string(data)
	} else if !os.IsNotExist(err) {
		return err
	}
	if i := strings.Index(content, begin); i >= 0 {
		if j := strings.Index(content[i:], end); j >= 0 {
			j = i + j + len(end)
			for j < len(content) && (content[j] == '\n' || content[j] == '\r') {
				j++
			}
			content = content[:i] + block + content[j:]
		} else {
			content = content[:i] + block
		}
	} else {
		if content != "" && !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		content += block
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

// broadcastEnvChange 通知系统环境变量已更新。
func broadcastEnvChange() {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("SendMessageTimeoutW")
	env, _ := syscall.UTF16PtrFromString("Environment")
	var result uintptr
	_, _, _ = proc.Call(
		uintptr(hwndBroadcast),
		uintptr(wmSettingChange),
		0,
		uintptr(unsafe.Pointer(env)),
		uintptr(smtoAbortIfHung),
		uintptr(envBroadcastTimeoutMS),
		uintptr(unsafe.Pointer(&result)),
	)
}
