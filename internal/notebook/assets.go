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

	"WWorkbench/internal/errno"
	"WWorkbench/internal/file"
	"WWorkbench/internal/model"
	"WWorkbench/internal/resource"
)

func pathUnescape(s string) (string, error) {
	return url.PathUnescape(s)
}

const (
	assetsURLPrefix = "/notebook-assets/"
	// maxImageBytes 图片笔记内联预览上限（与资源服务的图片上限一致）。
	maxImageBytes = 12 << 20
)

// AssetHandler 提供工作区内附件只读访问：/notebook-assets/{noteId}/{file}
// Skill 附件落在技能目录 assets/；普通笔记落在同名目录 assets/。
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
		full, err := svc.AssetFilePath(noteID, fileName)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		mimeType := mime.TypeByExtension(filepath.Ext(full))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", mimeType)
		if resource.IsImageMIME(mimeType) {
			w.Header().Set("Content-Disposition", "inline")
		} else {
			w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filepath.Base(full)))
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		http.ServeFile(w, r, full)
	})
}

// SaveAsset 将 base64 内容交给资源服务落盘。
func (s *Service) SaveAsset(in model.NotebookAssetUploadDO) (*model.NotebookAssetDO, error) {
	slot, err := s.assetSlot(in.NoteID)
	if err != nil {
		return nil, err
	}
	raw, mimeType, err := decodeAssetPayload(in.MIME, in.Data)
	if err != nil {
		return nil, err
	}
	item, err := s.resources.Put(slot, in.Name, mimeType, raw)
	if err != nil {
		return nil, err
	}
	out := assetDO(slot.OwnerID, item)
	return &out, nil
}

// ImportAssets 把本机文件复制进该笔记的资源目录。
func (s *Service) ImportAssets(noteID string, paths []string) ([]model.NotebookAssetDO, error) {
	slot, err := s.assetSlot(noteID)
	if err != nil {
		return nil, err
	}
	items, err := s.resources.Import(slot, paths)
	if err != nil {
		return nil, err
	}
	return assetDOList(slot.OwnerID, items), nil
}

// ListAssets 列出笔记仍在磁盘上的本地资源。
func (s *Service) ListAssets(noteID string) ([]model.NotebookAssetDO, error) {
	slot, err := s.assetSlot(noteID)
	if err != nil {
		return nil, err
	}
	items, err := s.resources.List(slot)
	if err != nil {
		return nil, err
	}
	return assetDOList(slot.OwnerID, items), nil
}

// DeleteAsset 删除一条本地资源（账本 + 文件）。
func (s *Service) DeleteAsset(id string) error {
	if s.resources == nil {
		return errno.New(errno.CodeStoreFailed, "资源服务未就绪", "")
	}
	return s.resources.Delete(id, s.locateOwner)
}

// AssetFilePath 解析预览链接 /notebook-assets/{noteID}/{file} 对应的磁盘文件。
func (s *Service) AssetFilePath(noteID, fileName string) (string, error) {
	noteID = strings.TrimSpace(noteID)
	fileName = strings.TrimSpace(fileName)
	if noteID == "" || fileName == "" || strings.Contains(fileName, "/") || fileName == "." || fileName == ".." {
		return "", errno.New(errno.CodeInvalidArg, "附件路径无效", fileName)
	}
	_, assetsDir, err := s.notePaths(noteID)
	if err != nil {
		return "", err
	}
	if assetsDir == "" {
		return "", errno.New(errno.CodeNotFound, "附件目录不存在", noteID)
	}
	full := filepath.Join(assetsDir, fileName)
	if !strings.HasPrefix(full, assetsDir+string(filepath.Separator)) {
		return "", errno.New(errno.CodeInvalidArg, "附件路径无效", fileName)
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return "", errno.New(errno.CodeNotFound, "附件不存在", fileName)
	}
	return full, nil
}

// AssetAbsPath 返回资源文件绝对路径。
func (s *Service) AssetAbsPath(id string) (string, error) {
	if s.resources == nil {
		return "", errno.New(errno.CodeStoreFailed, "资源服务未就绪", "")
	}
	return s.resources.AbsPath(id, s.locateOwner)
}

// DeleteNoteAssets 删除笔记附件目录，并清掉资源账本。
func (s *Service) DeleteNoteAssets(noteID string) {
	s.forgetAssets(noteID)
	_, assetsDir, err := s.notePaths(strings.TrimSpace(noteID))
	if err != nil || assetsDir == "" {
		return
	}
	_ = os.RemoveAll(assetsDir)
}

// ListNoteAssets 列出笔记资源（与 ListAssets 相同）。
func (s *Service) ListNoteAssets(noteID string) ([]model.NotebookAssetDO, error) {
	return s.ListAssets(noteID)
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

// assetSlot 把文档路径解析成资源落点。归属是文件 ID，目录约定在 file.Placement。
func (s *Service) assetSlot(noteID string) (resource.Slot, error) {
	if s == nil || s.files == nil || s.resources == nil {
		return resource.Slot{}, errno.New(errno.CodeStoreFailed, "文件服务未就绪", "")
	}
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return resource.Slot{}, errno.New(errno.CodeInvalidArg, "文档 ID 不能为空", "")
	}
	if _, err := s.GetNote(noteID); err != nil {
		return resource.Slot{}, err
	}
	return s.placeDocument(noteID)
}

// locateOwner 资源删除/打开时按文件 ID 找回落点。旧账本里的路径归属仍可解析。
func (s *Service) locateOwner(ownerID string) (resource.Slot, error) {
	if s != nil && s.files != nil {
		if f, err := s.files.ByID(ownerID); err == nil {
			return s.placeFile(f)
		}
	}
	return s.placeDocument(ownerID)
}

func (s *Service) placeDocument(noteID string) (resource.Slot, error) {
	contentPath, _, err := s.notePaths(noteID)
	if err != nil {
		return resource.Slot{}, err
	}
	rel, err := filepath.Rel(s.workspaceRoot(), contentPath)
	if err != nil {
		return resource.Slot{}, errno.Wrap(errno.CodeInvalidArg, "文档路径无效", err)
	}
	f, err := s.files.Ensure(filepath.ToSlash(rel))
	if err != nil {
		return resource.Slot{}, err
	}
	return s.placeFile(f)
}

func (s *Service) placeFile(f file.File) (resource.Slot, error) {
	place, err := file.Placement(s.workspaceRoot(), f)
	if err != nil {
		return resource.Slot{}, err
	}
	return resource.Slot{OwnerID: place.FileID, Dir: place.Dir, LinkPrefix: place.LinkPrefix}, nil
}

func (s *Service) indexDocument(noteID string) {
	if s == nil || s.files == nil {
		return
	}
	contentPath, _, err := s.notePaths(noteID)
	if err != nil || contentPath == "" {
		return
	}
	rel, err := filepath.Rel(s.workspaceRoot(), contentPath)
	if err != nil {
		return
	}
	_, _ = s.files.Ensure(filepath.ToSlash(rel))
}

func (s *Service) rebaseDocuments(fromAbs, toAbs string) {
	if s == nil || s.files == nil {
		return
	}
	fromRel, err1 := filepath.Rel(s.workspaceRoot(), fromAbs)
	toRel, err2 := filepath.Rel(s.workspaceRoot(), toAbs)
	if err1 != nil || err2 != nil {
		return
	}
	_ = s.files.Rebase(filepath.ToSlash(fromRel), filepath.ToSlash(toRel))
}

func (s *Service) forgetAssets(noteID string) {
	if s == nil || s.resources == nil {
		return
	}
	noteID = strings.TrimSpace(noteID)
	_ = s.resources.ForgetOwner(noteID)
	if s.files != nil {
		if ids, err := s.files.ForgetTree(noteID); err == nil {
			for _, id := range ids {
				_ = s.resources.ForgetOwner(id)
			}
		}
	}
	contentPath, _, err := s.notePaths(noteID)
	if err != nil || contentPath == "" {
		return
	}
	rel, err := filepath.Rel(s.workspaceRoot(), contentPath)
	if err != nil {
		return
	}
	rel = filepath.ToSlash(rel)
	_ = s.resources.ForgetOwner(rel)
	if s.files == nil {
		return
	}
	if ids, err := s.files.ForgetTree(rel); err == nil {
		for _, id := range ids {
			_ = s.resources.ForgetOwner(id)
		}
	}
	if !isSkillPathID(noteID) {
		return
	}
	if dir := filepath.ToSlash(filepath.Dir(rel)); dir != "" && dir != "." {
		s.dropFileTree(dir)
	}
}

func (s *Service) dropFileTree(rel string) {
	if s == nil || s.files == nil {
		return
	}
	ids, err := s.files.ForgetTree(rel)
	if err != nil || s.resources == nil {
		return
	}
	for _, id := range ids {
		_ = s.resources.ForgetOwner(id)
	}
}

func assetDOList(noteID string, items []resource.Item) []model.NotebookAssetDO {
	out := make([]model.NotebookAssetDO, 0, len(items))
	for _, it := range items {
		out = append(out, assetDO(noteID, it))
	}
	return out
}

func assetDO(noteID string, it resource.Item) model.NotebookAssetDO {
	return model.NotebookAssetDO{
		ID:       it.ID,
		NoteID:   noteID,
		Name:     it.Name,
		MIME:     it.MIME,
		URL:      assetsURLPrefix + noteID + "/" + it.File,
		Markdown: it.Markdown(),
		IsImage:  resource.IsImageMIME(it.MIME),
		Size:     it.Size,
	}
}
