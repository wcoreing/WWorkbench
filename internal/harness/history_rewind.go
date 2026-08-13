package harness

import (
	"fmt"
	"strings"

	nhstore "github.com/wcoreing/ningharness/store"
)

func rewindBySeq(root, sessionKey string, keepSeq int) error {
	root = strings.TrimSpace(root)
	sessionKey = strings.TrimSpace(sessionKey)
	if root == "" || sessionKey == "" {
		return fmt.Errorf("harness: rewind requires root, sessionKey")
	}
	db, err := nhstore.OpenProject(root)
	if err != nil {
		return err
	}
	pid := nhstore.ProjectID(root)
	_, err = db.Exec(nhstore.R(`DELETE FROM history_message WHERE project_id=? AND session_key=? AND seq>?`), pid, sessionKey, keepSeq)
	return err
}
