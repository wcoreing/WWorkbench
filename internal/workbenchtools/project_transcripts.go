package workbenchtools

import (
	"bufio"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

const (
	cursorTranscriptsRelDir = ".wworkbench/cursor-transcripts"
	maxTranscriptMDRunes    = 120000
	maxTranscriptScanBytes  = 512 * 1024
)

// CursorTranscriptMeta 仓库内一条会话的元数据。
type CursorTranscriptMeta struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	SourcePath  string `json:"sourcePath,omitempty"`
	Workspace   string `json:"workspace,omitempty"`
	LocalPath   string `json:"localPath,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	LineCount   int    `json:"lineCount"`
	UpdatedAt   int64  `json:"updatedAt"`
	SyncedAt    int64  `json:"syncedAt"`
	NoteID      string `json:"noteId,omitempty"`
	GitIgnoreOK bool   `json:"gitIgnoreOk,omitempty"`
	GitIgnoreHint string `json:"gitIgnoreHint,omitempty"`
}

func projectCursorTranscriptsDir(localPath string) string {
	return filepath.Join(strings.TrimSpace(localPath), filepath.FromSlash(cursorTranscriptsRelDir))
}

func cursorProjectsRoot() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".cursor", "projects")
}

func cursorProjectSlugCandidates(localPath string) []string {
	localPath = filepath.Clean(strings.TrimSpace(localPath))
	if localPath == "" {
		return nil
	}
	trimmed := strings.TrimPrefix(localPath, string(filepath.Separator))
	parts := strings.Split(filepath.ToSlash(trimmed), "/")
	var plainParts, encParts []string
	for _, p := range parts {
		if p == "" {
			continue
		}
		plainParts = append(plainParts, p)
		if needsURLEncode(p) {
			encParts = append(encParts, url.PathEscape(p))
		} else {
			encParts = append(encParts, p)
		}
	}
	out := []string{strings.Join(plainParts, "-"), strings.Join(encParts, "-")}
	base := filepath.Base(localPath)
	if base != "" && base != "." {
		out = append(out, base, url.PathEscape(base))
	}
	return uniqueNonEmpty(out)
}

func needsURLEncode(s string) bool {
	for _, r := range s {
		if r > 127 || r == ' ' {
			return true
		}
	}
	return false
}

func uniqueNonEmpty(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

type discoveredTranscript struct {
	ID         string
	JSONLPath  string
	Workspace  string
	UpdatedAt  int64
	Title      string
	LineCount  int
}

func discoverCursorTranscripts(localPath, transcriptID string) ([]discoveredTranscript, error) {
	root := cursorProjectsRoot()
	if root == "" {
		return nil, errno.New(errno.CodeNotFound, "找不到 ~/.cursor/projects", "")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, errno.Wrap(errno.CodeNotFound, "读取 Cursor projects 失败", err)
	}
	slugs := cursorProjectSlugCandidates(localPath)
	localPathClean := filepath.Clean(strings.TrimSpace(localPath))
	wantID := strings.TrimSpace(transcriptID)
	wsFolders := cursorWorkspaceFoldersByProjectDir(root)

	var out []discoveredTranscript
	seen := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		wsName := e.Name()
		trRoot := filepath.Join(root, wsName, "agent-transcripts")
		st, err := os.Stat(trRoot)
		if err != nil || !st.IsDir() {
			continue
		}
		matchWS := workspaceMatchesProject(wsName, slugs, localPathClean)
		if !matchWS {
			for _, folder := range wsFolders[wsName] {
				if pathsEqualOrContain(folder, localPathClean) {
					matchWS = true
					break
				}
			}
		}
		subs, err := os.ReadDir(trRoot)
		if err != nil {
			continue
		}
		for _, sub := range subs {
			if !sub.IsDir() {
				continue
			}
			id := sub.Name()
			if wantID != "" && id != wantID {
				continue
			}
			jsonl := filepath.Join(trRoot, id, id+".jsonl")
			info, err := os.Stat(jsonl)
			if err != nil {
				alts, _ := filepath.Glob(filepath.Join(trRoot, id, "*.jsonl"))
				if len(alts) == 0 {
					continue
				}
				jsonl = alts[0]
				info, err = os.Stat(jsonl)
				if err != nil {
					continue
				}
			}
			if wantID == "" && !matchWS {
				if !transcriptMentionsPath(jsonl, localPathClean) {
					continue
				}
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			title, lines := peekTranscriptTitle(jsonl)
			out = append(out, discoveredTranscript{
				ID:        id,
				JSONLPath: jsonl,
				Workspace: wsName,
				UpdatedAt: info.ModTime().Unix(),
				Title:     title,
				LineCount: lines,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out, nil
}

func pathsEqualOrContain(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	if a == "" || b == "" {
		return false
	}
	if strings.EqualFold(a, b) {
		return true
	}
	sep := string(filepath.Separator)
	return strings.HasPrefix(strings.ToLower(a)+sep, strings.ToLower(b)+sep) ||
		strings.HasPrefix(strings.ToLower(b)+sep, strings.ToLower(a)+sep)
}

// cursorWorkspaceFoldersByProjectDir 尽力从 workspaceStorage 推断「Cursor project 目录名 → 工作区文件夹」。
func cursorWorkspaceFoldersByProjectDir(projectsRoot string) map[string][]string {
	out := map[string][]string{}
	home, err := os.UserHomeDir()
	if err != nil {
		return out
	}
	storage := filepath.Join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage")
	entries, err := os.ReadDir(storage)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(storage, e.Name(), "workspace.json"))
		if err != nil {
			continue
		}
		folders := parseCursorWorkspaceFolders(raw)
		if len(folders) == 0 {
			continue
		}
		for _, folder := range folders {
			for _, slug := range cursorProjectSlugCandidates(folder) {
				if _, err := os.Stat(filepath.Join(projectsRoot, slug)); err == nil {
					out[slug] = appendUniquePath(out[slug], folders...)
				}
			}
			// 多根时 Cursor 常用首个文件夹命名 projects 目录；把全部 folders 挂到能匹配上的 slug
			baseSlug := cursorProjectSlugCandidates(folder)
			if len(baseSlug) > 0 {
				out[baseSlug[0]] = appendUniquePath(out[baseSlug[0]], folders...)
			}
		}
	}
	return out
}

func appendUniquePath(dst []string, add ...string) []string {
	seen := map[string]bool{}
	for _, p := range dst {
		seen[filepath.Clean(p)] = true
	}
	for _, p := range add {
		p = filepath.Clean(strings.TrimSpace(p))
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		dst = append(dst, p)
	}
	return dst
}

func parseCursorWorkspaceFolders(raw []byte) []string {
	var single struct {
		Folder string `json:"folder"`
	}
	if json.Unmarshal(raw, &single) == nil && strings.TrimSpace(single.Folder) != "" {
		if p := fileURLToPath(single.Folder); p != "" {
			return []string{p}
		}
	}
	var multi struct {
		Folders []struct {
			Path string `json:"path"`
		} `json:"folders"`
	}
	if json.Unmarshal(raw, &multi) == nil {
		var out []string
		for _, f := range multi.Folders {
			if p := fileURLToPath(f.Path); p != "" {
				out = append(out, p)
			} else if p := strings.TrimSpace(f.Path); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return nil
}

func fileURLToPath(u string) string {
	u = strings.TrimSpace(u)
	if u == "" {
		return ""
	}
	if strings.HasPrefix(u, "file://") {
		parsed, err := url.Parse(u)
		if err != nil {
			return ""
		}
		p := parsed.Path
		if decoded, err := url.PathUnescape(p); err == nil {
			p = decoded
		}
		return filepath.Clean(p)
	}
	return filepath.Clean(u)
}

func workspaceMatchesProject(wsName string, slugs []string, localPath string) bool {
	for _, slug := range slugs {
		if slug == "" {
			continue
		}
		if wsName == slug || strings.EqualFold(wsName, slug) {
			return true
		}
		if strings.Contains(strings.ToLower(wsName), strings.ToLower(slug)) {
			return true
		}
	}
	base := strings.ToLower(filepath.Base(localPath))
	if base != "" && base != "." && strings.Contains(strings.ToLower(wsName), base) {
		return true
	}
	return false
}

func transcriptMentionsPath(jsonlPath, localPath string) bool {
	if localPath == "" {
		return false
	}
	f, err := os.Open(jsonlPath)
	if err != nil {
		return false
	}
	defer f.Close()
	limited := io.LimitReader(f, maxTranscriptScanBytes)
	b, err := io.ReadAll(limited)
	if err != nil {
		return false
	}
	text := string(b)
	if strings.Contains(text, localPath) {
		return true
	}
	base := filepath.Base(localPath)
	return base != "" && base != "." && strings.Contains(text, base)
}

func peekTranscriptTitle(jsonlPath string) (title string, lineCount int) {
	f, err := os.Open(jsonlPath)
	if err != nil {
		return filepath.Base(jsonlPath), 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	for sc.Scan() {
		lineCount++
		if title != "" {
			continue
		}
		var row struct {
			Role    string `json:"role"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &row) != nil || row.Role != "user" {
			continue
		}
		text := extractTranscriptText(row.Message.Content)
		text = stripUserQueryTags(text)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		title = firstLine(text, 80)
	}
	if title == "" {
		title = "Cursor 对话 " + strings.TrimSuffix(filepath.Base(jsonlPath), ".jsonl")
	}
	return title, lineCount
}

func extractTranscriptText(content json.RawMessage) string {
	content = json.RawMessage(strings.TrimSpace(string(content)))
	if len(content) == 0 {
		return ""
	}
	if content[0] == '"' {
		var s string
		if json.Unmarshal(content, &s) == nil {
			return s
		}
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(content, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			if p.Type == "text" || p.Text != "" {
				if b.Len() > 0 {
					b.WriteByte('\n')
				}
				b.WriteString(p.Text)
			}
		}
		return b.String()
	}
	return ""
}

func stripUserQueryTags(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "<user_query>"); i >= 0 {
		s = s[i+len("<user_query>"):]
	}
	if j := strings.Index(s, "</user_query>"); j >= 0 {
		s = s[:j]
	}
	// drop timestamp header lines
	lines := strings.Split(s, "\n")
	var keep []string
	for _, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "<timestamp>") || t == "" {
			continue
		}
		keep = append(keep, line)
	}
	return strings.TrimSpace(strings.Join(keep, "\n"))
}

func firstLine(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if maxRunes > 0 && utf8.RuneCountInString(s) > maxRunes {
		r := []rune(s)
		s = string(r[:maxRunes]) + "…"
	}
	return s
}

func jsonlToReadableMarkdown(jsonlPath string) (string, int, error) {
	f, err := os.Open(jsonlPath)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	var b strings.Builder
	lines := 0
	for sc.Scan() {
		lines++
		var row struct {
			Role    string `json:"role"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &row) != nil {
			continue
		}
		text := extractTranscriptText(row.Message.Content)
		if row.Role == "user" {
			text = stripUserQueryTags(text)
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		switch row.Role {
		case "user":
			b.WriteString("## User\n\n")
			b.WriteString(text)
			b.WriteString("\n\n")
		case "assistant":
			// 若只有 tool_use 无文本则跳过
			if looksLikeOnlyTools(row.Message.Content) && text == "" {
				continue
			}
			b.WriteString("## Assistant\n\n")
			b.WriteString(text)
			b.WriteString("\n\n")
		}
		if utf8.RuneCountInString(b.String()) > maxTranscriptMDRunes {
			b.WriteString("\n\n…(已截断，完整原文见同目录 .jsonl)\n")
			break
		}
	}
	return strings.TrimSpace(b.String()), lines, sc.Err()
}

func looksLikeOnlyTools(content json.RawMessage) bool {
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(content, &parts) != nil {
		return false
	}
	hasTool := false
	for _, p := range parts {
		if p.Type == "tool_use" {
			hasTool = true
		}
		if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
			return false
		}
	}
	return hasTool
}

func checkGitIgnoreHint(localPath string) (ok bool, hint string) {
	gi := filepath.Join(localPath, ".gitignore")
	b, err := os.ReadFile(gi)
	if err != nil {
		return true, "" // 无 gitignore 视为可提交
	}
	text := string(b)
	lines := strings.Split(text, "\n")
	blocked := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if line == ".wworkbench/" || line == ".wworkbench" || line == "**/.wworkbench/" {
			blocked = true
			break
		}
		if strings.HasPrefix(line, ".wworkbench") && !strings.HasPrefix(line, "!") {
			blocked = true
			break
		}
	}
	if !blocked {
		return true, ""
	}
	// 是否已有否定规则
	if strings.Contains(text, "!.wworkbench/cursor-transcripts") {
		return true, ""
	}
	return false, "仓库 .gitignore 忽略了 .wworkbench/；请追加 !.wworkbench/cursor-transcripts/ 以便 git 跨机同步"
}

// ListProjectCursorTranscripts 列出仓库 SSOT 中已同步的会话。
func ListProjectCursorTranscripts(localPath string) ([]CursorTranscriptMeta, error) {
	dir := projectCursorTranscriptsDir(localPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []CursorTranscriptMeta{}, nil
		}
		return nil, err
	}
	var out []CursorTranscriptMeta
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".meta.json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		var m CursorTranscriptMeta
		if json.Unmarshal(b, &m) != nil || m.ID == "" {
			continue
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out, nil
}

// GetProjectCursorTranscript 读取一条；preferMD 时返回可读 md（仓库内或现生成）。
func GetProjectCursorTranscript(localPath, transcriptID string, preferMD bool) (meta CursorTranscriptMeta, body string, bodyPath string, err error) {
	transcriptID = strings.TrimSpace(transcriptID)
	if transcriptID == "" {
		return meta, "", "", errno.New(errno.CodeInvalidArg, "请提供 transcriptId", "")
	}
	dir := projectCursorTranscriptsDir(localPath)
	metaPath := filepath.Join(dir, transcriptID+".meta.json")
	b, err := os.ReadFile(metaPath)
	if err != nil {
		return meta, "", "", errno.Wrap(errno.CodeNotFound, "未找到已同步的 transcript（先 sync）", err)
	}
	if json.Unmarshal(b, &meta) != nil {
		return meta, "", "", errno.New(errno.CodeStoreFailed, "meta 损坏", transcriptID)
	}
	mdPath := filepath.Join(dir, transcriptID+".md")
	jsonlPath := filepath.Join(dir, transcriptID+".jsonl")
	if preferMD {
		if mb, err := os.ReadFile(mdPath); err == nil {
			return meta, string(mb), mdPath, nil
		}
		if text, _, err := jsonlToReadableMarkdown(jsonlPath); err == nil {
			return meta, text, jsonlPath, nil
		}
	}
	if rb, err := os.ReadFile(jsonlPath); err == nil {
		// 原始可能很大，截断返回提示
		s := string(rb)
		if utf8.RuneCountInString(s) > maxTranscriptMDRunes {
			r := []rune(s)
			s = string(r[:maxTranscriptMDRunes]) + "\n…(jsonl 已截断；完整文件: " + jsonlPath + ")\n"
		}
		return meta, s, jsonlPath, nil
	}
	return meta, "", "", errno.New(errno.CodeNotFound, "缺少 transcript 正文文件", transcriptID)
}

// SyncProjectCursorTranscriptsResult 同步结果。
type SyncProjectCursorTranscriptsResult struct {
	Project     model.WorkbenchProjectDO `json:"project"`
	Synced      []CursorTranscriptMeta   `json:"synced"`
	Skipped     []string                 `json:"skipped,omitempty"`
	GitIgnoreOK bool                     `json:"gitIgnoreOk"`
	GitIgnoreHint string                 `json:"gitIgnoreHint,omitempty"`
	NoteIDs     []string                 `json:"noteIds,omitempty"`
}

// SyncProjectCursorTranscripts 从本机 Cursor 导入到仓库 SSOT，并镜像笔记钉入项目。
func SyncProjectCursorTranscripts(d *Deps, projectID, transcriptID string) (SyncProjectCursorTranscriptsResult, error) {
	out := SyncProjectCursorTranscriptsResult{}
	if d == nil || d.Store == nil {
		return out, errno.New(errno.CodeStoreFailed, "Store 未就绪", "")
	}
	p, err := d.Store.GetWorkbenchProject(projectID)
	if err != nil {
		return out, err
	}
	out.Project = p
	localPath := strings.TrimSpace(p.LocalPath)
	if localPath == "" {
		return out, errno.New(errno.CodeInvalidArg, "项目未设置 localPath", "")
	}
	if st, err := os.Stat(localPath); err != nil || !st.IsDir() {
		return out, errno.New(errno.CodeInvalidArg, "localPath 不是有效目录", localPath)
	}
	ok, hint := checkGitIgnoreHint(localPath)
	out.GitIgnoreOK = ok
	out.GitIgnoreHint = hint

	found, err := discoverCursorTranscripts(localPath, transcriptID)
	if err != nil {
		return out, err
	}
	if len(found) == 0 {
		if transcriptID != "" {
			return out, errno.New(errno.CodeNotFound, "未找到指定 transcriptId", transcriptID)
		}
		return out, errno.New(errno.CodeNotFound, "未匹配到与本项目相关的 Cursor transcripts（可传 transcriptId 显式指定）", localPath)
	}

	destDir := projectCursorTranscriptsDir(localPath)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return out, errno.Wrap(errno.CodeStoreFailed, "创建 .wworkbench/cursor-transcripts 失败", err)
	}
	// 友好 README
	readme := filepath.Join(destDir, "README.md")
	if _, err := os.Stat(readme); os.IsNotExist(err) {
		_ = os.WriteFile(readme, []byte("# Cursor transcripts（跨机续上下文）\n\n"+
			"本目录由 WWorkbench `sync_project_cursor_transcripts` 写入，请随项目 git 提交。\n\n"+
			"- `*.jsonl` 原文 · `*.md` 可读摘录 · `*.meta.json` 元数据\n"+
			"- 换机：git pull 后 list/get_project_cursor_transcripts，再开新对话续作\n"+
			"- 不能用 requestId 恢复原聊天窗\n"), 0o644)
	}

	now := time.Now().Unix()
	linked := linkedSet(p.Links)
	var noteIDs []string
	name := p.Name
	if name == "" {
		name = filepath.Base(localPath)
	}

	for _, tr := range found {
		destJSONL := filepath.Join(destDir, tr.ID+".jsonl")
		src, err := os.Open(tr.JSONLPath)
		if err != nil {
			out.Skipped = append(out.Skipped, tr.ID+": open "+err.Error())
			continue
		}
		dst, err := os.Create(destJSONL)
		if err != nil {
			src.Close()
			out.Skipped = append(out.Skipped, tr.ID+": create "+err.Error())
			continue
		}
		_, copyErr := io.Copy(dst, src)
		src.Close()
		dst.Close()
		if copyErr != nil {
			out.Skipped = append(out.Skipped, tr.ID+": copy "+copyErr.Error())
			continue
		}

		md, lineCount, _ := jsonlToReadableMarkdown(destJSONL)
		if lineCount == 0 {
			lineCount = tr.LineCount
		}
		mdPath := filepath.Join(destDir, tr.ID+".md")
		_ = os.WriteFile(mdPath, []byte("# "+tr.Title+"\n\n"+md+"\n"), 0o644)

		meta := CursorTranscriptMeta{
			ID:            tr.ID,
			Title:         tr.Title,
			SourcePath:    tr.JSONLPath,
			Workspace:     tr.Workspace,
			LocalPath:     localPath,
			ProjectID:     p.ID,
			LineCount:     lineCount,
			UpdatedAt:     tr.UpdatedAt,
			SyncedAt:      now,
			GitIgnoreOK:   ok,
			GitIgnoreHint: hint,
		}

		if d.Notebook != nil {
			note, nerr := d.Notebook.UpsertCursorTranscriptNote(p.ID, name, tr.ID, tr.Title, md)
			if nerr == nil && note != nil {
				meta.NoteID = note.ID
				noteIDs = append(noteIDs, note.ID)
				key := linkKey(model.MCPAssetNote, note.ID)
				if !linked[key] {
					p.Links = append(p.Links, model.WorkbenchProjectLinkDO{
						Kind:  model.MCPAssetNote,
						ID:    note.ID,
						Label: tr.Title,
					})
					linked[key] = true
				}
			}
		}

		mb, _ := json.MarshalIndent(meta, "", "  ")
		_ = os.WriteFile(filepath.Join(destDir, tr.ID+".meta.json"), mb, 0o644)
		out.Synced = append(out.Synced, meta)
	}

	saved, err := d.Store.SaveWorkbenchProject(p)
	if err != nil {
		return out, err
	}
	out.Project = saved
	out.NoteIDs = noteIDs
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", workbench.RadarOpUpdate, saved.ID, "mcp-project-cursor-sync", saved.Name, true)
	}
	return out, nil
}
