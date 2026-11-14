package agent

import (
	"context"
	"fmt"

	"WWorkbench/internal/store"
)

// TestCursorConnection 经 ExternalBrain(Cursor) Ping + Me。
func (r *Runner) TestCursorConnection(ctx context.Context) (string, error) {
	apiKey := r.store.AgentAPIKey()
	if apiKey == "" {
		return "", fmt.Errorf("请先保存 CURSOR_API_KEY")
	}
	dataDir, err := store.DataDir()
	if err != nil {
		return "", err
	}
	return r.ensureCursorBrain(dataDir, apiKey).TestConnection(ctx)
}
