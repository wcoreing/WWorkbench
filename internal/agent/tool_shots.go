package agent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/desktop"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
	"WWorkbench/internal/workbenchtools"

	"github.com/wcoreing/ningharness/history"
	"github.com/wcoreing/ningharness/resource"
)

const (
	toolShotJPEGQual  = 72
	toolShotCaption   = "【工具截图】请据图理解界面并定位。"
	windowShotCaption = "【窗口截图】这是窗口图，不是全屏。左上角是窗口左上角 (0,0)。mouse_click 的 x,y 用这张图上的像素，并带上结果里的 windowId。不要把图上的点当成屏幕绝对坐标。"
	maxToolShotPerMsg = 2
)

// isVisionScreenshotTool 侧栏会自动附图进多模态的截图类工具。
func isVisionScreenshotTool(name string) bool {
	switch strings.TrimSpace(name) {
	case workbench.CapDesktopScreenshot, workbench.CapBrowserScreenshot:
		return true
	default:
		return false
	}
}

// decorateToolMessage 工具正文 + 截图外置引用（进模时由 historyToSchema 挂多模态）。
func decorateToolMessage(root, sessionID, taskID, toolName string, result workbenchtools.ToolResult, resourceID int64) (content string, preview []model.AgentChatImageDO) {
	content = formatToolMessage(result, resourceID)
	if toolName == workbench.CapDesktopScreenshot && result.OK {
		content = windowShotCaption + "\n" + content
	}
	if root == "" || !result.OK || !isVisionScreenshotTool(toolName) {
		return content, nil
	}
	refs, preview, err := attachToolScreenshots(root, sessionID, taskID, toolName, result)
	if err != nil || len(refs) == 0 {
		if err != nil {
			content += "\n【截图未附图】" + err.Error()
		}
		return content, nil
	}
	return history.EncodeImageHead(refs) + content, preview
}

func attachToolScreenshots(root, sessionID, taskID, toolName string, result workbenchtools.ToolResult) ([]history.ImageRef, []model.AgentChatImageDO, error) {
	path, mimeHint := shotPathFromResult(result)
	if path == "" {
		return nil, nil, nil
	}
	b64, mime, err := encodeShotForModel(path, mimeHint)
	if err != nil {
		return nil, nil, err
	}
	id, _, err := resource.Put(root, resource.PutInput{
		SessionKey: sessionID,
		TaskID:     taskID,
		Kind:       resource.KindUserImage,
		RelPath:    mime,
		Body:       b64,
		ToolName:   toolName,
	})
	if err != nil {
		return nil, nil, err
	}
	ref := history.ImageRef{ID: id, MIME: mime}
	preview := []model.AgentChatImageDO{{
		MIME: mime,
		Data: "data:" + mime + ";base64," + b64,
	}}
	return []history.ImageRef{ref}, preview, nil
}

func shotPathFromResult(result workbenchtools.ToolResult) (path, mimeHint string) {
	raw := unwrapShotData(result.Data)
	if len(raw) == 0 {
		return "", ""
	}
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) != nil {
		return "", ""
	}
	path, _ = m["path"].(string)
	path = strings.TrimSpace(path)
	if path == "" {
		return "", ""
	}
	format, _ := m["format"].(string)
	format = strings.ToLower(strings.TrimSpace(format))
	switch format {
	case "png":
		mimeHint = "image/png"
	case "jpeg", "jpg":
		mimeHint = "image/jpeg"
	case "webp":
		mimeHint = "image/webp"
	case "gif":
		mimeHint = "image/gif"
	default:
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".png":
			mimeHint = "image/png"
		case ".jpg", ".jpeg":
			mimeHint = "image/jpeg"
		case ".webp":
			mimeHint = "image/webp"
		case ".gif":
			mimeHint = "image/gif"
		default:
			mimeHint = "image/png"
		}
	}
	return path, mimeHint
}

// unwrapShotData Gateway 把工具 JSON 再包成字符串；先剥一层才能读到 path。
func unwrapShotData(raw json.RawMessage) json.RawMessage {
	raw = json.RawMessage(strings.TrimSpace(string(raw)))
	if len(raw) == 0 {
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(s)
		if strings.HasPrefix(s, "{") {
			return json.RawMessage(s)
		}
	}
	return raw
}

// encodeShotForModel 读盘压缩到可进模体积（最长边 toolShotMaxEdge，JPEG）。
func encodeShotForModel(path, mimeHint string) (b64, mime string, err error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	if len(raw) == 0 {
		return "", "", fmt.Errorf("empty screenshot")
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		// 解码失败则原样（若已是小图）
		if len(raw) <= maxChatImageBytes {
			mime = mimeHint
			if mime == "" {
				mime = "image/png"
			}
			return base64.StdEncoding.EncodeToString(raw), mime, nil
		}
		return "", "", err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return "", "", fmt.Errorf("invalid image size")
	}
	outImg := img
	nw, nh := desktop.ModelImageSize(w, h)
	if nw != w || nh != h {
		outImg = resizeImage(img, nw, nh)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, outImg, &jpeg.Options{Quality: toolShotJPEGQual}); err != nil {
		return "", "", err
	}
	encoded := buf.Bytes()
	if len(encoded) > maxChatImageBytes {
		return "", "", fmt.Errorf("screenshot still too large after compress")
	}
	return base64.StdEncoding.EncodeToString(encoded), "image/jpeg", nil
}

func resizeImage(src image.Image, nw, nh int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	for y := 0; y < nh; y++ {
		sy := sb.Min.Y + y*sh/nh
		for x := 0; x < nw; x++ {
			sx := sb.Min.X + x*sw/nw
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}

// imagesFromToolContent 从工具正文拆出附图（供 UI / 进模）。
func imagesFromToolContent(root, content string) []model.AgentChatImageDO {
	_, refs := history.SplitImageRefs(content)
	if len(refs) == 0 {
		return nil
	}
	if len(refs) > maxToolShotPerMsg {
		refs = refs[len(refs)-maxToolShotPerMsg:]
	}
	blobs := loadUserImages(root, refs)
	out := make([]model.AgentChatImageDO, 0, len(blobs))
	for _, b := range blobs {
		out = append(out, model.AgentChatImageDO{
			MIME: b.MIME,
			Data: "data:" + b.MIME + ";base64," + b.Data,
		})
	}
	return out
}
