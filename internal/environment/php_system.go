package environment

import (
	"regexp"
	"strings"

	"WWorkbench/internal/model"
)

var phpCLIVersionRe = regexp.MustCompile(`PHP ([0-9]+\.[0-9]+\.[0-9]+)`)

// phpBinaryVersion 读取 PHP 可执行文件版本（-r 失败时回退 php -v）。
func phpBinaryVersion(bin string) string {
	bin = strings.TrimSpace(bin)
	if bin == "" {
		return ""
	}
	q := posixSingleQuote(bin)
	ver := strings.TrimSpace(runLoginShellOK(q + ` -r 'echo PHP_VERSION;'`))
	if ver != "" {
		return ver
	}
	return parsePHPCLIVersion(runLoginShellOK(q + ` -v 2>&1 | head -1`))
}

// parsePHPCLIVersion 从 php -v 首行解析版本号。
func parsePHPCLIVersion(line string) string {
	if m := phpCLIVersionRe.FindStringSubmatch(line); len(m) > 1 {
		return m[1]
	}
	return ""
}

// probePHPBinary 经登录 shell 探测当前默认 PHP（PATH + 常见路径）。
func probePHPBinary() (bin, version string) {
	raw := runLoginShellOK(`
set +e
bin=""
for p in $(command -v php 2>/dev/null) /usr/bin/php /usr/local/bin/php; do
  [ -n "$p" ] && [ -x "$p" ] && bin="$p" && break
done
[ -z "$bin" ] && exit 0
ver=$("$bin" -r 'echo PHP_VERSION;' 2>/dev/null)
if [ -z "$ver" ]; then
  ver=$("$bin" -v 2>&1 | head -1 | sed -n 's/.*PHP \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
fi
printf '%s\n%s\n' "$bin" "$ver"
`)
	lines := linesNonEmpty(raw)
	if len(lines) == 0 {
		return "", ""
	}
	bin = lines[0]
	if len(lines) > 1 {
		version = lines[1]
	}
	return bin, version
}

// collectSystemPHPVersions 枚举 Linux/macOS 系统已装 PHP（update-alternatives / usr/bin/php*）。
func collectSystemPHPVersions() []model.RuntimeVersionDO {
	activeBin, activeVer := probePHPBinary()
	raw := runLoginShellOK(`
set +e
declare -A seen
add() {
  local p="$1"
  [ -z "$p" ] || [ ! -x "$p" ] && return
  local v
  v=$("$p" -r 'echo PHP_VERSION;' 2>/dev/null)
  if [ -z "$v" ]; then
    v=$("$p" -v 2>&1 | head -1 | sed -n 's/.*PHP \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
  fi
  [ -z "$v" ] && return
  local k="$v|$p"
  [ -n "${seen[$k]}" ] && return
  seen[$k]=1
  echo "$v|$p"
}
if command -v update-alternatives >/dev/null 2>&1; then
  for p in $(update-alternatives --list php 2>/dev/null); do add "$p"; done
fi
for p in /usr/bin/php /usr/local/bin/php /usr/bin/php[0-9]* /usr/bin/php[0-9].[0-9]; do
  [ -e "$p" ] || continue
  add "$p"
done
add "$(command -v php 2>/dev/null)"
`)
	seen := map[string]bool{}
	var out []model.RuntimeVersionDO
	for _, line := range linesNonEmpty(raw) {
		parts := strings.SplitN(line, "|", 2)
		if len(parts) != 2 {
			continue
		}
		ver := strings.TrimSpace(parts[0])
		bin := strings.TrimSpace(parts[1])
		if ver == "" || bin == "" || seen[bin] {
			continue
		}
		seen[bin] = true
		active := (activeBin != "" && bin == activeBin) ||
			(activeVer != "" && (ver == activeVer || strings.HasPrefix(activeVer, ver+".")))
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     "system",
			Formula:   bin,
			Installed: true,
			Active:    active,
		})
	}
	if len(out) == 0 && activeVer != "" {
		out = append(out, model.RuntimeVersionDO{
			Version:   activeVer,
			Label:     "system",
			Formula:   activeBin,
			Installed: true,
			Active:    true,
		})
	}
	sortPHPVersions(out)
	return out
}
