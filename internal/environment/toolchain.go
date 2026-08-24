package environment

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	managerWorkbench = "wworkbench"
	managerLabelWB   = "WWorkbench"
)

// toolchainRoot 返回 ~/.wworkbench/toolchains。
func toolchainRoot() (string, error) {
	dir, err := workbenchEnvDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dir, "toolchains")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	return root, nil
}

// toolchainLangDir 返回某语言版本根目录。
func toolchainLangDir(lang string) (string, error) {
	root, err := toolchainRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, lang, "versions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// toolchainCurrentPath 当前版本标记文件。
func toolchainCurrentPath(lang string) (string, error) {
	root, err := toolchainRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, lang)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "current"), nil
}

// readToolchainCurrent 读取当前激活版本 id。
func readToolchainCurrent(lang string) string {
	if !runnerIsLocal() {
		return strings.TrimSpace(runLoginShellOK(`cat "$HOME/.wworkbench/toolchains/` + lang + `/current" 2>/dev/null`))
	}
	path, err := toolchainCurrentPath(lang)
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// writeToolchainCurrent 写入当前激活版本 id。
func writeToolchainCurrent(lang, version string) error {
	version = strings.TrimSpace(version)
	if !runnerIsLocal() {
		_, err := runLoginShell(`mkdir -p "$HOME/.wworkbench/toolchains/` + lang + `" && printf '%s\n' ` + posixSingleQuote(version) + ` > "$HOME/.wworkbench/toolchains/` + lang + `/current"`)
		return err
	}
	path, err := toolchainCurrentPath(lang)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(version+"\n"), 0o644)
}

// toolchainVersionDir 返回已安装版本目录（本机绝对路径或远端 ExpandHome 路径）。
func toolchainVersionDir(lang, version string) (string, error) {
	version = strings.TrimSpace(version)
	if version == "" || strings.Contains(version, "/") || strings.Contains(version, "..") {
		return "", errInvalidVersion
	}
	if !runnerIsLocal() {
		return expandHome("~/.wworkbench/toolchains/" + lang + "/versions/" + version), nil
	}
	base, err := toolchainLangDir(lang)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, version), nil
}

// listInstalledToolchainIDs 列出已安装版本目录名。
func listInstalledToolchainIDs(lang string) []string {
	if !runnerIsLocal() {
		return linesNonEmpty(runLoginShellOK(`ls -1 "$HOME/.wworkbench/toolchains/` + lang + `/versions" 2>/dev/null`))
	}
	base, err := toolchainLangDir(lang)
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	var out []string
	for _, ent := range entries {
		if ent.IsDir() && !strings.HasPrefix(ent.Name(), ".") {
			out = append(out, ent.Name())
		}
	}
	return out
}

// goOSArch 返回 Go 下载用 os-arch。
func goOSArch() (string, string) {
	if !runnerIsLocal() {
		return remoteGoOSArch()
	}
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	if goarch == "arm" {
		goarch = "armv6l"
	}
	return goos, goarch
}

// remoteGoOSArch 经 Runner 探测远端 Go 下载用 os/arch。
func remoteGoOSArch() (string, string) {
	u := strings.ToLower(strings.TrimSpace(runLoginShellOK(`uname -s 2>/dev/null`)))
	m := strings.TrimSpace(runLoginShellOK(`uname -m 2>/dev/null`))
	goos := "linux"
	if strings.Contains(u, "darwin") {
		goos = "darwin"
	}
	goarch := "amd64"
	switch m {
	case "arm64", "aarch64":
		goarch = "arm64"
	case "i386", "i686":
		goarch = "386"
	case "armv6l", "armv7l":
		goarch = m
	}
	return goos, goarch
}

// javaOSArch 返回 Adoptium 用 os/arch（跟随当前 Runner 目标机）。
func javaOSArch() (string, string) {
	if isWindows() {
		goarch := runtime.GOARCH
		arch := goarch
		switch goarch {
		case "amd64":
			arch = "x64"
		case "386":
			arch = "x86"
		case "arm64":
			arch = "aarch64"
		}
		return "windows", arch
	}
	u := strings.ToLower(strings.TrimSpace(runLoginShellOK(`uname -s 2>/dev/null`)))
	m := strings.TrimSpace(runLoginShellOK(`uname -m 2>/dev/null`))
	osName := "linux"
	if strings.Contains(u, "darwin") {
		osName = "mac"
	}
	arch := "x64"
	switch m {
	case "arm64", "aarch64":
		arch = "aarch64"
	case "i386", "i686", "x86":
		arch = "x86"
	}
	return osName, arch
}

// downloadFile 下载到目标路径并回报进度。
func downloadFile(url, dest string, emit func(string)) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "WWorkbench")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("下载失败 HTTP %d: %s", resp.StatusCode, url)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	defer func() {
		_ = f.Close()
		_ = os.Remove(tmp)
	}()
	var written int64
	buf := make([]byte, 32*1024)
	lastEmit := time.Now()
	total := resp.ContentLength
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			written += int64(n)
			if emit != nil && time.Since(lastEmit) > time.Second {
				if total > 0 {
					emit("\r" + fmt.Sprintf("已下载 %.1f / %.1f MB", float64(written)/1e6, float64(total)/1e6))
				} else {
					emit("\r" + fmt.Sprintf("已下载 %.1f MB", float64(written)/1e6))
				}
				lastEmit = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	_ = os.Remove(dest)
	if err := os.Rename(tmp, dest); err != nil {
		return err
	}
	if emit != nil {
		emit(fmt.Sprintf("下载完成 %.1f MB", float64(written)/1e6))
	}
	return nil
}

// extractArchive 解压 zip 或 tar.gz 到 destDir（内容铺平到 destDir）。
func extractArchive(archivePath, destDir string, emit func(string)) error {
	_ = os.RemoveAll(destDir)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}
	lower := strings.ToLower(archivePath)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		if emit != nil {
			emit("正在解压 zip…")
		}
		return extractZipFlatten(archivePath, destDir)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		if emit != nil {
			emit("正在解压 tar.gz…")
		}
		return extractTarGzFlatten(archivePath, destDir)
	default:
		return fmt.Errorf("不支持的压缩格式: %s", archivePath)
	}
}

// extractZipFlatten 解压 zip；若顶层仅单目录则剥掉。
func extractZipFlatten(archivePath, destDir string) error {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer r.Close()
	prefix := commonZipPrefix(r.File)
	for _, f := range r.File {
		name := f.Name
		if prefix != "" {
			name = strings.TrimPrefix(name, prefix)
		}
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		target := filepath.Join(destDir, filepath.FromSlash(name))
		if !strings.HasPrefix(target, destDir+string(os.PathSeparator)) && target != destDir {
			return fmt.Errorf("非法压缩路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			_ = rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		_ = out.Close()
		_ = rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

// commonZipPrefix 若所有条目共享同一顶层目录则返回该前缀。
func commonZipPrefix(files []*zip.File) string {
	var prefix string
	for _, f := range files {
		name := strings.TrimPrefix(f.Name, "/")
		if name == "" {
			continue
		}
		parts := strings.SplitN(name, "/", 2)
		if len(parts) == 0 || parts[0] == "" {
			return ""
		}
		top := parts[0] + "/"
		if prefix == "" {
			prefix = top
			continue
		}
		if prefix != top {
			return ""
		}
	}
	return prefix
}

// extractTarGzFlatten 解压 tar.gz；剥掉单一顶层目录。
func extractTarGzFlatten(archivePath, destDir string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var prefix string
	prefixResolved := false
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(hdr.Name, "./")
		if !prefixResolved {
			parts := strings.SplitN(name, "/", 2)
			if len(parts) > 0 && parts[0] != "" {
				prefix = parts[0] + "/"
			}
			prefixResolved = true
		}
		if prefix != "" && strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
		}
		if name == "" {
			continue
		}
		target := filepath.Join(destDir, filepath.FromSlash(name))
		if !strings.HasPrefix(target, destDir+string(os.PathSeparator)) && target != destDir {
			return fmt.Errorf("非法压缩路径: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(out, tr)
			_ = out.Close()
			if copyErr != nil {
				return copyErr
			}
		}
	}
	return nil
}

// httpGetOK 简易 GET，失败返回空。
func httpGetOK(url string) ([]byte, error) {
	client := &http.Client{Timeout: 90 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WWorkbench")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 16<<20))
}
