package brain

import "github.com/wcoreing/ningharness/guest"

// 外置大脑契约在 ningharness/guest（External / Tools / Event）。
// 本包只放产品适配器（Cursor；未来 Pi / dsh），禁止再定义平行接口。

const (
	KindCursor = "cursor"
	KindPi     = "pi"
	KindDSH    = "dsh"
)

// 类型别名：产品代码可读，真相在框架。
type (
	External      = guest.External
	Tools         = guest.Tools
	ExternalTurn  = guest.ExternalTurn
	Event         = guest.Event
	EventKind     = guest.EventKind
	Emit          = guest.Emit
	ToolSpec      = guest.ToolSpec
	InvokeResult  = guest.InvokeResult
)

const (
	EventTextDelta = guest.EventTextDelta
	EventProgress  = guest.EventProgress
	EventToolStart = guest.EventToolStart
	EventToolEnd   = guest.EventToolEnd
	EventError     = guest.EventError
)
