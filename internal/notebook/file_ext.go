package notebook

import (
	"path/filepath"
	"strings"
)

// ensureNoteDiskName 无扩展名时默认 .md；已有任意扩展则原样保留（不强制 .md）。
func ensureNoteDiskName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	if filepath.Ext(name) != "" {
		return name
	}
	return name + ".md"
}

// isNotebookContentFile 是否纳入笔记本文件树扫描。
func isNotebookContentFile(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return false
	}
	if strings.HasSuffix(lower, ".skill.md") {
		return true
	}
	switch strings.ToLower(filepath.Ext(lower)) {
	case ".md", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
		".py", ".sh", ".bash", ".zsh", ".json", ".yaml", ".yml",
		".sql", ".html", ".htm", ".css", ".txt", ".toml", ".ini",
		".dockerfile":
		return true
	default:
		return false
	}
}

// knownNotebookExt 是否为笔记本识别的真实内容扩展（避免 IP/版本号里的点被当成扩展）。
func knownNotebookExt(ext string) bool {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".md", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
		".py", ".sh", ".bash", ".zsh", ".json", ".yaml", ".yml",
		".sql", ".html", ".htm", ".css", ".txt", ".toml", ".ini",
		".dockerfile":
		return true
	default:
		return false
	}
}

// languageFromFilename 按磁盘文件名推断 language。
func languageFromFilename(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if strings.HasSuffix(lower, ".skill.md") {
		return "skill.md"
	}
	// 仅当内层是已知内容扩展时才剥（index.js.md → javascript）；
	// 禁止把 172.19.201·整理.md 误判成 language=201·整理。
	if strings.HasSuffix(lower, ".md") {
		inner := strings.TrimSuffix(filepath.Base(lower), filepath.Ext(lower))
		if e := filepath.Ext(inner); e != "" && knownNotebookExt(e) {
			return languageFromFilename(inner)
		}
	}
	ext := filepath.Ext(lower)
	if !knownNotebookExt(ext) {
		// 未知「扩展」（含 IP/版本号里的点）按 markdown 笔记处理
		return "markdown"
	}
	switch strings.ToLower(ext) {
	case ".md":
		return "markdown"
	case ".js", ".mjs", ".cjs", ".jsx":
		return "javascript"
	case ".ts", ".tsx":
		return "typescript"
	case ".py":
		return "python"
	case ".sh", ".bash", ".zsh":
		return "shell"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".sql":
		return "sql"
	case ".html", ".htm":
		return "html"
	case ".css":
		return "css"
	case ".txt":
		return "plaintext"
	case ".dockerfile":
		return "dockerfile"
	case ".toml", ".ini":
		return "plaintext"
	default:
		return "markdown"
	}
}

// titleFromFilename 侧栏标题（去掉扩展名）。
func titleFromFilename(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, ".skill.md") {
		return base[:len(base)-len(".skill.md")]
	}
	ext := filepath.Ext(base)
	if ext == "" {
		return base
	}
	stem := strings.TrimSuffix(base, ext)
	// index.js.md → 标题 index（仅已知内容扩展再剥一层）
	if strings.EqualFold(ext, ".md") {
		if inner := filepath.Ext(stem); inner != "" && knownNotebookExt(inner) {
			return titleFromFilename(stem)
		}
		return stem
	}
	if !knownNotebookExt(ext) {
		return base
	}
	return stem
}

// extForLanguage 与前端 noteFileTypes.extForLanguage 对齐。
func extForLanguage(language string) string {
	id := strings.ToLower(strings.TrimSpace(language))
	switch id {
	case "", "markdown", "md":
		return ".md"
	case "skill.md":
		return ".skill.md"
	case "shell", "sh", "bash", "zsh":
		return ".sh"
	case "yaml", "yml":
		return ".yaml"
	case "sql":
		return ".sql"
	case "json":
		return ".json"
	case "dockerfile":
		return ".dockerfile"
	case "python", "py":
		return ".py"
	case "plaintext", "text", "txt":
		return ".txt"
	case "javascript", "js", "jsx", "mjs", "cjs":
		return ".js"
	case "typescript", "ts", "tsx":
		return ".ts"
	case "html", "htm":
		return ".html"
	case "css":
		return ".css"
	default:
		if strings.HasPrefix(id, ".") {
			return id
		}
		return "." + id
	}
}
