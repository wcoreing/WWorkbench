package workbenchtools

import (
	"regexp"
	"strings"
)

var (
	reFdRedirect = regexp.MustCompile(`\d*>&?\d+|>&\d+`)
	reRm         = regexp.MustCompile(`(?i)(^|[\s;|&])rm(\s|$)`)
	reDockerMut  = regexp.MustCompile(`(?i)\bdocker\s+(rm|rmi|stop|kill|system\s+prune|volume\s+rm|container\s+prune|image\s+prune)\b`)
	reDangerFS   = regexp.MustCompile(`(?i)\b(dd|mkfs(\.\w+)?|shred|wipefs)\b`)
	reForceGit   = regexp.MustCompile(`(?i)\bgit\s+(push\s+.*--force|push\s+-f\b|reset\s+--hard|clean\s+-f[dfx]*)\b`)
	rePipeToSh   = regexp.MustCompile(`(?i)\|\s*(ba)?sh\b`)
	reTee        = regexp.MustCompile(`(?i)(^|[\s;|&])tee(\s|$)`)
	reMvRf       = regexp.MustCompile(`(?i)\bmv\s+(-[^\s]*\s+)*/*\s|^\s*mv\s+.*\s+/`)
	reChmodRec   = regexp.MustCompile(`(?i)\bchmod\s+.*-R|\bchown\s+.*-R`)
	reKill       = regexp.MustCompile(`(?i)(^|[\s;|&])(kill|pkill|killall)(\s|$)`)
)

// assessShellRisk 判断注入终端的命令是否需工作台拍板。
// 空命令（仅开终端）不风险；只读类不拦。数据文件 / 递归同步优先标硬风险。
func assessShellRisk(cmd string) (risky bool, reason string) {
	s := strings.TrimSpace(cmd)
	if s == "" {
		return false, ""
	}
	if ok, why := assessDataGuardRisk(s); ok {
		return true, why
	}
	if hasWriteRedirect(s) {
		return true, "写入文件（含重定向 > / >>）"
	}
	if reTee.MatchString(s) {
		return true, "tee 写入文件"
	}
	if reRm.MatchString(s) {
		return true, "删除文件/目录（rm）"
	}
	if reDockerMut.MatchString(s) {
		return true, "Docker 破坏性操作"
	}
	if reDangerFS.MatchString(s) {
		return true, "磁盘/块设备危险命令"
	}
	if reForceGit.MatchString(s) {
		return true, "Git 破坏性操作"
	}
	if rePipeToSh.MatchString(s) {
		return true, "管道执行 shell（| sh）"
	}
	if reChmodRec.MatchString(s) {
		return true, "递归改权限/属主"
	}
	if reKill.MatchString(s) {
		return true, "结束进程"
	}
	_ = reMvRf // 预留：误伤多，暂不默认开启
	return false, ""
}

func hasWriteRedirect(s string) bool {
	t := reFdRedirect.ReplaceAllString(s, " ")
	return strings.Contains(t, ">")
}
