package agent

import (
	"encoding/base64"
	"fmt"
	"strings"

	"WWorkbench/internal/model"

	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/history"
	"github.com/wcoreing/ningharness/resource"
)

const (
	maxChatImages     = 4
	maxChatImageBytes = 4 << 20
	imageOnlyPrompt   = "（图片）"
)

var allowedImageMIME = map[string]string{
	"image/png":  "image/png",
	"image/jpeg": "image/jpeg",
	"image/jpg":  "image/jpeg",
	"image/webp": "image/webp",
	"image/gif":  "image/gif",
}

// normalizeChatImages 校验并规范化附件（不按模型名白名单拦截）。
func normalizeChatImages(in []model.AgentChatImageDO) ([]model.AgentChatImageDO, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > maxChatImages {
		return nil, fmt.Errorf("一次最多 %d 张图片", maxChatImages)
	}
	out := make([]model.AgentChatImageDO, 0, len(in))
	for i, img := range in {
		mime, data, err := splitImagePayload(img.MIME, img.Data)
		if err != nil {
			return nil, fmt.Errorf("第 %d 张图片: %w", i+1, err)
		}
		raw, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			raw, err = base64.RawStdEncoding.DecodeString(data)
		}
		if err != nil {
			return nil, fmt.Errorf("第 %d 张图片不是合法 base64", i+1)
		}
		if len(raw) == 0 {
			continue
		}
		if len(raw) > maxChatImageBytes {
			return nil, fmt.Errorf("第 %d 张图片超过 %dMB", i+1, maxChatImageBytes>>20)
		}
		out = append(out, model.AgentChatImageDO{MIME: mime, Data: data})
	}
	return out, nil
}

func splitImagePayload(mime, data string) (string, string, error) {
	data = strings.TrimSpace(data)
	mime = strings.TrimSpace(strings.ToLower(mime))
	if strings.HasPrefix(data, "data:") {
		head, b64, ok := strings.Cut(data, ",")
		if !ok {
			return "", "", fmt.Errorf("data URL 无效")
		}
		data = strings.TrimSpace(b64)
		if i := strings.Index(head, ":"); i >= 0 {
			rest := head[i+1:]
			if j := strings.Index(rest, ";"); j >= 0 {
				mime = strings.ToLower(strings.TrimSpace(rest[:j]))
			} else {
				mime = strings.ToLower(strings.TrimSpace(rest))
			}
		}
	}
	canon, ok := allowedImageMIME[mime]
	if !ok {
		return "", "", fmt.Errorf("仅支持 PNG / JPEG / WebP / GIF")
	}
	if data == "" {
		return "", "", fmt.Errorf("内容为空")
	}
	return canon, data, nil
}

func putUserImages(root, sessionID, taskID string, images []model.AgentChatImageDO) ([]history.ImageRef, error) {
	refs := make([]history.ImageRef, 0, len(images))
	for _, img := range images {
		id, _, err := resource.Put(root, resource.PutInput{
			SessionKey: sessionID,
			TaskID:     taskID,
			Kind:       resource.KindUserImage,
			RelPath:    img.MIME,
			Body:       img.Data,
			ToolName:   "user_image",
		})
		if err != nil {
			return nil, err
		}
		refs = append(refs, history.ImageRef{ID: id, MIME: img.MIME})
	}
	return refs, nil
}

func loadUserImages(root string, refs []history.ImageRef) []guest.UserImage {
	if root == "" || len(refs) == 0 {
		return nil
	}
	out := make([]guest.UserImage, 0, len(refs))
	for _, ref := range refs {
		rec, err := resource.Get(root, ref.ID)
		if err != nil || rec == nil {
			continue
		}
		mime := strings.TrimSpace(ref.MIME)
		if rec.RelPath != "" {
			mime = rec.RelPath
		}
		data := strings.TrimSpace(rec.Body)
		if mime == "" || data == "" {
			continue
		}
		out = append(out, guest.UserImage{MIME: mime, Data: data})
	}
	return out
}

func firstLineTitle(msg string, hasImage bool) string {
	msg = strings.TrimSpace(msg)
	if msg == "" && hasImage {
		return "图片"
	}
	return msg
}

func previewImages(images []model.AgentChatImageDO) []map[string]string {
	out := make([]map[string]string, 0, len(images))
	for _, img := range images {
		out = append(out, map[string]string{
			"mime": img.MIME,
			"data": "data:" + img.MIME + ";base64," + img.Data,
		})
	}
	return out
}

func messageImagesFromContent(root, content string) (string, []model.AgentChatImageDO) {
	text, refs := history.SplitImageRefs(content)
	if text == imageOnlyPrompt {
		text = ""
	}
	if len(refs) == 0 {
		return text, nil
	}
	blobs := loadUserImages(root, refs)
	out := make([]model.AgentChatImageDO, 0, len(blobs))
	for _, b := range blobs {
		out = append(out, model.AgentChatImageDO{
			MIME: b.MIME,
			Data: "data:" + b.MIME + ";base64," + b.Data,
		})
	}
	return text, out
}
