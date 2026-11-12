package notebook

import (
	"path/filepath"
	"strings"
)

// OpsGroupName 运维业务工作根（终端/Docker/备份等产品挂载；与「工作流」隔离）。
const OpsGroupName = "运维"

// SystemTopDirs 笔记本根下的业务工作根（系统目录，不可删/改名）。
func SystemTopDirs() []string {
	return []string{SkillGroupName, MemoryGroupName, OpsGroupName}
}

// IsSystemTopDir 是否为根级业务工作根。
func IsSystemTopDir(rel string) bool {
	rel = strings.Trim(filepath.ToSlash(strings.TrimSpace(rel)), "/")
	if rel == "" || strings.Contains(rel, "/") {
		return false
	}
	for _, d := range SystemTopDirs() {
		if rel == d {
			return true
		}
	}
	return false
}
