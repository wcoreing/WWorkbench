package app

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/homeclient"
	"WWorkbench/internal/model"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func toMap(v any) map[string]any {
	b, err := json.Marshal(v)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil || m == nil {
		return map[string]any{}
	}
	return stripSecretFields(m)
}

func stripSecretFields(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "password") || strings.Contains(lk, "secret") ||
			lk == "privatekey" || lk == "accesskeysecret" || lk == "token" || lk == "apikey" {
			continue
		}
		out[k] = v
	}
	return out
}

func mapsFromSlice[T any](items []T) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, toMap(it))
	}
	return out
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func (s *Service) emitHomeSync(stage string, percent int, message string, extra map[string]any) {
	if s == nil || s.ctx == nil {
		return
	}
	payload := map[string]any{
		"stage":   stage,
		"percent": percent,
		"message": message,
	}
	for k, v := range extra {
		payload[k] = v
	}
	runtime.EventsEmit(s.ctx, "home:sync", payload)
}

func snapshotLedgerEmpty(snap *homeclient.WorkspaceSnapshot) bool {
	if snap == nil {
		return true
	}
	return len(snap.Projects) == 0 &&
		len(snap.SSHHosts) == 0 &&
		len(snap.Connections) == 0 &&
		len(snap.LogSources) == 0 &&
		len(snap.HTTPFolders) == 0 &&
		len(snap.HTTPRequests) == 0 &&
		len(snap.HTTPEnvironments) == 0 &&
		len(snap.DockerContexts) == 0 &&
		len(snap.DockerShellHosts) == 0 &&
		len(snap.BackupPolicies) == 0 &&
		len(snap.Docs) == 0
}

func (s *Service) buildLocalSnapshot() (homeclient.WorkspaceSnapshot, error) {
	s.emitHomeSync("build", 5, "正在收集本机台账…", nil)

	projects, err := s.store.ListWorkbenchProjects()
	if err != nil {
		return homeclient.WorkspaceSnapshot{}, err
	}
	hp := make([]homeclient.Project, 0, len(projects))
	for _, p := range projects {
		hp = append(hp, projectToHomeClient(p))
	}

	sshHosts, _ := s.store.ListSSHHosts()
	for i := range sshHosts {
		sshHosts[i].Password = ""
	}
	conns, _ := s.store.ListConnections()
	for i := range conns {
		conns[i].Password = ""
		conns[i].SSHPassword = ""
	}
	logs, _ := s.store.ListLogSources()
	httpFolders, _ := s.store.ListHTTPFolders()
	httpReqs, _ := s.store.ListHTTPRequests()
	httpEnvs, _ := s.store.ListHTTPEnvironments()
	dockers, _ := s.store.ListDockerContexts()
	dockerShells, _ := s.store.ListDockerShellHosts()
	backups, _ := s.store.ListBackupPolicies()

	docs := make([]homeclient.SnapshotDoc, 0)
	if s.notebook != nil {
		s.emitHomeSync("build", 15, "正在打包笔记…", map[string]any{"docs": 0})
		exported, err := s.notebook.ExportDocsForSync(func(done, total int, path string) {
			pct := 15
			if total > 0 {
				pct = 15 + done*25/total
				if pct > 40 {
					pct = 40
				}
			}
			s.emitHomeSync("build", pct, fmt.Sprintf("正在打包笔记 %d/%d…", done, total), map[string]any{
				"docs": done, "docsTotal": total,
			})
		})
		if err == nil {
			for _, d := range exported {
				docs = append(docs, homeclient.SnapshotDoc{Path: d.Path, Content: d.Content})
			}
		}
	}

	return homeclient.WorkspaceSnapshot{
		Projects:         hp,
		SSHHosts:         mapsFromSlice(sshHosts),
		Connections:      mapsFromSlice(conns),
		LogSources:       mapsFromSlice(logs),
		HTTPFolders:      mapsFromSlice(httpFolders),
		HTTPRequests:     mapsFromSlice(httpReqs),
		HTTPEnvironments: mapsFromSlice(httpEnvs),
		DockerContexts:   mapsFromSlice(dockers),
		DockerShellHosts: mapsFromSlice(dockerShells),
		BackupPolicies:   mapsFromSlice(backups),
		Docs:             docs,
	}, nil
}

func projectToHomeClient(p model.WorkbenchProjectDO) homeclient.Project {
	links := make([]homeclient.ProjectLink, 0, len(p.Links))
	for _, l := range p.Links {
		links = append(links, homeclient.ProjectLink{Kind: l.Kind, ID: l.ID, Label: l.Label})
	}
	return homeclient.Project{
		ID: p.ID, Name: p.Name, LocalPath: p.LocalPath, GitRemote: p.GitRemote, Links: links,
	}
}

func homeClientToProject(p homeclient.Project) model.WorkbenchProjectDO {
	links := make([]model.WorkbenchProjectLinkDO, 0, len(p.Links))
	for _, l := range p.Links {
		links = append(links, model.WorkbenchProjectLinkDO{Kind: l.Kind, ID: l.ID, Label: l.Label})
	}
	return model.WorkbenchProjectDO{
		ID: p.ID, Name: p.Name, LocalPath: p.LocalPath, GitRemote: p.GitRemote, Links: links,
	}
}

func decodeMap[T any](m map[string]any) (T, error) {
	var zero T
	b, err := json.Marshal(m)
	if err != nil {
		return zero, err
	}
	var out T
	if err := json.Unmarshal(b, &out); err != nil {
		return zero, err
	}
	return out, nil
}

func mergeSSHHost(local *model.SSHHostDO, remote model.SSHHostDO) model.SSHHostDO {
	out := remote
	if local != nil {
		out.Password = local.Password
		if strings.TrimSpace(out.KeyPath) == "" {
			out.KeyPath = local.KeyPath
		}
	} else {
		out.Password = ""
	}
	return out
}

func mergeConnection(local *model.ConnectionDO, remote model.ConnectionDO) model.ConnectionDO {
	out := remote
	if local != nil {
		out.Password = local.Password
		out.SSHPassword = local.SSHPassword
		if strings.TrimSpace(out.SSHKeyPath) == "" {
			out.SSHKeyPath = local.SSHKeyPath
		}
	} else {
		out.Password = ""
		out.SSHPassword = ""
	}
	return out
}

func syncResultFromSnap(snap *homeclient.WorkspaceSnapshot, docsN int, bytes, gzipBytes int64, note string) model.HomeSyncResultDO {
	out := model.HomeSyncResultDO{Docs: docsN, Bytes: bytes, BytesGzip: gzipBytes, Note: note}
	if snap != nil {
		out.Projects = len(snap.Projects)
		out.SSHHosts = len(snap.SSHHosts)
		out.Connections = len(snap.Connections)
		out.LogSources = len(snap.LogSources)
		if docsN == 0 {
			if len(snap.Docs) > 0 {
				out.Docs = len(snap.Docs)
			} else if len(snap.DocIndex) > 0 {
				out.Docs = len(snap.DocIndex)
			}
		}
	}
	return out
}

// HomeSyncNow 换机同步：按空/非空智能单向；两边都有则先拉后推。整包一次往返。
func (s *Service) HomeSyncNow() ApiResult[model.HomeSyncResultDO] {
	start := time.Now()
	s.emitHomeSync("start", 0, "开始同步…", nil)
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}

	s.emitHomeSync("probe", 8, "正在检查云端快照…", nil)
	cloudLite, err := c.GetSyncLite()
	if err != nil {
		s.emitHomeSync("error", 0, "拉取失败", nil)
		return ErrResult[model.HomeSyncResultDO](errno.Wrap(errno.CodeStoreFailed, "拉取资源失败", err))
	}
	local, err := s.buildLocalSnapshot()
	if err != nil {
		s.emitHomeSync("error", 0, "打包失败", nil)
		return ErrResult[model.HomeSyncResultDO](err)
	}
	// lite 无 Docs 正文，用 DocIndex 判断云端是否已有笔记
	cloudEmpty := snapshotLedgerEmpty(cloudLite) && (cloudLite == nil || len(cloudLite.DocIndex) == 0)
	localEmpty := snapshotLedgerEmpty(&local)

	var res ApiResult[model.HomeSyncResultDO]
	switch {
	case cloudEmpty && localEmpty:
		res = OkResult(model.HomeSyncResultDO{Note: "两侧皆空，无需同步"})
	case cloudEmpty && !localEmpty:
		res = s.homeSyncPushWith(c, local)
	case !cloudEmpty && localEmpty:
		s.emitHomeSync("download", 20, "正在下载云端整包…", nil)
		cloud, err := c.GetSync()
		if err != nil {
			return ErrResult[model.HomeSyncResultDO](errno.Wrap(errno.CodeStoreFailed, "拉取资源失败", err))
		}
		res = s.homeSyncApplyPull(cloud)
	default:
		s.emitHomeSync("download", 20, "正在下载云端整包…", nil)
		cloud, err := c.GetSync()
		if err != nil {
			return ErrResult[model.HomeSyncResultDO](errno.Wrap(errno.CodeStoreFailed, "拉取资源失败", err))
		}
		if pull := s.homeSyncApplyPull(cloud); !pull.Ok {
			return pull
		}
		local2, err := s.buildLocalSnapshot()
		if err != nil {
			return ErrResult[model.HomeSyncResultDO](err)
		}
		push := s.homeSyncPushWith(c, local2)
		if !push.Ok {
			return push
		}
		push.Data.Note = "已双向同步（整包拉取合并 → 整包推送）"
		res = push
	}
	if res.Ok {
		res.Data.DurationMs = time.Since(start).Milliseconds()
		sizeMsg := humanBytes(res.Data.Bytes)
		if res.Data.BytesGzip > 0 && res.Data.BytesGzip != res.Data.Bytes {
			sizeMsg = fmt.Sprintf("%s → gzip %s", humanBytes(res.Data.Bytes), humanBytes(res.Data.BytesGzip))
		}
		s.emitHomeSync("done", 100, fmt.Sprintf("同步完成 · %s · %dms", sizeMsg, res.Data.DurationMs), map[string]any{
			"bytes": res.Data.Bytes, "bytesGzip": res.Data.BytesGzip, "docs": res.Data.Docs, "durationMs": res.Data.DurationMs,
		})
	}
	return res
}

// HomeSyncPush 推送本机全部资源台账+笔记整包到账号云端（密钥不上云）。
func (s *Service) HomeSyncPush() ApiResult[model.HomeSyncResultDO] {
	start := time.Now()
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	snap, err := s.buildLocalSnapshot()
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	res := s.homeSyncPushWith(c, snap)
	if res.Ok {
		res.Data.DurationMs = time.Since(start).Milliseconds()
	}
	return res
}

func (s *Service) homeSyncPushWith(c *homeclient.Client, snap homeclient.WorkspaceSnapshot) ApiResult[model.HomeSyncResultDO] {
	raw, err := json.Marshal(snap)
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	bytes := int64(len(raw))
	s.emitHomeSync("upload", 55, fmt.Sprintf("正在 gzip 上传整包 %s（%d 篇笔记）…", humanBytes(bytes), len(snap.Docs)), map[string]any{
		"bytes": bytes, "docs": len(snap.Docs),
	})
	saved, rawN, gzipN, err := c.PutSyncJSON(raw)
	if err != nil {
		s.emitHomeSync("error", 55, "上传失败", map[string]any{"bytes": bytes})
		return ErrResult[model.HomeSyncResultDO](errno.Wrap(errno.CodeStoreFailed, "推送资源失败", err))
	}
	if rawN > 0 {
		bytes = rawN
	}
	docsN := len(snap.Docs)
	if saved != nil && len(saved.DocIndex) > 0 {
		docsN = len(saved.DocIndex)
	}
	out := syncResultFromSnap(saved, docsN, bytes, gzipN, "已整包 gzip 推送台账与笔记；密钥保留在本机")
	msg := fmt.Sprintf("上传完成 %s", humanBytes(bytes))
	if gzipN > 0 {
		msg = fmt.Sprintf("上传完成 %s → gzip %s", humanBytes(bytes), humanBytes(gzipN))
	}
	s.emitHomeSync("upload", 90, msg, map[string]any{"bytes": bytes, "bytesGzip": gzipN, "docs": docsN})
	return OkResult(out)
}

// HomeSyncPull 从账号云端拉取整包并合并到本机（不覆盖本机已有密钥）。
func (s *Service) HomeSyncPull() ApiResult[model.HomeSyncResultDO] {
	start := time.Now()
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[model.HomeSyncResultDO](err)
	}
	s.emitHomeSync("download", 20, "正在下载云端整包…", nil)
	snap, err := c.GetSync()
	if err != nil {
		return ErrResult[model.HomeSyncResultDO](errno.Wrap(errno.CodeStoreFailed, "拉取资源失败", err))
	}
	res := s.homeSyncApplyPull(snap)
	if res.Ok {
		res.Data.DurationMs = time.Since(start).Milliseconds()
	}
	return res
}

func (s *Service) homeSyncApplyPull(snap *homeclient.WorkspaceSnapshot) ApiResult[model.HomeSyncResultDO] {
	if snap == nil {
		return OkResult(model.HomeSyncResultDO{Note: "云端无数据"})
	}

	var bytes int64
	if raw, err := json.Marshal(snap); err == nil {
		bytes = int64(len(raw))
	}
	s.emitHomeSync("apply", 50, fmt.Sprintf("正在写入本机（包约 %s，笔记 %d）…", humanBytes(bytes), len(snap.Docs)), map[string]any{
		"bytes": bytes, "docs": len(snap.Docs),
	})

	projN := 0
	for _, p := range snap.Projects {
		local, err := s.store.GetWorkbenchProject(p.ID)
		merged := homeClientToProject(p)
		if err == nil {
			if strings.TrimSpace(local.LocalPath) != "" {
				merged.LocalPath = local.LocalPath
			}
			merged.CreatedAt = local.CreatedAt
		}
		if _, err := s.store.SaveWorkbenchProject(merged); err == nil {
			projN++
		}
	}

	sshN := 0
	for _, m := range snap.SSHHosts {
		remote, err := decodeMap[model.SSHHostDO](m)
		if err != nil || strings.TrimSpace(remote.ID) == "" {
			continue
		}
		local, _ := s.store.GetSSHHost(remote.ID)
		merged := mergeSSHHost(local, remote)
		if err := s.store.SaveSSHHost(merged); err == nil {
			sshN++
		}
	}

	connN := 0
	for _, m := range snap.Connections {
		remote, err := decodeMap[model.ConnectionDO](m)
		if err != nil || strings.TrimSpace(remote.ID) == "" {
			continue
		}
		local, _ := s.store.GetConnection(remote.ID)
		merged := mergeConnection(local, remote)
		if err := s.store.SaveConnection(merged); err == nil {
			connN++
		}
	}

	logN := 0
	for _, m := range snap.LogSources {
		remote, err := decodeMap[model.LogSourceDO](m)
		if err != nil || remote.ID == "" {
			continue
		}
		if err := s.store.SaveLogSource(remote); err == nil {
			logN++
		}
	}
	for _, m := range snap.HTTPFolders {
		if remote, err := decodeMap[model.HTTPFolderDO](m); err == nil && remote.ID != "" {
			_, _ = s.store.SaveHTTPFolder(remote)
		}
	}
	for _, m := range snap.HTTPRequests {
		if remote, err := decodeMap[model.HTTPSavedRequestDO](m); err == nil && remote.ID != "" {
			_, _ = s.store.SaveHTTPRequest(remote)
		}
	}
	for _, m := range snap.HTTPEnvironments {
		if remote, err := decodeMap[model.HTTPEnvironmentDO](m); err == nil && remote.ID != "" {
			r := remote
			_ = s.store.SaveHTTPEnvironment(&r)
		}
	}
	for _, m := range snap.DockerContexts {
		if remote, err := decodeMap[model.DockerContextDO](m); err == nil && remote.ID != "" {
			_ = s.store.SaveDockerContext(remote)
		}
	}
	for _, m := range snap.DockerShellHosts {
		if remote, err := decodeMap[model.DockerShellHostDO](m); err == nil && remote.ID != "" {
			_ = s.store.SaveDockerShellHost(remote)
		}
	}
	for _, m := range snap.BackupPolicies {
		if remote, err := decodeMap[model.BackupPolicyDO](m); err == nil && remote.ID != "" {
			_, _ = s.store.SaveBackupPolicy(remote)
		}
	}

	docsN := 0
	totalDocs := len(snap.Docs)
	if s.notebook != nil {
		for i, d := range snap.Docs {
			path := strings.TrimSpace(d.Path)
			if path == "" {
				continue
			}
			title := filepath.Base(path)
			title = strings.TrimSuffix(title, filepath.Ext(title))
			note := model.NoteDO{
				ID:       path,
				GroupID:  filepath.ToSlash(filepath.Dir(path)),
				Title:    title,
				Content:  d.Content,
				Language: "markdown",
				Role:     model.NoteRoleNote,
			}
			if _, err := s.notebook.SaveNote(note); err == nil {
				docsN++
			}
			if totalDocs > 0 && (i%20 == 0 || i+1 == totalDocs) {
				pct := 50 + (i+1)*40/totalDocs
				if pct > 90 {
					pct = 90
				}
				s.emitHomeSync("apply", pct, fmt.Sprintf("正在写入笔记 %d/%d…", i+1, totalDocs), map[string]any{
					"docs": i + 1, "docsTotal": totalDocs, "bytes": bytes,
				})
			}
		}
	}

	return OkResult(model.HomeSyncResultDO{
		Projects:    projN,
		SSHHosts:    sshN,
		Connections: connN,
		LogSources:  logN,
		Docs:        docsN,
		Bytes:       bytes,
		Note:        "已整包拉取并合并；本机已有密钥未覆盖",
	})
}
