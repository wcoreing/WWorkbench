package workbench

import (
	"strings"
	"testing"
)

func TestNotebookPathWriteIDs(t *testing.T) {
	ids := []string{
		RadarWriteNotebookRename,
		RadarWriteNotebookMove,
		RadarWriteNotebookCopy,
		RadarWriteNotebookDeletePath,
		RadarWriteNotebookMkdir,
		RadarWriteNotebookCreateFile,
	}
	for _, id := range ids {
		if !strings.HasPrefix(id, "ui-notebook-") {
			t.Fatalf("writeId must use ui-notebook- prefix: %q", id)
		}
	}
	if RadarDomainNotebookPath != "notebook.path" {
		t.Fatalf("domain=%q", RadarDomainNotebookPath)
	}
}
