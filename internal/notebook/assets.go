package notebook

import (
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const (
	assetsDirName      = "notebook-assets"
	assetsURLPrefix    = "/notebook-assets/"
	maxImageBytes      = 12 << 20
	maxAttachmentBytes = 50 << 20
)

var imageMIME = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/jpg":  ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// AssetHandler 通过 Wails AssetServer 提供笔记附件只读访问。
func AssetHandler(dataDir string) http.Handler {
	root := filepath.Clean(filepath.Join(dataDir, assetsDirName))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, assetsURLPrefix)
		if rel == r.URL.Path || rel == "" {
			http.NotFound(w, r)
			return
		}
		rel = filepath.Clean("/" + rel)
		rel = strings.TrimPrefix(rel, string(filepath.Separator))
		if rel == "" || strings.HasPrefix(rel, "..") {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(root, rel)
		if !strings.HasPrefix(full, root+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		mimeType := mime.TypeByExtension(filepath.Ext(full))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", mimeType)
		if isImageMIME(mimeType) {
			w.Header().Set("Content-Disposition", "inline")
		} else {
			w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filepath.Base(full)))
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		http.ServeFile(w, r, full)
	})
}

// SaveAsset 将 base64 内容写入笔记附件目录，返回 Markdown 片段与访问 URL。
func (s *Service) SaveAsset(in model.NotebookAssetUploadDO) (*model.NotebookAssetDO, error) {
	noteID := strings.TrimSpace(in.NoteID)
	if noteID == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", "")
	}
	if _, err := s.store.GetNote(noteID); err != nil {
		return nil, err
	}
	name := sanitizeFileName(in.Name)
	if name == "" {
		name = "file"
	}
	raw, mimeType, err := decodeAssetPayload(in.MIME, in.Data)
	if err != nil {
		return nil, err
	}
	isImage := isImageMIME(mimeType)
	limit := maxAttachmentBytes
	if isImage {
		limit = maxImageBytes
	}
	if len(raw) == 0 {
		return nil, errno.New(errno.CodeInvalidArg, "文件内容为空", "")
	}
	if len(raw) > limit {
		return nil, errno.New(errno.CodeInvalidArg, fmt.Sprintf("文件超过 %dMB 上限", limit>>20), name)
	}
	ext := extensionFor(name, mimeType, raw)
	assetID := uuid.NewString()
	stored := assetID + ext
	dir := s.noteAssetsDir(noteID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建附件目录失败", err)
	}
	path := filepath.Join(dir, stored)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "写入附件失败", err)
	}
	displayName := name
	if filepath.Ext(displayName) == "" && ext != "" {
		displayName += ext
	}
	url := assetsURLPrefix + noteID + "/" + stored
	md := buildAssetMarkdown(displayName, url, isImage)
	return &model.NotebookAssetDO{
		ID:       assetID,
		NoteID:   noteID,
		Name:     displayName,
		MIME:     mimeType,
		URL:      url,
		Markdown: md,
		IsImage:  isImage,
		Size:     int64(len(raw)),
	}, nil
}

// DeleteNoteAssets 删除笔记目录下全部附件（忽略不存在）。
func (s *Service) DeleteNoteAssets(noteID string) {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" || s.dataDir == "" {
		return
	}
	_ = os.RemoveAll(s.noteAssetsDir(noteID))
}

func (s *Service) noteAssetsDir(noteID string) string {
	return filepath.Join(s.dataDir, assetsDirName, noteID)
}

func decodeAssetPayload(mimeHint, data string) ([]byte, string, error) {
	data = strings.TrimSpace(data)
	mimeType := strings.TrimSpace(strings.ToLower(mimeHint))
	if strings.HasPrefix(data, "data:") {
		head, b64, ok := strings.Cut(data, ",")
		if !ok {
			return nil, "", errno.New(errno.CodeInvalidArg, "data URL 无效", "")
		}
		data = strings.TrimSpace(b64)
		if i := strings.Index(head, ":"); i >= 0 {
			rest := head[i+1:]
			if j := strings.Index(rest, ";"); j >= 0 {
				mimeType = strings.ToLower(strings.TrimSpace(rest[:j]))
			} else {
				mimeType = strings.ToLower(strings.TrimSpace(rest))
			}
		}
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(data)
	}
	if err != nil {
		return nil, "", errno.New(errno.CodeInvalidArg, "文件不是合法 base64", "")
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		detected := http.DetectContentType(raw)
		if detected != "" && detected != "application/octet-stream" {
			mimeType = detected
		}
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return raw, mimeType, nil
}

func extensionFor(name, mimeType string, raw []byte) string {
	if ext := strings.ToLower(filepath.Ext(name)); ext != "" && len(ext) <= 12 {
		return ext
	}
	if ext, ok := imageMIME[mimeType]; ok {
		return ext
	}
	if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
		return exts[0]
	}
	if detected := http.DetectContentType(raw); detected != "" {
		if ext, ok := imageMIME[detected]; ok {
			return ext
		}
		if exts, _ := mime.ExtensionsByType(detected); len(exts) > 0 {
			return exts[0]
		}
	}
	return ""
}

func buildAssetMarkdown(name, url string, isImage bool) string {
	safe := strings.ReplaceAll(name, "]", "")
	safe = strings.ReplaceAll(safe, "[", "")
	if isImage {
		return fmt.Sprintf("![%s](%s)", safe, url)
	}
	return fmt.Sprintf("[%s](%s)", safe, url)
}

func isImageMIME(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if _, ok := imageMIME[mimeType]; ok {
		return true
	}
	return strings.HasPrefix(mimeType, "image/") && mimeType != "image/svg+xml"
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
	if out == "" {
		return ""
	}
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
