package workbenchtools

import (
	"strings"
	"testing"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

func TestCloudTeachFromErrPermission(t *testing.T) {
	teach := cloudTeachFromErr(errno.New(errno.CodeConnFailed, "NoPermission", "Forbidden"))
	if !strings.Contains(teach.Summary, "权限") {
		t.Fatalf("want permission summary, got %#v", teach)
	}
	if len(teach.NextSteps) == 0 || !strings.Contains(teach.NextSteps[0], "Authorize") {
		t.Fatalf("want Authorize hint, got %#v", teach.NextSteps)
	}
}

func TestSuggestedOpsSkillAskHuman(t *testing.T) {
	host := &model.SSHHostDO{Name: "生产/跳板"}
	res := model.SecurityGroupSyncResultDO{PublicIP: "1.2.3.4", Port: 22, CIDR: "1.2.3.4/32", SecurityGroup: "sg-x"}
	sk := suggestedOpsSkill(host, res)
	if !sk.AskHuman {
		t.Fatal("must ask human before skill write")
	}
	if strings.Contains(sk.Name, "生产/跳板") {
		t.Fatalf("host slash should be sanitized: %s", sk.Name)
	}
	if !strings.Contains(sk.Name, "家宽IP放行") {
		t.Fatalf("unexpected skill name %s", sk.Name)
	}
}

func TestSafeSkillPathSegment(t *testing.T) {
	if got := SafeSkillPathSegment("a/b:c"); strings.ContainsAny(got, "/:\\") {
		t.Fatalf("unsafe name: %q", got)
	}
}
