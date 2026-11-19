package workbenchtools

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

const (
	notifyChannelWecom   = "wecom_webhook"
	notifyChannelDesktop = "desktop_wechat"
	notifyWecomMaxPerMin = 20
	notifyDedupeWindow   = 60 * time.Second
)

var (
	notifyMu       sync.Mutex
	notifySentAt   []time.Time
	notifyLastBody string
	notifyLastAt   time.Time
)

type configureNotifyArgs struct {
	Channel    string `json:"channel"`
	WebhookURL string `json:"webhookUrl"`
	Intent     string `json:"intent"`
}

type notifySendArgs struct {
	Channel  string `json:"channel"`
	Text     string `json:"text"`
	Markdown string `json:"markdown"`
	Intent   string `json:"intent"`
}

func registerNotifyTools(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapConfigureNotify,
		Description: "配置出站通知通道。当前支持 channel=wecom_webhook（企业微信群机器人完整 Webhook URL）。" +
			"密钥只存本机设置，勿写进笔记或仓库。需确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"channel":    map[string]interface{}{"type": "string", "description": "wecom_webhook"},
				"webhookUrl": map[string]interface{}{"type": "string", "description": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"},
				"intent":     intentProp(),
			},
			"required": []interface{}{"channel", "webhookUrl", "intent"},
		},
		Handler: toolConfigureNotify,
	})
	r.add(ToolDef{
		Name: workbench.CapNotifySend,
		Description: "出站通知。" +
			"channel=wecom_webhook：推到已配置的企微群机器人（告警群推荐；约 20 条/分钟，同文案 60s 去重）。" +
			"channel=desktop_wechat：不代发，返回 teach 指引 get_skill(微信文件传输助手)+offer_choices+desktop_*（个人微信低频沙箱）。" +
			"告警优先 wecom_webhook；禁止用协议机器人。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"channel":  map[string]interface{}{"type": "string", "description": "wecom_webhook | desktop_wechat；默认 wecom_webhook"},
				"text":     map[string]interface{}{"type": "string", "description": "纯文本（与 markdown 二选一优先 markdown）"},
				"markdown": map[string]interface{}{"type": "string", "description": "企微 markdown 正文"},
				"intent":   intentProp(),
			},
			"required": []interface{}{"intent"},
		},
		Handler: toolNotifySend,
	})
}

func toolConfigureNotify(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in configureNotifyArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	ch := strings.TrimSpace(in.Channel)
	url := strings.TrimSpace(in.WebhookURL)
	if ch != notifyChannelWecom {
		return FailTeach("暂只支持 channel=wecom_webhook", Teach{
			Summary:   "通知通道不支持",
			NextSteps: []string{"告警群用 wecom_webhook", "个人微信发送用 notify_send(channel=desktop_wechat) 再走桌面 Skill"},
		})
	}
	if !looksLikeWecomWebhook(url) {
		return FailTeach("Webhook URL 不像企微机器人地址", Teach{
			Summary: "Webhook 格式不对",
			NextSteps: []string{
				"企业微信群 → 添加群机器人 → 复制完整 URL",
				"应形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
			},
		})
	}
	if d == nil || d.Store == nil {
		return Fail("服务未就绪")
	}
	masked := maskWebhook(url)
	summary := strings.TrimSpace(in.Intent)
	if summary == "" {
		summary = "保存企微告警 Webhook"
	}
	return Confirm(uuid.NewString(), truncateRunes(summary, intentTitleMaxRune), map[string]interface{}{
		"channel": ch, "webhookUrl": masked, "intent": strings.TrimSpace(in.Intent),
		"_webhookUrl": url, // 确认后执行用；勿展示给模型复述全文 key
	})
}

func toolNotifySend(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in notifySendArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	ch := strings.TrimSpace(in.Channel)
	if ch == "" {
		ch = notifyChannelWecom
	}
	body := strings.TrimSpace(in.Markdown)
	msgType := "markdown"
	if body == "" {
		body = strings.TrimSpace(in.Text)
		msgType = "text"
	}
	if body == "" {
		return FailTeach("缺少 text/markdown", Teach{
			Summary:   "通知没有正文",
			NextSteps: []string{"填 markdown（告警推荐）或 text", "正文里写清：服务、级别、人下一步"},
		})
	}

	switch ch {
	case notifyChannelDesktop:
		return OKData(map[string]interface{}{
			"ok": true, "deferred": true, "channel": ch,
			"teach": Teach{
				Summary: "个人微信不走 Webhook，改走桌面金路径",
				NextSteps: []string{
					"get_skill(skill=微信文件传输助手)",
					"offer_choices 确认会话（默认文件传输助手）与正文/附件",
					"desktop_* headed 发送并用截图验收；禁止协议扫码机器人",
				},
			},
			"suggestedSkill": NewSuggestedSkill(
				"desktop",
				"工作流/微信文件传输助手",
				"个人微信出站须人确认；告警高频请改 wecom_webhook。",
				"要把这次发送路径收口进「微信文件传输助手」Skill 吗？",
			),
			"note": "本工具不代发个人微信；请按 teach 调用桌面 Skill。",
		})
	case notifyChannelWecom:
		return sendWecomWebhook(ctx, d, body, msgType, strings.TrimSpace(in.Intent))
	default:
		return FailTeach("未知 channel="+ch, Teach{
			Summary:   "通知通道无效",
			NextSteps: []string{"告警用 wecom_webhook", "个人微信沙箱用 desktop_wechat"},
		})
	}
}

func sendWecomWebhook(ctx context.Context, d *Deps, content, msgType, intent string) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("服务未就绪")
	}
	url, _ := d.Store.GetAppSetting(store.SettingNotifyWecomWebhook)
	url = strings.TrimSpace(url)
	if url == "" {
		return FailTeach("尚未配置企微 Webhook", Teach{
			Summary: "告警通道未配置",
			NextSteps: []string{
				"在助手设置 → 通知 粘贴群机器人 Webhook，或调用 configure_notify",
				"个人低频发送可改 channel=desktop_wechat",
			},
		})
	}
	if errTeach := checkNotifyRate(content); errTeach != nil {
		return *errTeach
	}

	payload := map[string]interface{}{"msgtype": msgType}
	if msgType == "markdown" {
		payload["markdown"] = map[string]string{"content": content}
	} else {
		payload["text"] = map[string]string{"content": content}
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return FailTeach(err.Error(), TeachFromError(workbench.CapNotifySend, err.Error()))
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return FailTeach("Webhook 请求失败："+err.Error(), Teach{
			Summary:   "推送到企微失败",
			NextSteps: []string{"检查网络与 Webhook 是否仍有效", "群机器人被移出群后 key 会失效，需重建"},
			Raw:       err.Error(),
		})
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var wx struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	_ = json.Unmarshal(respBody, &wx)
	if resp.StatusCode >= 300 || wx.ErrCode != 0 {
		msg := strings.TrimSpace(wx.ErrMsg)
		if msg == "" {
			msg = string(respBody)
		}
		return FailTeach("企微返回错误："+msg, Teach{
			Summary:   "企微拒绝了这条通知",
			NextSteps: []string{"核对 key / 频率（约 20 条/分钟）", "正文过长或 markdown 语法问题时改短再试"},
			Raw:       msg,
		})
	}
	markNotifySent(content)
	teach := Teach{
		Summary: "已推到企微告警群",
		NextSteps: []string{
			"若人要沉淀：update_skill(name=运维/告警通知) 记聚合策略",
			"同告警请聚合后再推，避免刷屏",
		},
	}
	if intent != "" {
		teach.Highlights = []string{intent}
	}
	return OKData(map[string]interface{}{
		"ok": true, "channel": notifyChannelWecom, "msgtype": msgType,
		"teach": teach,
		"suggestedSkill": NewSuggestedSkill(
			"ops",
			"运维/告警通知",
			"企微 Webhook 已跑通。收口时写清：何时推、如何聚合、禁止个人微信群刷屏。",
			"要把告警推送做法写进运维 Skill 吗？",
		),
	})
}

// ExecuteConfigureNotify 确认后写入 Webhook。
func ExecuteConfigureNotify(d *Deps, argsJSON string) ToolResult {
	var preview map[string]interface{}
	_ = json.Unmarshal([]byte(argsJSON), &preview)
	url, _ := preview["_webhookUrl"].(string)
	url = strings.TrimSpace(url)
	if url == "" {
		var in configureNotifyArgs
		_ = json.Unmarshal([]byte(argsJSON), &in)
		url = strings.TrimSpace(in.WebhookURL)
	}
	if !looksLikeWecomWebhook(url) {
		return Fail("Webhook URL 无效")
	}
	if d == nil || d.Store == nil {
		return Fail("服务未就绪")
	}
	if err := d.Store.SetAppSetting(store.SettingNotifyWecomWebhook, url); err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok": true, "channel": notifyChannelWecom, "webhookUrl": maskWebhook(url),
		"teach": Teach{
			Summary: "企微告警 Webhook 已保存",
			NextSteps: []string{
				"用 notify_send(channel=wecom_webhook, markdown=…) 试推一条",
				"ECS 尖峰/备份失败时可让助手调用 notify_send",
			},
		},
	})
}

func looksLikeWecomWebhook(url string) bool {
	u := strings.ToLower(strings.TrimSpace(url))
	return strings.HasPrefix(u, "https://qyapi.weixin.qq.com/cgi-bin/webhook/send") && strings.Contains(u, "key=")
}

func maskWebhook(url string) string {
	i := strings.Index(strings.ToLower(url), "key=")
	if i < 0 {
		return url
	}
	return url[:i+4] + "****"
}

func checkNotifyRate(body string) *ToolResult {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	now := time.Now()
	if body == notifyLastBody && now.Sub(notifyLastAt) < notifyDedupeWindow {
		res := FailTeach("与上一条相同，已在 60s 去重窗口内", Teach{
			Summary:   "重复告警已抑制",
			NextSteps: []string{"聚合后再推，或等 60 秒", "改正文区分事件（时间戳/次数）"},
		})
		return &res
	}
	cut := now.Add(-time.Minute)
	kept := notifySentAt[:0]
	for _, t := range notifySentAt {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	notifySentAt = kept
	if len(notifySentAt) >= notifyWecomMaxPerMin {
		res := FailTeach("已达约 20 条/分钟上限", Teach{
			Summary:   "通知过于频繁",
			NextSteps: []string{"合并告警再推", "检查是否有循环调用 notify_send"},
		})
		return &res
	}
	return nil
}

func markNotifySent(body string) {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	now := time.Now()
	notifySentAt = append(notifySentAt, now)
	notifyLastBody = body
	notifyLastAt = now
}
