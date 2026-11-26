package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/store"

	"github.com/google/uuid"
	"github.com/wcoreing/ningharness/workspace"
)

type fileExecKey struct{}

func fileMutating(name string) bool {
	switch name {
	case "write_file", "edit", "mkdir", "create_file",
		"rename_path", "move_path", "copy_path",
		"delete_path", "batch_delete_paths", "batch_move_paths":
		return true
	default:
		return false
	}
}

func fileAlwaysConfirm(name string) bool {
	return name == "delete_path" || name == "batch_delete_paths"
}

type fileArgs struct {
	Root            string   `json:"root"`
	RelPath         string   `json:"rel_path"`
	Content         string   `json:"content"`
	OldString       string   `json:"old_string"`
	NewString       string   `json:"new_string"`
	ReplaceAll      bool     `json:"replace_all"`
	NewName         string   `json:"new_name"`
	FromRel         string   `json:"from_rel"`
	ToRel           string   `json:"to_rel"`
	RelPaths        []string `json:"rel_paths"`
	DestDir         string   `json:"dest_dir"`
	Pattern         string   `json:"pattern"`
	Path            string   `json:"path"`
	Glob            string   `json:"glob"`
	CaseInsensitive bool     `json:"case_insensitive"`
	Regex           bool     `json:"regex"`
	MaxMatches      float64  `json:"max_matches"`
}

func fileRootProp() map[string]interface{} {
	return map[string]interface{}{
		"type":        "string",
		"description": "根：project=当前舞台项目（默认），notebook=笔记本，harness=仅 system/skills",
	}
}

func registerFileTools(r *Registry) {
	root := fileRootProp()
	rel := map[string]interface{}{"type": "string", "description": "相对所选根的路径"}
	r.add(ToolDef{
		Name:        "list_tree",
		Description: "列出根下文件树（跳过 .git / node_modules 等；单目录过宽会折叠）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"root": root,
			},
		},
		Handler: toolListTree,
	})
	r.add(ToolDef{
		Name:        "read_file",
		Description: "读取文本。rel_path 相对 root。整文件重写前先读。harness 只用于 system/skills。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path"},
			"properties": map[string]interface{}{
				"root":     root,
				"rel_path": rel,
			},
		},
		Handler: toolReadFile,
	})
	r.add(ToolDef{
		Name:        "grep",
		Description: "在根内搜索文本。默认字面量；regex=true 时用 Go 正则。可限 path 与 glob。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"pattern"},
			"properties": map[string]interface{}{
				"root":             root,
				"pattern":          map[string]interface{}{"type": "string", "description": "搜索串"},
				"path":             map[string]interface{}{"type": "string", "description": "限定相对路径（文件或目录）"},
				"glob":             map[string]interface{}{"type": "string", "description": "文件名 glob，如 *.vue"},
				"case_insensitive": map[string]interface{}{"type": "boolean"},
				"regex":            map[string]interface{}{"type": "boolean", "description": "pattern 按正则"},
				"max_matches":      map[string]interface{}{"type": "number", "description": "最多命中行，默认 40，最大 200"},
			},
		},
		Handler: toolGrepFiles,
	})
	r.add(ToolDef{
		Name:        "write_file",
		Description: "整文件写入相对路径（父目录自动建，已有则覆盖）。定点小改用 edit。成功回执含 Successfully wrote 后才可说已落盘。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path", "content"},
			"properties": map[string]interface{}{
				"root":     root,
				"rel_path": rel,
				"content":  map[string]interface{}{"type": "string", "description": "写入全文"},
				"intent":   intentProp(),
			},
		},
		Handler: toolWriteFile,
	})
	r.add(ToolDef{
		Name:        "edit",
		Description: "把 old_string 精确替换为 new_string。默认必须唯一；多处时扩大上下文或 replace_all=true。成功回执含 Successfully edited。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path", "old_string", "new_string"},
			"properties": map[string]interface{}{
				"root":        root,
				"rel_path":    rel,
				"old_string":  map[string]interface{}{"type": "string", "description": "要替换的原文"},
				"new_string":  map[string]interface{}{"type": "string", "description": "替换后文本，可空表示删除该段"},
				"replace_all": map[string]interface{}{"type": "boolean"},
				"intent":      intentProp(),
			},
		},
		Handler: toolEditFile,
	})
	r.add(ToolDef{
		Name:        "mkdir",
		Description: "创建目录；已存在报错。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path"},
			"properties": map[string]interface{}{
				"root": root, "rel_path": rel, "intent": intentProp(),
			},
		},
		Handler: toolMkdir,
	})
	r.add(ToolDef{
		Name:        "create_file",
		Description: "创建空文件；父目录自动建；已存在报错。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path"},
			"properties": map[string]interface{}{
				"root": root, "rel_path": rel, "intent": intentProp(),
			},
		},
		Handler: toolCreateFile,
	})
	r.add(ToolDef{
		Name:        "rename_path",
		Description: "同级改名。new_name 只要文件名；写了完整路径会取最后一段。跨目录用 move_path。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path", "new_name"},
			"properties": map[string]interface{}{
				"root":     root,
				"rel_path": rel,
				"new_name": map[string]interface{}{"type": "string", "description": "新文件名或目录名"},
				"intent":   intentProp(),
			},
		},
		Handler: toolRenamePath,
	})
	r.add(ToolDef{
		Name:        "move_path",
		Description: "移动文件或目录；目标勿已存在；禁止移入自身子树。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"from_rel", "to_rel"},
			"properties": map[string]interface{}{
				"root":     root,
				"from_rel": map[string]interface{}{"type": "string"},
				"to_rel":   map[string]interface{}{"type": "string"},
				"intent":   intentProp(),
			},
		},
		Handler: toolMovePath,
	})
	r.add(ToolDef{
		Name:        "copy_path",
		Description: "复制文件或目录；目标勿已存在。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"from_rel", "to_rel"},
			"properties": map[string]interface{}{
				"root": root, "from_rel": map[string]interface{}{"type": "string"},
				"to_rel": map[string]interface{}{"type": "string"}, "intent": intentProp(),
			},
		},
		Handler: toolCopyPath,
	})
	r.add(ToolDef{
		Name:        "delete_path",
		Description: "删除文件或目录。须工作台确认。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_path"},
			"properties": map[string]interface{}{
				"root": root, "rel_path": rel, "intent": intentProp(),
			},
		},
		Handler: toolDeletePath,
	})
	r.add(ToolDef{
		Name:        "batch_delete_paths",
		Description: "批量删除；父路径已选则压掉子路径。须工作台确认。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_paths"},
			"properties": map[string]interface{}{
				"root":      root,
				"rel_paths": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
				"intent":    intentProp(),
			},
		},
		Handler: toolBatchDeletePaths,
	})
	r.add(ToolDef{
		Name:        "batch_move_paths",
		Description: "批量移入 dest_dir（空=根）；重名自动避让。",
		Parameters: map[string]interface{}{
			"type":     "object",
			"required": []string{"rel_paths"},
			"properties": map[string]interface{}{
				"root":      root,
				"rel_paths": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
				"dest_dir":  map[string]interface{}{"type": "string", "description": "目标目录，空=根"},
				"intent":    intentProp(),
			},
		},
		Handler: toolBatchMovePaths,
	})
}

func toolListTree(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "list_tree", raw)
}
func toolReadFile(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "read_file", raw)
}
func toolGrepFiles(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "grep", raw)
}
func toolWriteFile(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "write_file", raw)
}
func toolEditFile(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "edit", raw)
}
func toolMkdir(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "mkdir", raw)
}
func toolCreateFile(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "create_file", raw)
}
func toolRenamePath(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "rename_path", raw)
}
func toolMovePath(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "move_path", raw)
}
func toolCopyPath(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "copy_path", raw)
}
func toolDeletePath(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "delete_path", raw)
}
func toolBatchDeletePaths(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "batch_delete_paths", raw)
}
func toolBatchMovePaths(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return dispatchFileTool(ctx, d, "batch_move_paths", raw)
}

func dispatchFileTool(ctx context.Context, d *Deps, name string, raw json.RawMessage) ToolResult {
	var in fileArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return Fail("参数无效")
		}
	}
	if strings.TrimSpace(in.Root) == "" && pathsAreHarnessSkills(fileTouchedRels(name, in)) {
		in.Root = "harness"
	}
	abs, kind, err := resolveFileRoot(d, in.Root)
	if err != nil {
		return Fail(err.Error())
	}
	paths := fileTouchedRels(name, in)
	for _, p := range paths {
		if _, err := cleanFileRel(p); err != nil {
			return Fail(err.Error())
		}
	}
	confirmed, _ := ctx.Value(fileExecKey{}).(bool)
	if fileMutating(name) && !confirmed {
		if fileAlwaysConfirm(name) || relsHardData(paths) {
			return Confirm(uuid.NewString(), fileConfirmSummary(name, kind, paths), map[string]any{
				"root":     kind,
				"paths":    paths,
				"hardRisk": true,
				"risk":     fileConfirmRisk(name, paths),
			})
		}
	}
	ws := workspace.New()
	if _, err := ws.Open(abs); err != nil {
		return Fail(err.Error())
	}
	writeID := "file-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	out, touched, op, err := applyFileOp(ws, name, in, writeID)
	if err != nil {
		return Fail(err.Error())
	}
	if kind == "notebook" {
		emitNotebookFileOps(d, op, touched, writeID)
	}
	return out
}

func fileConfirmSummary(name, kind string, paths []string) string {
	shown := strings.Join(paths, ", ")
	if shown == "" {
		shown = name
	}
	if fileAlwaysConfirm(name) {
		return "删除 " + kind + "：" + shown
	}
	return "写入数据文件 " + kind + "：" + shown
}

func fileConfirmRisk(name string, paths []string) string {
	if fileAlwaysConfirm(name) {
		return "删除文件"
	}
	if relsHardData(paths) {
		return "数据文件（*.db/.env/data）"
	}
	return ""
}

func fileTouchedRels(name string, in fileArgs) []string {
	switch name {
	case "write_file", "edit", "mkdir", "create_file", "delete_path":
		return []string{in.RelPath}
	case "rename_path":
		return []string{in.RelPath, renameDest(in.RelPath, in.NewName)}
	case "move_path", "copy_path":
		return []string{in.FromRel, in.ToRel}
	case "batch_delete_paths":
		return in.RelPaths
	case "batch_move_paths":
		out := append([]string{}, in.RelPaths...)
		if strings.TrimSpace(in.DestDir) != "" {
			out = append(out, in.DestDir)
		}
		return out
	case "grep":
		if strings.TrimSpace(in.Path) == "" {
			return nil
		}
		return []string{in.Path}
	case "read_file":
		return []string{in.RelPath}
	default:
		return nil
	}
}

func renameDest(rel, newName string) string {
	name := strings.TrimSpace(newName)
	if strings.ContainsAny(name, `/\`) {
		name = filepath.Base(filepath.FromSlash(name))
	}
	parent := filepath.ToSlash(filepath.Dir(filepath.FromSlash(strings.TrimSpace(rel))))
	if parent == "." || parent == "" {
		return name
	}
	return parent + "/" + name
}

func applyFileOp(ws *workspace.Service, name string, in fileArgs, writeID string) (ToolResult, []string, string, error) {
	switch name {
	case "list_tree":
		listing, err := ws.ListTree()
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		listing = workspace.CompactListingForAgent(listing, workspace.AgentTreeMaxChildren)
		return OKData(listing), nil, "", nil
	case "read_file":
		body, err := ws.ReadText(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(body), nil, "", nil
	case "grep":
		hits, err := ws.Grep(workspace.GrepOpts{
			Pattern:         in.Pattern,
			Path:            in.Path,
			Glob:            in.Glob,
			CaseInsensitive: in.CaseInsensitive,
			Regex:           in.Regex,
			MaxMatches:      int(in.MaxMatches),
		})
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		rows := make([]map[string]any, 0, len(hits))
		for _, h := range hits {
			rows = append(rows, map[string]any{"path": h.RelPath, "line": h.Line, "text": h.Text})
		}
		return OKData(map[string]any{"count": len(rows), "hits": rows}), nil, "", nil
	case "write_file":
		rel, err := cleanFileRel(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		if err := ws.WriteText(rel, in.Content, writeID); err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(formatWrote(rel, in.Content, writeID)), []string{rel}, "update", nil
	case "edit":
		rel, err := cleanFileRel(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		body, err := ws.ReadText(rel)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		next, n, err := workspace.ApplyEdit(body, in.OldString, in.NewString, in.ReplaceAll)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		if err := ws.WriteText(rel, next, writeID); err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(formatEdited(rel, n, next, writeID)), []string{rel}, "update", nil
	case "mkdir":
		rel, err := cleanFileRel(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		if err := ws.Mkdir(rel, writeID); err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(fmt.Sprintf("mkdir %s writeId=%s", rel, writeID)), []string{rel}, "create", nil
	case "create_file":
		rel, err := cleanFileRel(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		if err := ws.CreateFile(rel, writeID); err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(fmt.Sprintf("created %s writeId=%s", rel, writeID)), []string{rel}, "create", nil
	case "rename_path":
		res, err := ws.Rename(in.RelPath, in.NewName, writeID)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(res), mutationIDs(res), "update", nil
	case "move_path":
		res, err := ws.Move(in.FromRel, in.ToRel, writeID)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(res), mutationIDs(res), "update", nil
	case "copy_path":
		res, err := ws.Copy(in.FromRel, in.ToRel, writeID)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(res), mutationIDs(res), "create", nil
	case "delete_path":
		rel, err := cleanFileRel(in.RelPath)
		if err != nil {
			return ToolResult{}, nil, "", err
		}
		if err := ws.Delete(rel, writeID); err != nil {
			return ToolResult{}, nil, "", err
		}
		return OKData(fmt.Sprintf("deleted %s writeId=%s", rel, writeID)), []string{rel}, "delete", nil
	case "batch_delete_paths":
		res := ws.BatchDelete(in.RelPaths, writeID)
		return OKData(res), res.OK, "delete", nil
	case "batch_move_paths":
		res := ws.BatchMove(in.RelPaths, in.DestDir, writeID)
		return OKData(res), mutationIDs(res), "create", nil
	default:
		return ToolResult{}, nil, "", fmt.Errorf("未知文件工具: %s", name)
	}
}

func mutationIDs(res workspace.MutationResult) []string {
	if len(res.MovedTo) > 0 {
		ids := make([]string, 0, len(res.MovedTo)*2)
		for from, to := range res.MovedTo {
			ids = append(ids, from, to)
		}
		return ids
	}
	return res.OK
}

func formatWrote(rel, content, writeID string) string {
	msg := fmt.Sprintf("Successfully wrote '%s'（%d 字）", rel, workspace.Count(content))
	if writeID != "" {
		msg += " writeId=" + writeID
	}
	return msg
}

func formatEdited(rel string, n int, content, writeID string) string {
	return workspace.FormatEditOK(rel, n, content, writeID)
}

func emitNotebookFileOps(d *Deps, op string, ids []string, writeID string) {
	if d == nil || d.Radar == nil || op == "" || len(ids) == 0 {
		return
	}
	d.Radar.EmitNotebookPath(op, ids, writeID, "", false)
}

// resolveFileRoot 把 root 解析成绝对目录。project 拒绝 / 与用户主目录。
func resolveFileRoot(d *Deps, root string) (abs, kind string, err error) {
	kind = strings.TrimSpace(strings.ToLower(root))
	if kind == "" {
		kind = "project"
	}
	switch kind {
	case "project":
		if d == nil || d.Store == nil {
			return "", "", fmt.Errorf("没有当前舞台项目")
		}
		id, _ := d.Store.GetAppSetting(store.SettingLastWorkbenchProjectID)
		id = strings.TrimSpace(id)
		if id == "" {
			return "", "", fmt.Errorf("没有当前舞台项目")
		}
		p, err := d.Store.GetWorkbenchProject(id)
		if err != nil || strings.TrimSpace(p.LocalPath) == "" {
			return "", "", fmt.Errorf("没有当前舞台项目")
		}
		abs, err = filepath.Abs(filepath.Clean(p.LocalPath))
		if err != nil {
			return "", "", fmt.Errorf("项目路径无效")
		}
		if err := rejectStageRoot(abs); err != nil {
			return "", "", err
		}
		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			return "", "", fmt.Errorf("项目路径不是目录")
		}
		return abs, kind, nil
	case "notebook":
		if d == nil || d.Notebook == nil {
			return "", "", fmt.Errorf("笔记本未就绪")
		}
		abs = strings.TrimSpace(d.Notebook.WorkspacePath())
		if abs == "" {
			return "", "", fmt.Errorf("笔记本未就绪")
		}
		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			return "", "", fmt.Errorf("笔记本路径不是目录")
		}
		return abs, kind, nil
	case "harness":
		if d == nil || d.HarnessRoot == nil {
			return "", "", fmt.Errorf("harness 未就绪")
		}
		abs = strings.TrimSpace(d.HarnessRoot())
		if abs == "" {
			return "", "", fmt.Errorf("harness 未就绪")
		}
		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			return "", "", fmt.Errorf("harness 路径不是目录")
		}
		return abs, kind, nil
	default:
		return "", "", fmt.Errorf("root 只能是 project、notebook 或 harness")
	}
}

func rejectStageRoot(abs string) error {
	abs = filepath.Clean(abs)
	if abs == "/" || abs == string(filepath.Separator) {
		return fmt.Errorf("项目根不能是 /")
	}
	home, err := os.UserHomeDir()
	if err == nil && home != "" && filepath.Clean(home) == abs {
		return fmt.Errorf("项目根不能是用户主目录")
	}
	return nil
}

func cleanFileRel(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", fmt.Errorf("路径为空")
	}
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("路径越出根目录: %s", rel)
	}
	return cleaned, nil
}

func pathsAreHarnessSkills(rels []string) bool {
	if len(rels) == 0 {
		return false
	}
	for _, rel := range rels {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if rel == "" || !strings.HasPrefix(rel, "system/skills/") {
			return false
		}
	}
	return true
}

func relsHardData(rels []string) bool {
	for _, rel := range rels {
		if relHardData(rel) {
			return true
		}
	}
	return false
}

func relHardData(rel string) bool {
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimSpace(rel))))
	rel = strings.TrimPrefix(rel, "/")
	base := strings.ToLower(filepath.Base(rel))
	if strings.HasSuffix(base, ".db") || base == ".env" || strings.HasPrefix(base, ".env.") {
		return true
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == "data" {
			return true
		}
	}
	return false
}

func previewHardRisk(data json.RawMessage) bool {
	if len(data) == 0 {
		return false
	}
	var m map[string]any
	if json.Unmarshal(data, &m) != nil {
		return false
	}
	v, ok := m["hardRisk"].(bool)
	return ok && v
}
