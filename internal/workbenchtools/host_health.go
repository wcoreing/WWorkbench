package workbenchtools

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

const (
	hostHealthScanTimeoutSec = 45
	hostHealthDefaultCron    = "0 3 * * *"
	hostHealthDefaultRetain  = 7
	hostHealthMaxDepth       = 5
	hostHealthMaxAssets      = 80
)

// ScanHostHealth 在指定工作目录内只读扫描可备份资产（*.db / .env / data 等）。
func ScanHostHealth(ctx context.Context, d *Deps, sshHostID, workDir string) (model.HostHealthReportDO, error) {
	report := model.HostHealthReportDO{
		SSHHostID: strings.TrimSpace(sshHostID),
		WorkDir:   path.Clean(strings.TrimSpace(workDir)),
		ScannedAt: time.Now().Unix(),
		Findings:  []model.HostHealthFindingDO{},
		Score:     100,
	}
	if d == nil || d.Store == nil || d.SSHHosts == nil {
		return report, fmt.Errorf("服务未就绪")
	}
	if report.SSHHostID == "" {
		return report, fmt.Errorf("须指定 sshHostId")
	}
	if report.WorkDir == "" || !strings.HasPrefix(report.WorkDir, "/") {
		return report, fmt.Errorf("须指定绝对工作目录 workDir")
	}
	h, err := d.SSHHosts.Get(report.SSHHostID)
	if err != nil {
		return report, err
	}
	report.HostLabel = fmt.Sprintf("%s · %s@%s", h.Name, h.User, h.Host)

	policies, err := d.Store.ListBackupPolicies()
	if err != nil {
		return report, err
	}
	hostPolicies := filterPoliciesForHost(policies, report.SSHHostID)
	report.PolicyCount = len(hostPolicies)

	raw, err := execSSHArgv(ctx, d, *h, []string{"bash", "-lc", hostHealthProbeScript(report.WorkDir)}, hostHealthScanTimeoutSec)
	if err != nil {
		return report, fmt.Errorf("扫描失败: %w", err)
	}
	assetPaths := parseHostHealthAssets(raw, report.WorkDir)
	// 工作目录本身也可选（整目录备份）
	assetPaths = prependUnique(report.WorkDir, assetPaths)

	coveredAssets := 0
	for _, pth := range assetPaths {
		kind := suggestKindForPath(pth)
		covered := pathCoveredByPolicies(pth, hostPolicies)
		if covered {
			coveredAssets++
			title := "已有策略覆盖"
			if pth == report.WorkDir {
				title = "工作目录已覆盖"
			}
			report.Findings = append(report.Findings, model.HostHealthFindingDO{
				ID:          "asset:" + pth,
				Severity:    "ok",
				Kind:        "asset_covered",
				Title:       title,
				Detail:      pth,
				SuggestKind: kind,
				Path:        pth,
				Fixable:     false,
			})
			continue
		}
		sev := "warn"
		title := "可选备份"
		if kind == model.BackupKindSQLite || isEnvPath(pth) {
			sev = "critical"
			title = "建议备份"
		} else if pth == report.WorkDir {
			title = "工作目录"
		}
		report.Findings = append(report.Findings, model.HostHealthFindingDO{
			ID:          "asset:" + pth,
			Severity:    sev,
			Kind:        "asset_uncovered",
			Title:       title,
			Detail:      pth,
			SuggestKind: kind,
			Path:        pth,
			Fixable:     true,
		})
	}
	report.CoveredCount = coveredAssets

	if len(assetPaths) == 0 {
		report.Findings = append(report.Findings, model.HostHealthFindingDO{
			ID:       "info:empty",
			Severity: "ok",
			Kind:     "info",
			Title:    "目录内未发现常见数据资产",
			Detail:   report.WorkDir + " · 可换更深路径或手动新建策略",
			Fixable:  false,
		})
	}

	report.FixableCount = countFixable(report.Findings)
	report.Score = scoreHostHealth(report)
	report.Summary = summarizeHostHealth(report, report.WorkDir)
	report.DiskBrief = ""
	return report, nil
}

// EnsureHostBackupPolicies 仅为选中的 findingId 创建策略（默认写前+7 天+每天 3:00）。
func EnsureHostBackupPolicies(ctx context.Context, d *Deps, sshHostID, workDir string, findingIDs []string, withCron bool) (model.EnsureHostBackupResultDO, error) {
	out := model.EnsureHostBackupResultDO{Created: []model.BackupPolicyDO{}}
	report, err := ScanHostHealth(ctx, d, sshHostID, workDir)
	if err != nil {
		return out, err
	}
	out.Report = report
	if d == nil || d.Store == nil {
		return out, fmt.Errorf("存储未就绪")
	}
	want := map[string]struct{}{}
	for _, id := range findingIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			want[id] = struct{}{}
		}
	}
	if len(want) == 0 {
		return out, fmt.Errorf("请至少选择一项要备份的路径")
	}
	for _, f := range report.Findings {
		if _, ok := want[f.ID]; !ok {
			continue
		}
		if !f.Fixable {
			out.Skipped++
			continue
		}
		name := healthPolicyName(f)
		p := model.BackupPolicyDO{
			ID:          uuid.NewString(),
			Name:        name,
			Kind:        f.SuggestKind,
			SSHHostID:   strings.TrimSpace(sshHostID),
			Path:        strings.TrimSpace(f.Path),
			DestRoot:    defaultBackupRoot,
			BeforeWrite: true,
			RetainDays:  hostHealthDefaultRetain,
			RetainCount: 0,
			Enabled:     true,
		}
		if withCron {
			p.CronExpr = hostHealthDefaultCron
		}
		if p.Path == "" || !strings.HasPrefix(p.Path, "/") {
			out.Skipped++
			continue
		}
		if p.Kind == model.BackupKindDB {
			out.Skipped++
			continue
		}
		saved, serr := d.Store.SaveBackupPolicy(p)
		if serr != nil {
			return out, serr
		}
		if _, cerr := SyncBackupCron(ctx, d, saved); cerr != nil {
			_ = cerr
		}
		if d.Radar != nil {
			d.Radar.EmitAsset(workbench.RadarDomainBackupPolicy, "backup", workbench.RadarOpCreate, saved.ID, "host-health-ensure", saved.Name, true)
		}
		out.Created = append(out.Created, saved)
	}
	if len(out.Created) == 0 && out.Skipped == 0 {
		return out, fmt.Errorf("所选项目无法创建策略（可能已覆盖或已失效）")
	}
	refreshed, rerr := ScanHostHealth(ctx, d, sshHostID, workDir)
	if rerr == nil {
		out.Report = refreshed
	}
	return out, nil
}

func hostHealthProbeScript(workDir string) string {
	root := shellSingleQuote(path.Clean(workDir))
	return fmt.Sprintf(`set +e
ROOT='%s'
if [ ! -d "$ROOT" ]; then echo "工作目录不存在: $ROOT" >&2; exit 1; fi
find "$ROOT" -maxdepth %d \( -name '*.db' -o -name '.env' -o -name '.env.*' -o \( -type d -name data \) \) 2>/dev/null | head -%d
true
`, root, hostHealthMaxDepth, hostHealthMaxAssets)
}

func parseHostHealthAssets(raw, workDir string) []string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	seen := map[string]struct{}{}
	out := make([]string, 0)
	root := path.Clean(workDir)
	for _, line := range strings.Split(raw, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || !strings.HasPrefix(trim, "/") {
			continue
		}
		clean := path.Clean(trim)
		if clean != root && !strings.HasPrefix(clean, root+"/") {
			continue
		}
		if strings.HasPrefix(clean, defaultBackupRoot) {
			continue
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out
}

func prependUnique(first string, rest []string) []string {
	first = path.Clean(first)
	out := []string{first}
	for _, p := range rest {
		if path.Clean(p) == first {
			continue
		}
		out = append(out, p)
	}
	return out
}

func isEnvPath(p string) bool {
	base := path.Base(p)
	return base == ".env" || strings.HasPrefix(base, ".env.")
}

func filterPoliciesForHost(all []model.BackupPolicyDO, hostID string) []model.BackupPolicyDO {
	out := make([]model.BackupPolicyDO, 0)
	for _, p := range all {
		if strings.TrimSpace(p.SSHHostID) == hostID {
			out = append(out, p)
		}
	}
	return out
}

func pathCoveredByPolicies(asset string, policies []model.BackupPolicyDO) bool {
	asset = path.Clean(asset)
	for _, p := range policies {
		if !p.Enabled {
			continue
		}
		if p.Kind == model.BackupKindDB {
			continue
		}
		src := path.Clean(strings.TrimSpace(p.Path))
		if src == "" {
			continue
		}
		if asset == src {
			return true
		}
		if strings.HasPrefix(asset, src+"/") {
			return true
		}
	}
	return false
}

func suggestKindForPath(p string) string {
	base := path.Base(p)
	if strings.HasSuffix(strings.ToLower(base), ".db") {
		return model.BackupKindSQLite
	}
	return model.BackupKindFiles
}

func healthPolicyName(f model.HostHealthFindingDO) string {
	switch f.SuggestKind {
	case model.BackupKindSQLite:
		return "SQLite · " + path.Base(f.Path)
	default:
		base := path.Base(f.Path)
		if isEnvPath(f.Path) {
			return "配置 · " + f.Path
		}
		if base == "data" {
			return "数据目录 · " + f.Path
		}
		return "文件 · " + f.Path
	}
}

func countFixable(findings []model.HostHealthFindingDO) int {
	n := 0
	for _, f := range findings {
		if f.Fixable {
			n++
		}
	}
	return n
}

func scoreHostHealth(r model.HostHealthReportDO) int {
	total := 0
	fixable := 0
	for _, f := range r.Findings {
		if f.Kind == "info" {
			continue
		}
		if strings.HasPrefix(f.Kind, "asset_") {
			total++
			if f.Fixable {
				fixable++
			}
		}
	}
	if total == 0 {
		return 100
	}
	covered := total - fixable
	return (covered * 100) / total
}

func summarizeHostHealth(r model.HostHealthReportDO, workDir string) string {
	if r.FixableCount == 0 {
		return "工作目录内可选项均已覆盖或无需新建"
	}
	return fmt.Sprintf("%s · %d 项可选，勾选后创建备份策略", workDir, r.FixableCount)
}
