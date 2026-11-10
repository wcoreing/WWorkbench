package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

const (
	defaultBackupRoot      = "/www/backup/wworkbench"
	backupFreshWithinSec   = int64(3600) // 写前认可的「新鲜」备份窗口
	backupExecTimeoutSec   = 180
)

type saveBackupPolicyArgs struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	SSHHostID    string `json:"sshHostId"`
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
	DestRoot     string `json:"destRoot"`
	BeforeWrite  *bool  `json:"beforeWrite"`
	RetainDays   *int   `json:"retainDays"`  // >0 按天保留（优先）；nil 且无 retainCount 时默认 7 天
	RetainCount  *int   `json:"retainCount"` // 持续保留配额；与 retainDays 互斥
	CronExpr     string `json:"cronExpr"`
	Enabled      *bool  `json:"enabled"`
}

type runBackupArgs struct {
	PolicyID string `json:"policyId"`
	Intent   string `json:"intent"`
	Force    bool   `json:"force"` // true=跳过新鲜窗口直接再跑
}

type listBackupRunsArgs struct {
	PolicyID string `json:"policyId"`
	Limit    int    `json:"limit"`
}

// toolListBackupPolicies 列出备份策略资产。
func toolListBackupPolicies(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	list, err := d.Store.ListBackupPolicies()
	if err != nil {
		return Fail(err.Error())
	}
	if list == nil {
		list = []model.BackupPolicyDO{}
	}
	return OKData(map[string]interface{}{"policies": list})
}

// toolSaveBackupPolicy 保存备份策略。
func toolSaveBackupPolicy(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveBackupPolicyArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	switch kind {
	case model.BackupKindFiles, model.BackupKindSQLite, model.BackupKindDB:
	default:
		return Fail("kind 须为 files | sqlite | db")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("name 不能为空")
	}
	retainDays, retainCount := 7, 0
	if in.RetainDays != nil || in.RetainCount != nil {
		retainDays, retainCount = 0, 0
		if in.RetainDays != nil && *in.RetainDays > 0 {
			retainDays = *in.RetainDays
		} else if in.RetainCount != nil {
			retainCount = normalizeRetainCount(*in.RetainCount)
		}
	}
	p := model.BackupPolicyDO{
		ID:           strings.TrimSpace(in.ID),
		Name:         name,
		Kind:         kind,
		SSHHostID:    strings.TrimSpace(in.SSHHostID),
		ConnectionID: strings.TrimSpace(in.ConnectionID),
		Path:         strings.TrimSpace(in.Path),
		DestRoot:     strings.TrimSpace(in.DestRoot),
		RetainDays:   retainDays,
		RetainCount:  retainCount,
		CronExpr:     strings.TrimSpace(in.CronExpr),
		Enabled:      true,
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if in.BeforeWrite != nil {
		p.BeforeWrite = *in.BeforeWrite
	} else {
		p.BeforeWrite = true
	}
	if kind == model.BackupKindDB {
		if p.ConnectionID == "" {
			return Fail("db 策略须提供 connectionId")
		}
	} else if p.Path == "" || !strings.HasPrefix(p.Path, "/") {
		return Fail("files/sqlite 策略须提供绝对路径 path")
	}
	if p.DestRoot == "" {
		p.DestRoot = defaultBackupRoot
	}
	if msg := ValidateCronExpr(p.CronExpr); msg != "" {
		return Fail(msg)
	}
	saved, err := d.Store.SaveBackupPolicy(p)
	if err != nil {
		return Fail(err.Error())
	}
	cronNote, cronErr := SyncBackupCron(context.Background(), d, saved)
	if cronErr != nil {
		return Fail("策略已保存，但 crontab 同步失败: " + cronErr.Error())
	}
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainBackupPolicy, "backup", workbench.RadarOpUpdate, saved.ID, "", "备份策略 "+saved.Name, true)
	}
	note := "策略已落盘。动手前可 run_backup(policyId)；beforeWrite=true 时写库/盖文件会校验新鲜备份。"
	if cronNote != "" {
		note = note + " " + cronNote
	}
	return OKData(map[string]interface{}{
		"ok": true, "policy": saved, "cronNote": cronNote, "note": note,
	})
}

// toolListBackupRuns 列出备份执行记录。
func toolListBackupRuns(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in listBackupRunsArgs
	_ = json.Unmarshal(raw, &in)
	_ = SyncBackupRunsFromRemote(ctx, d, strings.TrimSpace(in.PolicyID))
	list, err := d.Store.ListBackupRuns(strings.TrimSpace(in.PolicyID), in.Limit)
	if err != nil {
		return Fail(err.Error())
	}
	if list == nil {
		list = []model.BackupRunDO{}
	}
	return OKData(map[string]interface{}{"runs": list})
}

// toolRunBackup 执行备份策略（需确认；确认后无头跑脚本并记 run）。
func toolRunBackup(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in runBackupArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	policyID := strings.TrimSpace(in.PolicyID)
	if policyID == "" {
		return Fail("policyId 不能为空")
	}
	p, err := d.Store.GetBackupPolicy(policyID)
	if err != nil {
		return Fail(err.Error())
	}
	if !p.Enabled {
		return Fail("策略已禁用: " + p.Name)
	}
	script, dest, errMsg := buildBackupScript(d, *p)
	if errMsg != "" {
		return Fail(errMsg)
	}
	preview := map[string]interface{}{
		"policyId":   p.ID,
		"name":       p.Name,
		"kind":       p.Kind,
		"sshHostId":  p.SSHHostID,
		"connectionId": p.ConnectionID,
		"path":       p.Path,
		"destPath":   dest,
		"command":    script,
		"intent":     strings.TrimSpace(in.Intent),
		"risk":       "备份策略执行（写目标目录）",
	}
	summary := strings.TrimSpace(in.Intent)
	if summary == "" {
		summary = "备份 · " + p.Name
	}
	return Confirm(uuid.NewString(), truncateRunes(summary, intentTitleMaxRune), preview)
}

// RunBackupConfirmed 用户确认后执行备份。
func RunBackupConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in runBackupArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	return executeBackupPolicy(ctx, d, strings.TrimSpace(in.PolicyID), strings.TrimSpace(in.Intent), "manual", in.Force)
}

// RunBackupNow 界面已拍板后直接执行备份。
func RunBackupNow(ctx context.Context, d *Deps, policyID, intent string, force bool) ToolResult {
	return executeBackupPolicy(ctx, d, policyID, intent, "manual", force)
}

// executeBackupPolicy 实际执行并落 run 记录。
func executeBackupPolicy(ctx context.Context, d *Deps, policyID, intent, trigger string, force bool) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	p, err := d.Store.GetBackupPolicy(policyID)
	if err != nil {
		return Fail(err.Error())
	}
	if !p.Enabled {
		return Fail("策略已禁用: " + p.Name)
	}
	if !force && trigger == "pre_write" {
		if ok, when := policyHasFreshBackup(d, p.ID); ok {
			return OKData(map[string]interface{}{
				"ok": true, "skipped": true, "policyId": p.ID,
				"lastOKAt": when, "note": "已有新鲜备份，跳过本次",
			})
		}
	}
	script, dest, errMsg := buildBackupScript(d, *p)
	if errMsg != "" {
		return Fail(errMsg)
	}
	// 无头执行（execSSH/local），不 Dispatch shell_run，避免跳到终端产品线。
	out, execErr := runBackupScript(ctx, d, p, script)
	status := "ok"
	detail := strings.TrimSpace(out)
	if execErr != nil {
		status = "fail"
		if detail == "" {
			detail = execErr.Error()
		} else {
			detail = execErr.Error() + "\n" + detail
		}
	}
	run, _ := d.Store.InsertBackupRun(model.BackupRunDO{
		PolicyID: p.ID, Trigger: trigger, Status: status,
		DestPath: dest, Detail: truncate(detail, 2000), Intent: intent,
	})
	if status != "ok" {
		return Fail("备份失败: " + detail)
	}
	return OKData(map[string]interface{}{
		"ok": true, "run": run, "destPath": dest, "output": truncate(detail, 800),
		"note": "备份完成。写操作前可用 list_backup_runs 核对。",
	})
}

func runBackupScript(ctx context.Context, d *Deps, p *model.BackupPolicyDO, script string) (string, error) {
	argv := []string{"bash", "-lc", script}
	if strings.TrimSpace(p.SSHHostID) == "" {
		return execLocalArgv(ctx, argv, backupExecTimeoutSec)
	}
	h, err := d.SSHHosts.Get(p.SSHHostID)
	if err != nil {
		return "", err
	}
	return execSSHArgv(ctx, d, *h, argv, backupExecTimeoutSec)
}

// backupPolicyIDPart 备份目录名前缀（策略 ID 去横线取前 8）。
func backupPolicyIDPart(policyID string) string {
	idPart := strings.ReplaceAll(strings.TrimSpace(policyID), "-", "")
	if len(idPart) > 8 {
		idPart = idPart[:8]
	}
	if idPart == "" {
		return "pol"
	}
	return idPart
}

// normalizeRetainCount <0 视为 0（不按份数清理）。
func normalizeRetainCount(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

// backupPruneClause 仅清理本策略前缀目录。retainDays>0 按天；否则 retainCount>0 按份数；皆 0 不清理。
func backupPruneClause(idPart string, retainDays, retainCount int) string {
	if idPart == "" {
		return ""
	}
	if retainDays > 0 {
		return fmt.Sprintf(
			`find "$ROOT" -maxdepth 1 -type d -name '%s_*' -mtime +%d -print0 2>/dev/null | while IFS= read -r -d '' d; do rm -rf "$d"; done`,
			idPart, retainDays,
		)
	}
	retainCount = normalizeRetainCount(retainCount)
	if retainCount == 0 {
		return ""
	}
	return fmt.Sprintf(
		`ls -1dt "$ROOT"/%s_*/ 2>/dev/null | grep -v '/\.ww-cron/' | tail -n +%d | while IFS= read -r d; do rm -rf "$d"; done`,
		idPart, retainCount+1,
	)
}

func buildBackupScript(d *Deps, p model.BackupPolicyDO) (script, dest string, errMsg string) {
	stamp := time.Now().Format("20060102_150405")
	root := strings.TrimSpace(p.DestRoot)
	if root == "" {
		root = defaultBackupRoot
	}
	idPart := backupPolicyIDPart(p.ID)
	dest = path.Clean(root) + "/" + idPart + "_" + stamp
	var b strings.Builder
	b.WriteString("set -e; ")
	b.WriteString("WW_BAK='")
	b.WriteString(shellSingleQuote(dest))
	b.WriteString("'; mkdir -p \"$WW_BAK\"; ")
	switch p.Kind {
	case model.BackupKindFiles, model.BackupKindSQLite:
		src := path.Clean(p.Path)
		b.WriteString("SRC='")
		b.WriteString(shellSingleQuote(src))
		b.WriteString("'; ")
		b.WriteString(`if [ -f "$SRC" ]; then cp -a "$SRC" "$WW_BAK/"; `)
		b.WriteString(`elif [ -d "$SRC" ]; then find "$SRC" -maxdepth 4 \( -name '*.db' -o -name '.env' -o -name '.env.*' -o -type f \) -print0 | while IFS= read -r -d '' x; do cp -a "$x" "$WW_BAK/$(echo "$x" | tr / _)" ; done; `)
		b.WriteString(`else echo "源不存在: $SRC" >&2; exit 1; fi; `)
	case model.BackupKindDB:
		dump, errMsg := buildDBDumpClause(d, p, dest)
		if errMsg != "" {
			return "", "", errMsg
		}
		b.WriteString(dump)
	default:
		return "", "", "未知 kind"
	}
	b.WriteString("ROOT='")
	b.WriteString(shellSingleQuote(path.Clean(root)))
	b.WriteString("'; ")
	if prune := backupPruneClause(idPart, p.RetainDays, p.RetainCount); prune != "" {
		b.WriteString(prune)
		b.WriteString("; ")
	}
	b.WriteString(`echo BACKUP_OK "$WW_BAK"`)
	return b.String(), dest, ""
}

func buildDBDumpClause(d *Deps, p model.BackupPolicyDO, dest string) (string, string) {
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
	file := dest + "/" + dbName + ".sql"
	switch {
	case strings.Contains(dbType, "postgres") || dbType == "pg":
		if port <= 0 {
			port = 5432
		}
		return fmt.Sprintf(
			`export PGPASSWORD='%s'; pg_dump -h '%s' -p %d -U '%s' -d '%s' -F p -f '%s'; `,
			shellSingleQuote(pass), shellSingleQuote(host), port, shellSingleQuote(user), shellSingleQuote(dbName), shellSingleQuote(file),
		), ""
	default:
		// mysql / mariadb / 默认
		if port <= 0 {
			port = 3306
		}
		return fmt.Sprintf(
			`export MYSQL_PWD='%s'; mysqldump -h '%s' -P %d -u '%s' --single-transaction --routines --triggers '%s' > '%s'; `,
			shellSingleQuote(pass), shellSingleQuote(host), port, shellSingleQuote(user), shellSingleQuote(dbName), shellSingleQuote(file),
		), ""
	}
}

func policyHasFreshBackup(d *Deps, policyID string) (bool, int64) {
	if d == nil || d.Store == nil {
		return false, 0
	}
	run, err := d.Store.LatestOKBackupRun(policyID)
	if err != nil || run == nil {
		return false, 0
	}
	if time.Now().Unix()-run.CreatedAt <= backupFreshWithinSec {
		return true, run.CreatedAt
	}
	return false, run.CreatedAt
}

// matchFilePoliciesForHost 匹配主机上的文件/sqlite 策略（写前 data guard 用）。
func matchFilePoliciesForHost(d *Deps, hostKey string, files, dirs []string) []model.BackupPolicyDO {
	if d == nil || d.Store == nil {
		return nil
	}
	list, err := d.Store.ListBackupPolicies()
	if err != nil {
		return nil
	}
	hostKey = hostKeyOrLocal(hostKey)
	var out []model.BackupPolicyDO
	for _, p := range list {
		if !p.Enabled {
			continue
		}
		if p.Kind != model.BackupKindFiles && p.Kind != model.BackupKindSQLite {
			continue
		}
		pk := hostKeyOrLocal(p.SSHHostID)
		if hostKey == "local" {
			if p.SSHHostID != "" && pk != "local" {
				continue
			}
		} else if pk != hostKey {
			continue
		}
		if policyPathHits(p.Path, files, dirs) {
			out = append(out, p)
		}
	}
	return out
}

func policyPathHits(policyPath string, files, dirs []string) bool {
	pp := path.Clean(strings.TrimSpace(policyPath))
	if pp == "" {
		return false
	}
	for _, f := range files {
		f = path.Clean(f)
		if f == pp || strings.HasPrefix(f, strings.TrimRight(pp, "/")+"/") {
			return true
		}
		if path.Dir(f) == pp {
			return true
		}
	}
	for _, d := range dirs {
		d = path.Clean(d)
		if d == pp || strings.HasPrefix(d, strings.TrimRight(pp, "/")+"/") || strings.HasPrefix(pp, strings.TrimRight(d, "/")+"/") {
			return true
		}
	}
	// 无明确目标时：递归同步仍可用「目录策略」兜底（策略 path 在命令文本里）
	return false
}

// matchDBPoliciesForConnection 写 SQL 前匹配 beforeWrite 库策略。
func matchDBPoliciesForConnection(d *Deps, connectionID string) []model.BackupPolicyDO {
	if d == nil || d.Store == nil || strings.TrimSpace(connectionID) == "" {
		return nil
	}
	list, err := d.Store.ListBackupPolicies()
	if err != nil {
		return nil
	}
	var out []model.BackupPolicyDO
	for _, p := range list {
		if !p.Enabled || !p.BeforeWrite || p.Kind != model.BackupKindDB {
			continue
		}
		if p.ConnectionID == connectionID {
			out = append(out, p)
		}
	}
	return out
}

// ensureDBBackupBeforeWrite 写 SQL 前：有 beforeWrite 策略则要求新鲜备份或当场执行。
func ensureDBBackupBeforeWrite(ctx context.Context, d *Deps, connectionID, intent string) ToolResult {
	policies := matchDBPoliciesForConnection(d, connectionID)
	if len(policies) == 0 {
		return OKData(map[string]interface{}{"ok": true, "skipped": true})
	}
	for _, p := range policies {
		res := executeBackupPolicy(ctx, d, p.ID, intent, "pre_write", false)
		if !res.OK {
			return Fail("写前备份未通过（策略 " + p.Name + "）: " + res.Error)
		}
	}
	return OKData(map[string]interface{}{"ok": true, "policies": len(policies)})
}

// resolveBackupDestRoot 数据防护写前备份目录（优先策略 DestRoot）。
func resolveBackupDestRoot(policies []model.BackupPolicyDO) string {
	for _, p := range policies {
		if strings.TrimSpace(p.DestRoot) != "" {
			return strings.TrimSpace(p.DestRoot)
		}
	}
	return defaultBackupRoot
}
