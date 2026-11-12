package notebook

import (
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

func pathUnescape(s string) (string, error) {
	return url.PathUnescape(s)
}

const (
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

// AssetHandler 提供工作区内附件只读访问：/notebook-assets/{noteId}/{file}
// Skill 附件落在 工作流/{name}/assets/；普通笔记落在 {note}.assets/。
func AssetHandler(dataDir string) http.Handler {
	svc := &Service{dataDir: dataDir}
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
		if u, err := pathUnescape(rel); err == nil {
			rel = u
		}
		rel = strings.TrimPrefix(filepath.Clean("/"+rel), "/")
		if rel == "" || strings.HasPrefix(rel, "..") {
			http.NotFound(w, r)
			return
		}
		// noteId/file — noteId 可能含路径（普通笔记）
		slash := strings.LastIndex(rel, "/")
		if slash <= 0 || slash == len(rel)-1 {
			http.NotFound(w, r)
			return
		}
		noteID := rel[:slash]
		fileName := rel[slash+1:]
		if strings.Contains(fileName, "/") || fileName == ".." || fileName == "." {
			http.NotFound(w, r)
			return
		}
		_, assetsDir, err := svc.notePaths(noteID)
		if err != nil || assetsDir == "" {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(assetsDir, fileName)
		if !strings.HasPrefix(full, assetsDir+string(filepath.Separator)) {
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

// SaveAsset 将 base64 内容写入该笔记同级附件目录。
func (s *Service) SaveAsset(in model.NotebookAssetUploadDO) (*model.NotebookAssetDO, error) {
	noteID := strings.TrimSpace(in.NoteID)
	if noteID == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", "")
	}
	if _, err := s.GetNote(noteID); err != nil {
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
	_, assetsDir, err := s.notePaths(noteID)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(assetsDir, 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建附件目录失败", err)
	}
	path := filepath.Join(assetsDir, stored)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "写入附件失败", err)
	}
	displayName := name
	if filepath.Ext(displayName) == "" && ext != "" {
		displayName += ext
	}
	url := assetsURLPrefix + noteID + "/" + stored
	// 正文真源用相对路径（Skill→assets/；普通笔记→{stem}.assets/）；预览再映射到 URL。
	relLink := SkillAssetsDir + "/" + stored
	if !isSkillPathID(noteID) {
		contentPath, _, _ := s.notePaths(noteID)
		stem := strings.TrimSuffix(filepath.Base(contentPath), filepath.Ext(contentPath))
		if stem == "" {
			stem = "note"
		}
		relLink = stem + PlainAssetsSuffix + "/" + stored
	}
	md := buildAssetMarkdown(displayName, relLink, isImage)
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

// DeleteNoteAssets 删除笔记附件目录。
func (s *Service) DeleteNoteAssets(noteID string) {
	_, assetsDir, err := s.notePaths(strings.TrimSpace(noteID))
	if err != nil || assetsDir == "" {
		return
	}
	_ = os.RemoveAll(assetsDir)
}

// ListNoteAssets 列出笔记附件。
func (s *Service) ListNoteAssets(noteID string) ([]model.NotebookAssetDO, error) {
	noteID = strings.TrimSpace(noteID)
	_, assetsDir, err := s.notePaths(noteID)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(assetsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.NotebookAssetDO{}, nil
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取附件目录失败", err)
	}
	out := make([]model.NotebookAssetDO, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		mimeType := mime.TypeByExtension(filepath.Ext(name))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		url := assetsURLPrefix + noteID + "/" + name
		isImage := isImageMIME(mimeType)
		id := strings.TrimSuffix(name, filepath.Ext(name))
		out = append(out, model.NotebookAssetDO{
			ID: id, NoteID: noteID, Name: name, MIME: mimeType,
			URL: url, Markdown: buildAssetMarkdown(name, url, isImage),
			IsImage: isImage, Size: info.Size(),
		})
	}
	return out, nil
}

// NoteAssetsDir 返回笔记附件绝对目录。
func (s *Service) NoteAssetsDir(noteID string) string {
	_, dir, err := s.notePaths(strings.TrimSpace(noteID))
	if err != nil {
		return ""
	}
	return dir
}

// SkillDiskPath 返回 Skill 目录绝对路径（供提示；任意业务根）。
func (s *Service) SkillDiskPath(skillName string) string {
	skillName = strings.TrimSpace(skillName)
	noteID := SkillNoteID(skillName)
	if found := s.FindNoteIDBySkillID(skillName); found != "" {
		noteID = found
	}
	dir, _, ok := s.skillDirAbs(noteID)
	if !ok {
		return ""
	}
	return dir
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
