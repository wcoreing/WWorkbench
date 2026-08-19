package turnctx

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestParseSSHTarget(t *testing.T) {
	u, h, p, ok := ParseSSHTarget("ssh -p 14408 root@connect.westd.seetacloud.com")
	if !ok || u != "root" || h != "connect.westd.seetacloud.com" || p != 14408 {
		t.Fatalf("ssh -p: ok=%v %s@%s:%d", ok, u, h, p)
	}
	u, h, p, ok = ParseSSHTarget("root@connect.westd.seetacloud.com:14408")
	if !ok || h != "connect.westd.seetacloud.com" || p != 14408 {
		t.Fatalf("user@host:port: ok=%v %s@%s:%d", ok, u, h, p)
	}
	_, h, p, ok = ParseSSHTarget("connect.westd.seetacloud.com:14408")
	if !ok || h != "connect.westd.seetacloud.com" || p != 14408 {
		t.Fatalf("host:port: ok=%v %s:%d", ok, h, p)
	}
	_, _, _, ok = ParseSSHTarget("connect.weste.seetacloud.com")
	if ok {
		t.Fatal("plain hostname should not parse as ssh command")
	}
}

func TestUserSSHHintConflict(t *testing.T) {
	hint := userSSHHint("ssh -p 14408 root@connect.westd.seetacloud.com", []model.AgentMentionDO{{
		Kind:  "ssh",
		ID:    "old",
		Label: "seetacloud · root@connect.weste.seetacloud.com:42013",
	}})
	if !strings.Contains(hint, "connect.westd.seetacloud.com:14408") {
		t.Fatalf("missing user addr: %s", hint)
	}
	if !strings.Contains(hint, "不是同一台") {
		t.Fatalf("missing conflict: %s", hint)
	}
	if !strings.Contains(hint, "connect.weste.seetacloud.com:42013") {
		t.Fatalf("missing bound addr: %s", hint)
	}
}
