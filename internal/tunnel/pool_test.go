package tunnel

import (
	"testing"

	"WWorkbench/internal/model"
)

func TestSpecPoolKeyStable(t *testing.T) {
	a := specPoolKey(model.TunnelSpecDO{User: "root", Host: "1.2.3.4", Port: 22, KeyPath: "/a/id_rsa"})
	b := specPoolKey(model.TunnelSpecDO{User: "root", Host: "1.2.3.4", Port: 0, KeyPath: "/a/id_rsa"})
	if a != b {
		t.Fatalf("port 0 should normalize to 22: %q vs %q", a, b)
	}
	pw1 := specPoolKey(model.TunnelSpecDO{User: "u", Host: "h", Password: "secret"})
	pw2 := specPoolKey(model.TunnelSpecDO{User: "u", Host: "h", Password: "secret"})
	pw3 := specPoolKey(model.TunnelSpecDO{User: "u", Host: "h", Password: "other"})
	if pw1 != pw2 {
		t.Fatal("same password should same key")
	}
	if pw1 == pw3 {
		t.Fatal("different password should different key")
	}
	if pw1 == a {
		t.Fatal("key auth vs password should differ")
	}
}

func TestReleaseUnknownIsNoop(t *testing.T) {
	ReleaseSSH(nil)
	// 未入池的指针不应 panic
	ReleaseSSH(nil)
}
