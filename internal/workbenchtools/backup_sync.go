package workbenchtools

import (
	"context"
	"errors"
	"path"
	"strings"
	"time"

	"WWorkbench/internal/model"
)

const backupRunSyncLimit = 80

var backupStampTZ = time.FixedZone("CST", 8*3600)

// SyncBackupRunsFromRemote 把远端/本机 destRoot 下已有备份目录补记为 cron 执行记录。
// 定时任务在主机 crontab 跑，不会自动写本地 backup_runs；打开执行记录时拉取对齐。
func SyncBackupRunsFromRemote(ctx context.Context, d *Deps, policyID string) int {
	if d == nil || d.Store == nil {
		return 0
	}
	var policies []model.BackupPolicyDO
	if id := strings.TrimSpace(policyID); id != "" {
		p, err := d.Store.GetBackupPolicy(id)
		if err != nil || p == nil {
			return 0
		}
		policies = []model.BackupPolicyDO{*p}
	} else {
		list, err := d.Store.ListBackupPolicies()
		if err != nil {
			return 0
		}
		policies = list
	}
	added := 0
	for _, p := range policies {
		n, err := syncOnePolicyBackupRuns(ctx, d, p)
		if err != nil {
			continue
		}
		added += n
	}
	return added
}

func syncOnePolicyBackupRuns(ctx context.Context, d *Deps, p model.BackupPolicyDO) (int, error) {
	root := strings.TrimSpace(p.DestRoot)
	if root == "" {
		root = defaultBackupRoot
	}
	root = path.Clean(root)
	idPart := backupPolicyIDPart(p.ID)
	cmd := "ls -1dt " + shellBashGlob(root+"/"+idPart+"_*/") + " 2>/dev/null | head -n 40"
	out, err := runBackupListCmd(ctx, d, p, cmd)
	if err != nil {
		return 0, err
	}
	existing, err := d.Store.ListBackupRuns(p.ID, 200)
	if err != nil {
		return 0, err
	}
	seen := make(map[string]struct{}, len(existing))
	for _, r := range existing {
		seen[path.Clean(strings.TrimSpace(r.DestPath))] = struct{}{}
	}
	added := 0
	for _, line := range strings.Split(out, "\n") {
		dir := path.Clean(strings.TrimSpace(strings.TrimSuffix(line, "/")))
		if dir == "" || dir == "." || dir == "/" {
			continue
		}
		base := path.Base(dir)
		if !strings.HasPrefix(base, idPart+"_") {
			continue
		}
		if _, ok := seen[dir]; ok {
			continue
		}
		createdAt, ok := parseBackupDirStamp(base, idPart)
		if !ok {
			createdAt = time.Now().Unix()
		}
		_, err := d.Store.InsertBackupRun(model.BackupRunDO{
			PolicyID:  p.ID,
			Trigger:   "cron",
			Status:    "ok",
			DestPath:  dir,
			Detail:    "BACKUP_OK " + dir,
			Intent:    "定时备份",
			CreatedAt: createdAt,
		})
		if err != nil {
			continue
		}
		seen[dir] = struct{}{}
		added++
		if added >= backupRunSyncLimit {
			break
		}
	}
	return added, nil
}

func runBackupListCmd(ctx context.Context, d *Deps, p model.BackupPolicyDO, cmd string) (string, error) {
	argv := []string{"bash", "-lc", cmd}
	if strings.TrimSpace(p.SSHHostID) == "" {
		return execLocalArgv(ctx, argv, 30)
	}
	if d.SSHHosts == nil {
		return "", errors.New("SSH 服务未就绪")
	}
	h, err := d.SSHHosts.Get(p.SSHHostID)
	if err != nil {
		return "", err
	}
	return execSSHArgv(ctx, d, *h, argv, 30)
}

func shellBashGlob(pattern string) string {
	// glob 须在 shell 中展开，不能整段单引号；仅转义单引号。
	return strings.ReplaceAll(pattern, "'", `'\''`)
}

func parseBackupDirStamp(base, idPart string) (int64, bool) {
	prefix := idPart + "_"
	if !strings.HasPrefix(base, prefix) {
		return 0, false
	}
	stamp := strings.TrimPrefix(base, prefix)
	t, err := time.ParseInLocation("20060102_150405", stamp, backupStampTZ)
	if err != nil {
		return 0, false
	}
	return t.Unix(), true
}
