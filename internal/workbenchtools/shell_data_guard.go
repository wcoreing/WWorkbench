package workbenchtools

import (
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"WWorkbench/internal/model"
)

// 数据文件三层防护文案（确认标题 / 硬风险，目录护照不可免）。
const (
	riskSyncDataFile      = "可能覆盖远端数据文件（*.db/data/.env）"
	riskSyncNoDataExclude = "同步未排除数据文件（将自动 exclude *.db/data/.env）"
	riskRecursiveSync     = "递归同步/复制（rsync/scp -r/cp -r）"
	riskDBClientImport    = "数据库客户端导入/还原"
)

// defaultDataBackupRoot 兼容旧常量名（统一走 defaultBackupRoot）。
const defaultDataBackupRoot = defaultBackupRoot

var (
	reRsync        = regexp.MustCompile(`(?i)(^|[\s;|&])rsync(\s|$)`)
	reScpWord      = regexp.MustCompile(`(?i)(^|[\s;|&])scp(\s|$)`)
	reScpRecursive = regexp.MustCompile(`(?i)\s-[a-zA-Z]*r[a-zA-Z]*(\s|$)`)
	reCpRecursive  = regexp.MustCompile(`(?i)(^|[\s;|&])cp\s+(-[^\s]*\s+)*-[^\s]*[rR]`)
	reDBClientIn   = regexp.MustCompile(`(?i)(\b(mysql|mariadb|psql|sqlite3)\b[^|&;\n]*<\s*|\b(pg_restore|mongorestore)\b)`)
	reRsyncExclude = regexp.MustCompile(`(?i)--exclude(=|\s+)['"]?(\*\.db|data/?|\.env)`)
	reRemoteDest   = regexp.MustCompile(`(?i)([a-z0-9_.-]+@)?([a-z0-9_.-]+):(/[^\s;|&]+)`)
)

// assessDataGuardRisk 数据文件 / 递归同步 / 库导入专项风险（优先于普通写文件）。
func assessDataGuardRisk(cmd string) (risky bool, reason string) {
	s := strings.TrimSpace(cmd)
	if s == "" {
		return false, ""
	}
	if reDBClientIn.MatchString(s) {
		return true, riskDBClientImport
	}
	if len(extractProtectedWriteTargets(s)) > 0 {
		return true, riskSyncDataFile
	}
	if isRecursiveSyncCmd(s) {
		if mentionsProtectedData(s) {
			return true, riskSyncDataFile
		}
		if isRsyncCmd(s) && !hasDataExcludes(s) {
			return true, riskSyncNoDataExclude
		}
		return true, riskRecursiveSync
	}
	return false, ""
}

// isHardShellRiskReason 目录护照不可免除的风险（含数据防护）。
func isHardShellRiskReason(reason string) bool {
	switch reason {
	case riskSyncDataFile, riskSyncNoDataExclude, riskRecursiveSync, riskDBClientImport:
		return true
	default:
		return false
	}
}

// shouldApplyDataGuardOnConfirm 确认通过后做 exclude 注入 + 写前备份。
func shouldApplyDataGuardOnConfirm(reason string) bool {
	return isHardShellRiskReason(reason) || strings.Contains(reason, "数据文件") || strings.Contains(reason, "数据库")
}

func isRsyncCmd(cmd string) bool {
	return reRsync.MatchString(cmd)
}

func isRecursiveSyncCmd(cmd string) bool {
	if isRsyncCmd(cmd) {
		return true
	}
	if reCpRecursive.MatchString(cmd) {
		return true
	}
	if reScpWord.MatchString(cmd) && reScpRecursive.MatchString(cmd) {
		return true
	}
	return false
}

func hasDataExcludes(cmd string) bool {
	return reRsyncExclude.MatchString(cmd)
}

func mentionsProtectedData(cmd string) bool {
	// 只看路径参数，忽略 --exclude='*.db' 等防护参数本身
	for _, p := range extractSyncPathArgs(cmd) {
		cand := p
		if m := reRemoteDest.FindStringSubmatch(p); len(m) > 3 {
			cand = m[3]
		}
		if isProtectedDataPath(cand) {
			return true
		}
		low := strings.ToLower(cand)
		if strings.Contains(low, "/data/") || strings.HasSuffix(low, "/data") {
			return true
		}
	}
	for _, p := range extractProtectedWriteTargets(cmd) {
		if p != "" {
			return true
		}
	}
	return false
}

// extractSyncPathArgs rsync/scp/cp 的非 option 路径参数（源+目标）。
func extractSyncPathArgs(cmd string) []string {
	fields := strings.Fields(cmd)
	var start int
	var found bool
	for i, f := range fields {
		low := strings.ToLower(f)
		if low == "rsync" || low == "scp" || low == "cp" {
			start = i + 1
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	var args []string
	skipNext := false
	for _, f := range fields[start:] {
		if skipNext {
			skipNext = false
			continue
		}
		if strings.HasPrefix(f, "-") {
			// --exclude=VALUE 或 --exclude VALUE
			low := strings.ToLower(f)
			if low == "--exclude" || low == "--include" || low == "--filter" {
				skipNext = true
			}
			continue
		}
		args = append(args, f)
	}
	return args
}

// isProtectedDataPath 绝对/相对路径是否为库文件、data 目录或 .env。
func isProtectedDataPath(p string) bool {
	p = strings.Trim(strings.TrimSpace(p), `"'`)
	if p == "" {
		return false
	}
	clean := path.Clean(p)
	base := path.Base(clean)
	low := strings.ToLower(clean)
	if strings.HasSuffix(low, ".db") {
		return true
	}
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return true
	}
	for _, seg := range strings.Split(low, "/") {
		if seg == "data" {
			return true
		}
	}
	return false
}

// extractProtectedWriteTargets 抽出命令中会动到的受保护路径（重定向 / rm / tee / 同步目标）。
func extractProtectedWriteTargets(cmd string) []string {
	var out []string
	add := func(p string) {
		p = strings.Trim(strings.TrimSpace(p), `"'`)
		if p == "" || !isProtectedDataPath(p) {
			return
		}
		out = append(out, p)
	}
	s := reFdRedirect.ReplaceAllString(strings.TrimSpace(cmd), " ")
	for _, m := range reRedirectTarget.FindAllStringSubmatch(s, -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}
	fields := strings.Fields(s)
	for i, f := range fields {
		low := strings.ToLower(strings.TrimSpace(f))
		if low == "rm" || low == "tee" {
			for _, a := range fields[i+1:] {
				if strings.HasPrefix(a, "-") {
					continue
				}
				add(a)
			}
		}
	}
	for _, p := range extractSyncDestPaths(s) {
		add(p)
		// user@host:/path/file.db
		if m := reRemoteDest.FindStringSubmatch(p); len(m) > 3 {
			add(m[3])
		}
	}
	return uniqueStrings(out)
}

// extractSyncDestPaths rsync/scp/cp 的目标参数（末尾路径）。
func extractSyncDestPaths(cmd string) []string {
	args := extractSyncPathArgs(cmd)
	if len(args) == 0 {
		return nil
	}
	return []string{args[len(args)-1]}
}

// extractSyncDestDirs 用于写前备份：绝对目录目标（含 remote 的 path 部分）。
func extractSyncDestDirs(cmd string) []string {
	var dirs []string
	for _, p := range extractSyncDestPaths(cmd) {
		p = strings.Trim(p, `"'`)
		if m := reRemoteDest.FindStringSubmatch(p); len(m) > 3 {
			p = m[3]
		}
		if !strings.HasPrefix(p, "/") {
			continue
		}
		clean := path.Clean(p)
		if strings.HasSuffix(strings.ToLower(clean), ".db") || path.Base(clean) == ".env" || strings.HasPrefix(path.Base(clean), ".env.") {
			dirs = append(dirs, path.Dir(clean))
			continue
		}
		dirs = append(dirs, clean)
	}
	return uniqueStrings(dirs)
}

// injectRsyncDataExcludes 给 rsync 自动加上数据文件排除（层 1：同步碰不到数据）。
func injectRsyncDataExcludes(cmd string) string {
	if !isRsyncCmd(cmd) || hasDataExcludes(cmd) {
		return cmd
	}
	ex := "--exclude='*.db' --exclude='data' --exclude='data/' --exclude='.env' --exclude='.env.*'"
	return reRsync.ReplaceAllStringFunc(cmd, func(m string) string {
		// 保留前导分隔符，在 rsync 后插入
		idx := strings.Index(strings.ToLower(m), "rsync")
		if idx < 0 {
			return m + " " + ex
		}
		return m[:idx+5] + " " + ex + m[idx+5:]
	})
}

// applyDataGuardOnConfirm 确认后：rsync 自动 exclude + 写前备份（优先命中备份策略 DestRoot）。
func applyDataGuardOnConfirm(d *Deps, hostKey, cmd string) (out string, notes []string) {
	out = strings.TrimSpace(cmd)
	if out == "" {
		return out, nil
	}
	_, reason := assessShellRisk(out)
	if !shouldApplyDataGuardOnConfirm(reason) {
		return out, nil
	}

	if isRsyncCmd(out) && !hasDataExcludes(out) {
		out = injectRsyncDataExcludes(out)
		notes = append(notes, "已自动附加 rsync --exclude *.db/data/.env")
	}

	targets := extractProtectedWriteTargets(cmd)
	dirs := extractSyncDestDirs(cmd)
	if len(targets) == 0 && len(dirs) == 0 && reason != riskSyncNoDataExclude && reason != riskRecursiveSync {
		if reason == riskDBClientImport {
			notes = append(notes, "导入类命令：请确认目标库；未能解析路径故未自动备份文件")
		}
		return out, notes
	}
	policies := matchFilePoliciesForHost(d, hostKey, targets, dirs)
	bakRoot := resolveBackupDestRoot(policies)
	out = prependDataBackup(out, targets, dirs, bakRoot)
	if len(policies) > 0 {
		names := make([]string, 0, len(policies))
		for _, p := range policies {
			names = append(names, p.Name)
			if d != nil && d.Store != nil {
				_, _ = d.Store.InsertBackupRun(model.BackupRunDO{
					PolicyID: p.ID, Trigger: "data_guard", Status: "injected",
					DestPath: bakRoot, Detail: "shell 确认后注入写前备份", Intent: "",
				})
			}
		}
		notes = append(notes, "执行前备份到 "+bakRoot+"/<时间戳>/（策略: "+strings.Join(names, ", ")+"）")
	} else {
		notes = append(notes, "执行前备份到 "+bakRoot+"/<时间戳>/（默认；建议 save_backup_policy）")
	}
	return out, notes
}

// prependDataBackup 在原命令前插入备份脚本（失败不阻断，cp 用 || true）。
func prependDataBackup(cmd string, files, dirs []string, bakRoot string) string {
	if strings.TrimSpace(bakRoot) == "" {
		bakRoot = defaultBackupRoot
	}
	stamp := time.Now().Format("20060102_150405")
	bak := fmt.Sprintf("%s/%s", strings.TrimRight(bakRoot, "/"), stamp)
	var b strings.Builder
	b.WriteString("WW_BAK='")
	b.WriteString(bak)
	b.WriteString("'; mkdir -p \"$WW_BAK\"")
	for _, f := range uniqueStrings(files) {
		if !strings.HasPrefix(f, "/") {
			continue
		}
		b.WriteString(" && { [ -e '")
		b.WriteString(shellSingleQuote(f))
		b.WriteString("' ] && cp -a '")
		b.WriteString(shellSingleQuote(f))
		b.WriteString("' \"$WW_BAK/\" || true; }")
	}
	for _, d := range uniqueStrings(dirs) {
		if !strings.HasPrefix(d, "/") {
			continue
		}
		b.WriteString(" && { [ -d '")
		b.WriteString(shellSingleQuote(d))
		b.WriteString("' ] && find '")
		b.WriteString(shellSingleQuote(d))
		b.WriteString(`' -maxdepth 4 \( -name '*.db' -o -name '.env' -o -name '.env.*' \) -print0 2>/dev/null | while IFS= read -r -d '' x; do cp -a "$x" "$WW_BAK/$(echo "$x" | tr / _)" 2>/dev/null || true; done || true; }`)
	}
	b.WriteString(" ; ")
	b.WriteString(cmd)
	return b.String()
}

func shellSingleQuote(s string) string {
	return strings.ReplaceAll(s, `'`, `'\''`)
}
