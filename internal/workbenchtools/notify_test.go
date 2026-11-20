package workbenchtools

import "testing"

func TestLooksLikeWecomWebhook(t *testing.T) {
	ok := "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123"
	if !looksLikeWecomWebhook(ok) {
		t.Fatalf("want ok for %s", ok)
	}
	if looksLikeWecomWebhook("https://example.com/hook") {
		t.Fatal("want reject foreign host")
	}
	if looksLikeWecomWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send") {
		t.Fatal("want reject missing key")
	}
}

func TestMaskWebhook(t *testing.T) {
	got := maskWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret")
	if got != "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****" {
		t.Fatalf("got %q", got)
	}
}

func TestNotifyDedupe(t *testing.T) {
	notifyMu.Lock()
	notifySentAt = nil
	notifyLastBody = ""
	notifyLastAt = notifyLastAt.Add(-notifyDedupeWindow * 2)
	notifyMu.Unlock()

	markNotifySent("same")
	if err := checkNotifyRate("same"); err == nil {
		t.Fatal("want dedupe fail")
	}
	if err := checkNotifyRate("other"); err != nil {
		t.Fatalf("different body should pass: %#v", err)
	}
}

func TestLooksLikeWechatSend(t *testing.T) {
	if !looksLikeWechatSend("发给文件传输助手") {
		t.Fatal("want wechat")
	}
	if looksLikeWechatSend("备份完成") {
		t.Fatal("want non-wechat")
	}
}
