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

// languageFromFilename 按磁盘文件名推断 language。
func languageFromFilename(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if strings.HasSuffix(lower, ".skill.md") {
		return "skill.md"
	}
	// 历史误伤 index.js.md：内层已有扩展则按内层识别
	if strings.HasSuffix(lower, ".md") {
		inner := strings.TrimSuffix(filepath.Base(lower), filepath.Ext(lower))
		if filepath.Ext(inner) != "" {
			return languageFromFilename(inner)
		}
	}
	switch strings.ToLower(filepath.Ext(lower)) {
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
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(lower)), ".")
		if ext == "" {
			return "markdown"
		}
		return ext
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
	// index.js.md → 标题 index（再剥一层）
	if strings.EqualFold(ext, ".md") && filepath.Ext(stem) != "" {
		return titleFromFilename(stem)
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
