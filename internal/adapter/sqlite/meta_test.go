package sqlite

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"
)

func TestListColumnsAndIndexes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	ctx := context.Background()
	ad := New()
	db, err := ad.Open(ctx, model.ConnectionConfigDO{DbType: "sqlite", Host: path}, tunnel.Nop())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX ux_name ON sessions(name)`); err != nil {
		t.Fatal(err)
	}

	cols, err := ad.ListColumns(ctx, db, "main", "sessions")
	if err != nil {
		t.Fatalf("ListColumns: %v", err)
	}
	if len(cols) != 2 {
		t.Fatalf("cols=%d %#v", len(cols), cols)
	}

	idxs, err := ad.ListIndexes(ctx, db, "main", "sessions")
	if err != nil {
		t.Fatalf("ListIndexes: %v", err)
	}
	if len(idxs) == 0 {
		t.Fatalf("expected indexes, got %#v", idxs)
	}
	t.Logf("cols=%+v idxs=%+v", cols, idxs)

	// also try empty database name
	cols2, err := ad.ListColumns(ctx, db, "", "sessions")
	if err != nil {
		t.Fatalf("ListColumns empty db: %v", err)
	}
	if len(cols2) != 2 {
		t.Fatalf("cols2=%d", len(cols2))
	}

	_ = os.Remove(path)
}
