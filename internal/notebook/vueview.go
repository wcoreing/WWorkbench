package notebook

import (
	"context"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	vueDistDir     = ".wwb-dist"
	vueKitDirName  = "vue-kit"
	vueBuildWait   = 90 * time.Second
	vueInstallWait = 3 * time.Minute
)

var (
	viewCommentRE = regexp.MustCompile(`(?is)\A\s*<!--\s*wwb-view\b.*?-->\s*`)
	assetRefRE    = regexp.MustCompile(`(?:\.\./)+assets/([^"'\\\s)<>?#]+)`)
)

// VuePackage 一次共用构建的结果。源工程在 view/，页面在 html/。
type VuePackage struct {
	NoteID    string `json:"noteId"`
	View      string `json:"view"`
	HTML      string `json:"html"`
	SourceRev string `json:"sourceRev,omitempty"`
	Bytes     int    `json:"bytes"`
	Seeded    bool   `json:"seeded"`
}

// PackageVueView 用系统里的同一套 Vite 构建该笔记的 view/ 工程，写出 html/{主名}.html。
func (s *Service) PackageVueView(ctx context.Context, noteID, skill string) (VuePackage, error) {
	if s == nil || s.dataDir == "" {
		return VuePackage{}, errnoNotebook("笔记本未就绪")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	noteID = strings.TrimSpace(strings.ReplaceAll(noteID, "\\", "/"))
	if noteID == "" || strings.Contains(noteID, "..") {
		return VuePackage{}, errnoNotebook("笔记路径无效")
	}
	n, err := s.GetNote(noteID)
	if err != nil {
		return VuePackage{}, err
	}
	noteID = strings.TrimSpace(strings.ReplaceAll(n.ID, "\\", "/"))
	if !strings.HasSuffix(strings.ToLower(noteID), ".md") || strings.EqualFold(filepath.Base(noteID), SkillEntryFile) {
		return VuePackage{}, errnoNotebook("只能打包普通 Markdown 笔记的视图")
	}
	skill = strings.TrimSpace(strings.ReplaceAll(skill, "\\", "/"))
	if err := commentField(noteID); err != nil {
		return VuePackage{}, err
	}
	if skill != "" {
		if err := commentField(skill); err != nil {
			return VuePackage{}, err
		}
	}
	content, _, err := s.notePaths(noteID)
	if err != nil {
		return VuePackage{}, err
	}
	bundle, ok := plainBundleDir(content)
	if !ok {
		return VuePackage{}, errnoNotebook("只能打包普通 Markdown 笔记的视图")
	}
	viewAbs := filepath.Join(bundle, BundleViewName)
	viewRel, ok := s.WorkspaceRel(viewAbs)
	if !ok {
		return VuePackage{}, errnoNotebook("Vue 工程路径无效")
	}
	title := strings.TrimSuffix(filepath.Base(noteID), filepath.Ext(noteID))
	seeded, err := ensureViewTemplate(viewAbs, title)
	if err != nil {
		return VuePackage{}, err
	}
	if err := validateVueProject(viewAbs); err != nil {
		return VuePackage{}, err
	}
	sourceRev := ""
	if rev, revErr := s.FileRevision(noteID); revErr == nil && rev.Enabled {
		sourceRev = rev.Short
		if len(sourceRev) > 7 {
			sourceRev = sourceRev[:7]
		}
	}
	viewRoot, err := filepath.EvalSymlinks(viewAbs)
	if err != nil {
		viewRoot = viewAbs
	}
	kitDir, err := s.ensureVueKit(ctx)
	if err != nil {
		return VuePackage{}, err
	}
	outDir := filepath.Join(viewRoot, vueDistDir)
	defer os.RemoveAll(outDir)
	if err := runVueBuild(ctx, kitDir, viewRoot, outDir); err != nil {
		return VuePackage{}, err
	}
	raw, err := os.ReadFile(filepath.Join(outDir, "index.html"))
	if err != nil {
		return VuePackage{}, errnoNotebook("构建没有产出 index.html")
	}
	page := stampVueBuild(string(raw), noteID, skill, sourceRev)
	if strings.Contains(page, `src="/src/`) || strings.Contains(page, `src="./`) {
		return VuePackage{}, errnoNotebook("构建没有把脚本内联进页面")
	}
	stem := filepath.Base(bundle)
	htmlAbs := filepath.Join(bundle, BundleHTMLName, stem+".html")
	htmlRel, ok := s.WorkspaceRel(htmlAbs)
	if !ok {
		return VuePackage{}, errnoNotebook("页面路径无效")
	}
	if err := os.MkdirAll(filepath.Dir(htmlAbs), 0o700); err != nil {
		return VuePackage{}, errnoNotebook("创建页面目录失败")
	}
	if err := os.WriteFile(htmlAbs, []byte(page), 0o600); err != nil {
		return VuePackage{}, errnoNotebook("写入页面失败")
	}
	return VuePackage{
		NoteID:    noteID,
		View:      viewRel,
		HTML:      htmlRel,
		SourceRev: sourceRev,
		Bytes:     len(page),
		Seeded:    seeded,
	}, nil
}

func validateVueProject(viewAbs string) error {
	if st, err := os.Stat(filepath.Join(viewAbs, "index.html")); err != nil || st.IsDir() {
		return errnoNotebook("view/ 还不是 Vue 工程：需要 index.html、src/main.js、src/App.vue、src/components。不要在 view 里放 node_modules")
	}
	js := filepath.Join(viewAbs, "src", "main.js")
	ts := filepath.Join(viewAbs, "src", "main.ts")
	jsOK, tsOK := false, false
	if st, err := os.Stat(js); err == nil && !st.IsDir() {
		jsOK = true
	}
	if st, err := os.Stat(ts); err == nil && !st.IsDir() {
		tsOK = true
	}
	if !jsOK && !tsOK {
		return errnoNotebook("view/ 缺少 src/main.js。入口从 vue 引入 createApp，挂到 #app")
	}
	return nil
}

func runVueBuild(ctx context.Context, kitDir, viewRoot, outDir string) error {
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return errnoNotebook("创建构建目录失败")
	}
	viteBin := filepath.Join(kitDir, "node_modules", ".bin", "vite")
	buildCtx, cancel := context.WithTimeout(ctx, vueBuildWait)
	defer cancel()
	cmd := exec.CommandContext(buildCtx, viteBin, "build", "--config", filepath.Join(kitDir, "vite.config.mjs"))
	cmd.Dir = viewRoot
	cmd.Env = append(os.Environ(),
		"WWB_VIEW_ROOT="+viewRoot,
		"WWB_OUT_DIR="+outDir,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return errnoNotebook("Vue 构建失败：" + trimBuildLog(string(out)))
	}
	return nil
}

func stampVueBuild(html, noteID, skill, sourceRev string) string {
	html = viewCommentRE.ReplaceAllString(html, "")
	prefix := notebookAssetPrefix(noteID)
	html = assetRefRE.ReplaceAllStringFunc(html, func(m string) string {
		sub := assetRefRE.FindStringSubmatch(m)
		if len(sub) != 2 || sub[1] == "" || strings.Contains(sub[1], "..") {
			return m
		}
		return prefix + url.PathEscape(sub[1])
	})
	var b strings.Builder
	b.WriteString("<!-- wwb-view")
	b.WriteString(` source="`)
	b.WriteString(noteID)
	b.WriteString(`" skill="`)
	b.WriteString(skill)
	b.WriteString(`" sourceRev="`)
	b.WriteString(sourceRev)
	b.WriteString(`" runtime="vue" -->`)
	b.WriteString("\n")
	b.WriteString(html)
	page := b.String()
	footer := "<footer>来源：" + htmlText(noteID) + "</footer>"
	if !strings.Contains(page, footer) {
		lower := strings.ToLower(page)
		if i := strings.LastIndex(lower, "</body>"); i >= 0 {
			page = page[:i] + footer + "\n" + page[i:]
		} else {
			page += "\n" + footer + "\n"
		}
	}
	return page
}

func notebookAssetPrefix(noteID string) string {
	parts := strings.Split(noteID, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return "/notebook-assets/" + strings.Join(parts, "/") + "/"
}

func commentField(s string) error {
	if strings.ContainsAny(s, "\"<>&\n\r") || strings.Contains(s, "--") {
		return errnoNotebook("页头字段含非法字符")
	}
	return nil
}

func htmlText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func trimBuildLog(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "无输出"
	}
	const max = 1200
	if len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}
