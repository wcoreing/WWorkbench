package workbenchtools

import (
	"context"
	"fmt"
	"path"
	"regexp"
	"strings"

	"WWorkbench/internal/model"
)

const backupCronMarkerPrefix = "# WWorkbench-backup:"

var cronFieldRe = regexp.MustCompile(`^[\d*/,\-]+$`)

// ValidateCronExpr 粗校验 5 段 cron（分 时 日 月 周）。
func ValidateCronExpr(expr string) string {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return ""
	}
	if strings.HasPrefix(expr, "@") {
		return "暂不支持 @reboot 等特殊表达式，请用五段 cron"
	}
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return "cron 须为 5 段（分 时 日 月 周），例如 0 3 * * *"
	}
	for _, f := range fields {
		if !cronFieldRe.MatchString(f) {
			return "cron 字段含非法字符（仅数字 * / , -）"
		}
	}
	return ""
}

func backupCronScriptPath(p model.BackupPolicyDO) string {
	root := strings.TrimSpace(p.DestRoot)
	if root == "" {
		root = defaultBackupRoot
	}
	return path.Clean(root) + "/.ww-cron/" + p.ID + ".sh"
}

func backupCronMarker(policyID string) string {
	return backupCronMarkerPrefix + strings.TrimSpace(policyID)
}

// buildBackupCronBody 生成可重复执行的备份脚本正文（时间戳在运行时计算）。
func buildBackupCronBody(d *Deps, p model.BackupPolicyDO) (body string, errMsg string) {
	root := strings.TrimSpace(p.DestRoot)
	if root == "" {
		root = defaultBackupRoot
	}
	idPart := backupPolicyIDPart(p.ID)
	var b strings.Builder
	b.WriteString("#!/bin/bash\nset -euo pipefail\n")
	b.WriteString("ROOT='")
	b.WriteString(shellSingleQuote(path.Clean(root)))
	b.WriteString("'\n")
	b.WriteString("STAMP=$(date +%Y%m%d_%H%M%S)\n")
	b.WriteString("WW_BAK=\"$ROOT/")
	b.WriteString(idPart)
	b.WriteString("_$STAMP\"\n")
	b.WriteString("mkdir -p \"$WW_BAK\"\n")
	switch p.Kind {
	case model.BackupKindFiles, model.BackupKindSQLite:
		src := path.Clean(p.Path)
		b.WriteString("SRC='")
		b.WriteString(shellSingleQuote(src))
		b.WriteString("'\n")
		b.WriteString(`if [ -f "$SRC" ]; then cp -a "$SRC" "$WW_BAK/"; `)
		b.WriteString(`elif [ -d "$SRC" ]; then find "$SRC" -maxdepth 4 \( -name '*.db' -o -name '.env' -o -name '.env.*' -o -type f \) -print0 | while IFS= read -r -d '' x; do cp -a "$x" "$WW_BAK/$(echo "$x" | tr / _)"; done; `)
		b.WriteString(`else echo "源不存在: $SRC" >&2; exit 1; fi` + "\n")
	case model.BackupKindDB:
		dump, err := buildDBDumpClauseVar(d, p)
		if err != "" {
			return "", err
		}
		b.WriteString(dump)
		b.WriteString("\n")
	default:
		return "", "未知 kind"
	}
	if prune := backupPruneClause(idPart, p.RetainDays, p.RetainCount); prune != "" {
		b.WriteString(prune)
		b.WriteString("\n")
	}
	b.WriteString(`echo BACKUP_OK "$WW_BAK"` + "\n")
	return b.String(), ""
}

// buildDBDumpClauseVar dump 目标目录用 $WW_BAK（cron 脚本用）。
func buildDBDumpClauseVar(d *Deps, p model.BackupPolicyDO) (string, string) {
	if d == nil || d.Conns == nil {
		return "", "数据库服务未就绪"
	}
	c, err := d.Conns.Get(p.ConnectionID)
	if err != nil {
		return "", err.Error()
	}
	dbType := strings.ToLower(strings.TrimSpace(c.DbType))
	dbName := strings.TrimSpace(c.Database)
	if dbName == "" {
		return "", "连接未指定 database"
	}
	host := strings.TrimSpace(c.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := c.Port
	user := strings.TrimSpace(c.User)
	pass := c.Password
	fileExpr := `"$WW_BAK/` + dbName + `.sql"`
	switch {
	case strings.Contains(dbType, "postgres") || dbType == "pg":
		if port <= 0 {
			port = 5432
		}
		return fmt.Sprintf(
			`export PGPASSWORD='%s'; pg_dump -h '%s' -p %d -U '%s' -d '%s' -F p -f %s`,
			shellSingleQuote(pass), shellSingleQuote(host), port, shellSingleQuote(user), shellSingleQuote(dbName), fileExpr,
		), ""
	default:
		if port <= 0 {
			port = 3306
		}
		return fmt.Sprintf(
			`export MYSQL_PWD='%s'; mysqldump -h '%s' -P %d -u '%s' --single-transaction --routines --triggers '%s' > %s`,
			shellSingleQuote(pass), shellSingleQuote(host), port, shellSingleQuote(user), shellSingleQuote(dbName), fileExpr,
		), ""
	}
}

// SyncBackupCron 按策略安装或卸载远端 crontab（需 sshHostId）。
func SyncBackupCron(ctx context.Context, d *Deps, p model.BackupPolicyDO) (note string, err error) {
	hostID := strings.TrimSpace(p.SSHHostID)
	if hostID == "" {
		if strings.TrimSpace(p.CronExpr) != "" {
			return "", fmt.Errorf("定时备份须指定 SSH 主机")
		}
		return "", nil
	}
	if d == nil || d.SSHHosts == nil {
		return "", fmt.Errorf("SSH 服务未就绪")
	}
	h, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return "", err
	}
	cron := strings.TrimSpace(p.CronExpr)
	if msg := ValidateCronExpr(cron); msg != "" {
		return "", fmt.Errorf("%s", msg)
	}
	wantInstall := p.Enabled && cron != ""
	scriptPath := backupCronScriptPath(p)
	marker := backupCronMarker(p.ID)

	if wantInstall {
		body, errMsg := buildBackupCronBody(d, p)
		if errMsg != "" {
			return "", fmt.Errorf("%s", errMsg)
		}
		writeCmd := fmt.Sprintf(
			`mkdir -p '%s' && cat > '%s' <<'WW_BACKUP_EOF'
%s
WW_BACKUP_EOF
chmod +x '%s'`,
			shellSingleQuote(path.Dir(scriptPath)),
			shellSingleQuote(scriptPath),
			body,
			shellSingleQuote(scriptPath),
		)
		if _, err := execSSHArgv(ctx, d, *h, []string{"bash", "-lc", writeCmd}, backupExecTimeoutSec); err != nil {
			return "", fmt.Errorf("写入备份脚本失败: %w", err)
		}
	}

	listOut, listErr := execSSHArgv(ctx, d, *h, []string{"bash", "-lc", "crontab -l 2>/dev/null || true"}, 30)
	lines := splitCronLines(listOut)
	filtered := make([]string, 0, len(lines))
	skipNext := false
	for _, line := range lines {
		if skipNext {
			skipNext = false
			continue
		}
		if strings.TrimSpace(line) == marker {
			skipNext = true // 下一行是旧任务
			continue
		}
		// 兼容标记与任务写在同一注释块后的单行残留
		if strings.Contains(line, marker) {
			continue
		}
		filtered = append(filtered, line)
	}
	if wantInstall {
		logPath := scriptPath + ".log"
		filtered = append(filtered,
			marker,
			fmt.Sprintf("%s /bin/bash %s >> %s 2>&1", cron, scriptPath, logPath),
		)
	}
	newCron := strings.Join(filtered, "\n")
	if newCron != "" && !strings.HasSuffix(newCron, "\n") {
		newCron += "\n"
	}
	installCmd := fmt.Sprintf("cat <<'WW_CRON_EOF' | crontab -\n%sWW_CRON_EOF", newCron)
	if _, err := execSSHArgv(ctx, d, *h, []string{"bash", "-lc", installCmd}, 30); err != nil {
		return "", fmt.Errorf("更新 crontab 失败: %w", err)
	}
	_ = listErr
	if wantInstall {
		return fmt.Sprintf("已安装到主机 crontab（%s）", cron), nil
	}
	return "已从主机 crontab 卸下定时", nil
}

// RemoveBackupCron 删除策略时卸 crontab（策略已从库删掉前调用）。
func RemoveBackupCron(ctx context.Context, d *Deps, p model.BackupPolicyDO) error {
	p.Enabled = false
	p.CronExpr = ""
	_, err := SyncBackupCron(ctx, d, p)
	return err
}

func splitCronLines(raw string) []string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.TrimSuffix(raw, "\n")
	if raw == "" {
		return nil
	}
	return strings.Split(raw, "\n")
}
