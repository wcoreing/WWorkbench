package desktop

import (
	"context"
	"image"
	"image/draw"
	"image/png"
	"os"
)

// ModelMaxEdge 进模截图的最长边。点击坐标用这个尺寸，不是屏幕点。
const ModelMaxEdge = 1280

type shotFrame struct {
	pixelW int
	pixelH int
}

// ModelImageSize 与进模压缩同一套缩放，保证模型看到的宽高就是换算用的宽高。
func ModelImageSize(w, h int) (int, int) {
	if w <= 0 || h <= 0 {
		return w, h
	}
	maxEdge := w
	if h > maxEdge {
		maxEdge = h
	}
	if maxEdge <= ModelMaxEdge {
		return w, h
	}
	if w >= h {
		nh := h * ModelMaxEdge / w
		if nh < 1 {
			nh = 1
		}
		return ModelMaxEdge, nh
	}
	nw := w * ModelMaxEdge / h
	if nw < 1 {
		nw = 1
	}
	return nw, ModelMaxEdge
}

func (d *Driver) noteShot(windowID string, pixelW, pixelH int) {
	if d == nil || windowID == "" || pixelW < 1 || pixelH < 1 {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.frames == nil {
		d.frames = map[string]shotFrame{}
	}
	d.frames[windowID] = shotFrame{pixelW: pixelW, pixelH: pixelH}
}

func (d *Driver) shotFrame(windowID string) (shotFrame, bool) {
	if d == nil {
		return shotFrame{}, false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	f, ok := d.frames[windowID]
	return f, ok
}

// mapWindowPoints 把窗口图上的像素换成屏幕逻辑点。未带 windowId 的坐标保持屏幕绝对点。
func (d *Driver) mapWindowPoints(ctx context.Context, app App, o *ActOpts) error {
	if o == nil || o.WindowID == "" {
		return nil
	}
	needs := false
	switch o.Action {
	case ActionMouseClick, ActionMouseMove, ActionMouseWheel, ActionHover, ActionDrag:
		needs = true
	}
	if !needs {
		return nil
	}
	if hasXY(o.X, o.Y) {
		sx, sy, err := d.windowToScreen(ctx, app, o.WindowID, *o.X, *o.Y)
		if err != nil {
			return err
		}
		o.X, o.Y = &sx, &sy
	}
	if hasXY(o.X2, o.Y2) {
		sx, sy, err := d.windowToScreen(ctx, app, o.WindowID, *o.X2, *o.Y2)
		if err != nil {
			return err
		}
		o.X2, o.Y2 = &sx, &sy
	}
	return nil
}

func (d *Driver) windowToScreen(ctx context.Context, app App, windowID string, x, y float64) (float64, float64, error) {
	frame, ok := d.shotFrame(windowID)
	if !ok {
		return 0, 0, &Error{Code: CodeInvalidArgs, Message: "没有这张窗口图的比例，请先 desktop_screenshot 同一 windowId，再用图上的 x,y"}
	}
	win, err := d.pickShotWindow(ctx, app, windowID)
	if err != nil {
		return 0, 0, err
	}
	imgW, imgH := ModelImageSize(frame.pixelW, frame.pixelH)
	if imgW < 1 || imgH < 1 || win.Bounds.Width < 1 || win.Bounds.Height < 1 {
		return 0, 0, &Error{Code: CodeInvalidArgs, Message: "窗口图尺寸无效"}
	}
	sx := win.Bounds.X + x*win.Bounds.Width/float64(imgW)
	sy := win.Bounds.Y + y*win.Bounds.Height/float64(imgH)
	return sx, sy, nil
}

// cropWindowPNG 裁掉窗口阴影，留下不透明的窗口本体。返回裁后像素宽高。
func cropWindowPNG(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	im, err := png.Decode(f)
	_ = f.Close()
	if err != nil {
		return 0, 0, err
	}
	b := im.Bounds()
	box, ok := opaqueBounds(im)
	if !ok || (box.Dx() >= b.Dx()-2 && box.Dy() >= b.Dy()-2) {
		return b.Dx(), b.Dy(), nil
	}
	dst := image.NewRGBA(image.Rect(0, 0, box.Dx(), box.Dy()))
	draw.Draw(dst, dst.Bounds(), im, box.Min, draw.Src)
	tmp := path + ".crop"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, 0, err
	}
	err = png.Encode(out, dst)
	_ = out.Close()
	if err != nil {
		_ = os.Remove(tmp)
		return 0, 0, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return 0, 0, err
	}
	return box.Dx(), box.Dy(), nil
}

func opaqueBounds(im image.Image) (image.Rectangle, bool) {
	b := im.Bounds()
	const minA = 50000 // 16-bit alpha，约等于 200/255
	opaque := func(x, y int) bool {
		_, _, _, a := im.At(x, y).RGBA()
		return a > minA
	}
	row := func(y int) bool {
		for x := b.Min.X; x < b.Max.X; x += 4 {
			if opaque(x, y) {
				return true
			}
		}
		return opaque(b.Max.X-1, y)
	}
	col := func(x int) bool {
		for y := b.Min.Y; y < b.Max.Y; y += 4 {
			if opaque(x, y) {
				return true
			}
		}
		return opaque(x, b.Max.Y-1)
	}
	top := b.Min.Y
	for ; top < b.Max.Y && !row(top); top++ {
	}
	bot := b.Max.Y - 1
	for ; bot >= b.Min.Y && !row(bot); bot-- {
	}
	left := b.Min.X
	for ; left < b.Max.X && !col(left); left++ {
	}
	right := b.Max.X - 1
	for ; right >= b.Min.X && !col(right); right-- {
	}
	if top > bot || left > right {
		return image.Rectangle{}, false
	}
	return image.Rect(left, top, right+1, bot+1), true
}
