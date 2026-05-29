package store

import (
	"database/sql"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

// ListSFTPBookmarks 列出 SFTP 路径书签。
func (s *Store) ListSFTPBookmarks(side, hostID string) ([]model.SftpBookmarkDO, error) {
	q := `SELECT id, side, host_id, name, path, created_at FROM sftp_bookmarks WHERE 1=1`
	args := []any{}
	if side != "" {
		q += ` AND side = ?`
		args = append(args, side)
	}
	if hostID != "" {
		q += ` AND host_id = ?`
		args = append(args, hostID)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 SFTP 书签失败", err)
	}
	defer rows.Close()
	var list []model.SftpBookmarkDO
	for rows.Next() {
		var b model.SftpBookmarkDO
		var host sql.NullString
		if err := rows.Scan(&b.ID, &b.Side, &host, &b.Name, &b.Path, &b.CreatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 SFTP 书签失败", err)
		}
		if host.Valid {
			b.HostID = host.String
		}
		list = append(list, b)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 SFTP 书签失败", err)
	}
	return list, nil
}

// SaveSFTPBookmark 保存 SFTP 路径书签。
func (s *Store) SaveSFTPBookmark(b model.SftpBookmarkDO) (*model.SftpBookmarkDO, error) {
	if b.Side != "local" && b.Side != "remote" {
		return nil, errno.New(errno.CodeInvalidArg, "书签侧别无效", b.Side)
	}
	if b.Path == "" {
		return nil, errno.New(errno.CodeInvalidArg, "书签路径不能为空", "")
	}
	if b.Side == "remote" && b.HostID == "" {
		return nil, errno.New(errno.CodeInvalidArg, "远程书签需关联 SSH 主机", "")
	}
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	if b.CreatedAt == 0 {
		b.CreatedAt = time.Now().Unix()
	}
	hostID := sql.NullString{String: b.HostID, Valid: b.HostID != ""}
	_, err := s.db.Exec(`INSERT INTO sftp_bookmarks (id, side, host_id, name, path, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path`,
		b.ID, b.Side, hostID, b.Name, b.Path, b.CreatedAt)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "保存 SFTP 书签失败", err)
	}
	return &b, nil
}

// DeleteSFTPBookmark 删除 SFTP 路径书签。
func (s *Store) DeleteSFTPBookmark(id string) error {
	_, err := s.db.Exec(`DELETE FROM sftp_bookmarks WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 SFTP 书签失败", err)
	}
	return nil
}
