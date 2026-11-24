// Package resource 本地资源服务：字节落在笔记/Skill 附件目录，账本在数据目录 resources/catalog.json。
// Markdown 只保留相对链接，不把文件内容写进正文。
package resource

import (
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"unicode"

	"WWorkbench/internal/errno"
)

const (
	maxImageBytes      = 12 << 20
	maxAttachmentBytes = 50 << 20
)

// Slot 一次写入的落点。Dir 为附件绝对目录，LinkPrefix 为正文相对前缀（assets，或 {stem}/assets）。
type Slot struct {
	OwnerID    string
	Dir        string
	LinkPrefix string
}

// Item 已落盘的资源。File 为附件目录内的文件名。
type Item struct {
	ID         string `json:"id"`
	OwnerID    string `json:"ownerId"`
	Name       string `json:"name"`
	File       string `json:"file"`
	MIME       string `json:"mime"`
	Size       int64  `json:"size"`
	LinkPrefix string `json:"linkPrefix"`
	CreatedAt  int64  `json:"createdAt"`
}

// RelLink 正文使用的相对路径。
func (it Item) RelLink() string {
	return strings.Trim(it.LinkPrefix, "/") + "/" + it.File
}

// Markdown 插入笔记的链接。图片用 ![]()，其余用 []()。
func (it Item) Markdown() string {
	name := strings.NewReplacer("[", "", "]", "").Replace(it.Name)
	if name == "" {
		name = it.File
	}
	if IsImageMIME(it.MIME) {
		return fmt.Sprintf("![%s](%s)", name, it.RelLink())
	}
	return fmt.Sprintf("[%s](%s)", name, it.RelLink())
}

func (slot Slot) validate() error {
	if strings.TrimSpace(slot.OwnerID) == "" {
		return errno.New(errno.CodeInvalidArg, "资源归属不能为空", "")
	}
	dir := strings.TrimSpace(slot.Dir)
	if dir == "" || !filepath.IsAbs(dir) {
		return errno.New(errno.CodeInvalidArg, "附件目录无效", slot.Dir)
	}
	prefix := strings.Trim(strings.TrimSpace(slot.LinkPrefix), "/")
	if prefix == "" || strings.Contains(prefix, `\`) || strings.Contains(prefix, "..") {
		return errno.New(errno.CodeInvalidArg, "资源链接前缀无效", slot.LinkPrefix)
	}
	for _, seg := range strings.Split(prefix, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return errno.New(errno.CodeInvalidArg, "资源链接前缀无效", slot.LinkPrefix)
		}
	}
	return nil
}

// IsImageMIME 是否按图片插入 Markdown（不含 svg）。
func IsImageMIME(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch mimeType {
	case "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif":
		return true
	default:
		return strings.HasPrefix(mimeType, "image/") && mimeType != "image/svg+xml"
	}
}

// IsImageExt 按扩展名判断图片（选择文件时用，避免先拷贝再丢弃）。
func IsImageExt(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return true
	default:
		return false
	}
}

func sanitizeFileName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." || name == ".." {
		return ""
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '/' || r == '\\' || r == 0:
			continue
		case unicode.IsControl(r):
			continue
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if len(out) > 120 {
		ext := filepath.Ext(out)
		base := strings.TrimSuffix(out, ext)
		if len(base) > 100 {
			base = base[:100]
		}
		out = base + ext
	}
	return out
}

func sniffMIME(name, hint string, raw []byte) string {
	mimeType := strings.ToLower(strings.TrimSpace(hint))
	if mimeType == "" || mimeType == "application/octet-stream" {
		if ext := filepath.Ext(name); ext != "" {
			if t := mime.TypeByExtension(ext); t != "" {
				mimeType = strings.ToLower(t)
			}
		}
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		if detected := http.DetectContentType(raw); detected != "" {
			mimeType = strings.ToLower(detected)
		}
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return mimeType
}

func extensionFor(name, mimeType string, raw []byte) string {
	if ext := strings.ToLower(filepath.Ext(name)); ext != "" && len(ext) <= 12 && ext != "." {
		return ext
	}
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
		return exts[0]
	}
	if detected := http.DetectContentType(raw); detected != "" && detected != mimeType {
		if exts, _ := mime.ExtensionsByType(detected); len(exts) > 0 {
			return exts[0]
		}
	}
	return ""
}
