package workbenchtools

import (
	"encoding/json"
	"strings"
	"time"
)

const skillOfferDedupTTL = 2 * time.Minute

// EmitSkillOffer 向前端推送人审沉淀（mcp:skill_offer → 右下角拍板 → update_skill）。
// 不阻塞 MCP 调用；Agent 仍须转述 suggestedSkill，但产品侧不再只靠 Agent 记得 offer_choices。
func (g *MCPConfirmGate) EmitSkillOffer(tool string, skill SuggestedSkill) {
	if g == nil || g.emit == nil {
		return
	}
	name := strings.TrimSpace(skill.Name)
	if name == "" || !skill.AskHuman {
		return
	}
	if g.shouldSkipSkillOffer(name, skill.Lessons) {
		return
	}
	prompt := strings.TrimSpace(skill.OfferPrompt)
	if prompt == "" {
		prompt = "要把这次做法写进 Skill 吗？"
	}
	payload := map[string]interface{}{
		"tool":        tool,
		"name":        name,
		"lessons":     skill.Lessons,
		"askHuman":    true,
		"offerPrompt": prompt,
		"domain":      skill.Domain,
		"at":          time.Now().UnixMilli(),
	}
	if product := ProductForTool(tool); product != "" {
		payload["product"] = product
	}
	g.emit("mcp:skill_offer", payload)
}

// MaybeEmitSkillOffer 终态结果含 askHuman suggestedSkill 时推前端人审。
func MaybeEmitSkillOffer(d *Deps, tool string, res ToolResult) {
	if d == nil || d.MCPConfirm == nil || !res.OK {
		return
	}
	sk, ok := extractSuggestedSkill(res.Data)
	if !ok || !sk.AskHuman {
		return
	}
	d.MCPConfirm.EmitSkillOffer(tool, sk)
}

func extractSuggestedSkill(data json.RawMessage) (SuggestedSkill, bool) {
	if len(data) == 0 {
		return SuggestedSkill{}, false
	}
	var wrap struct {
		SuggestedSkill *SuggestedSkill `json:"suggestedSkill"`
	}
	if json.Unmarshal(data, &wrap) != nil || wrap.SuggestedSkill == nil {
		return SuggestedSkill{}, false
	}
	sk := *wrap.SuggestedSkill
	if strings.TrimSpace(sk.Name) == "" {
		return SuggestedSkill{}, false
	}
	return sk, true
}

func (g *MCPConfirmGate) shouldSkipSkillOffer(name, lessons string) bool {
	if g == nil {
		return true
	}
	key := name + "\n" + strings.TrimSpace(lessons)
	now := time.Now()
	g.skillOfferMu.Lock()
	defer g.skillOfferMu.Unlock()
	if g.skillOfferLast == nil {
		g.skillOfferLast = make(map[string]time.Time)
	}
	if t, ok := g.skillOfferLast[key]; ok && now.Sub(t) < skillOfferDedupTTL {
		return true
	}
	g.skillOfferLast[key] = now
	// 轻量清理过期项
	for k, t := range g.skillOfferLast {
		if now.Sub(t) > skillOfferDedupTTL*2 {
			delete(g.skillOfferLast, k)
		}
	}
	return false
}
