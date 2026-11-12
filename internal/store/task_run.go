package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const taskRunSelectSQL = `SELECT id, session, title, intent, status, source, started_at, ended_at FROM task_runs`
const taskStepSelectSQL = `SELECT id, run_id, seq, kind, provider, tool, action, intent, summary, args_json, locator_json, result_json, ok, error, approved, created_at FROM task_steps`

// CreateTaskRun 新建任务运行。
func (s *Store) CreateTaskRun(r model.TaskRunDO) (model.TaskRunDO, error) {
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	if r.StartedAt == 0 {
		r.StartedAt = time.Now().Unix()
	}
	if strings.TrimSpace(r.Status) == "" {
		r.Status = "running"
	}
	if strings.TrimSpace(r.Source) == "" {
		r.Source = "browser"
	}
	_, err := s.db.Exec(
		`INSERT INTO task_runs (id, session, title, intent, status, source, started_at, ended_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Session, r.Title, r.Intent, r.Status, r.Source, r.StartedAt, r.EndedAt,
	)
	if err != nil {
		return r, errno.Wrap(errno.CodeStoreFailed, "写入任务运行失败", err)
	}
	return r, nil
}

// UpdateTaskRunTitle 重命名任务标题（舞台会话列表编辑）。
func (s *Store) UpdateTaskRunTitle(id, title string) error {
	id = strings.TrimSpace(id)
	title = strings.TrimSpace(title)
	if id == "" {
		return errno.New(errno.CodeInvalidArg, "任务 id 不能为空", "")
	}
	if title == "" {
		return errno.New(errno.CodeInvalidArg, "标题不能为空", "")
	}
	res, err := s.db.Exec(`UPDATE task_runs SET title = ? WHERE id = ?`, title, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "更新任务标题失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "任务不存在", id)
	}
	return nil
}

// DeleteTaskRuns 批量删除任务及其步骤；返回实际删除的任务数。不删关联 Skill 笔记。
func (s *Store) DeleteTaskRuns(ids []string) (int, error) {
	uniq := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return 0, errno.New(errno.CodeInvalidArg, "请提供要删除的任务 id", "")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, errno.Wrap(errno.CodeStoreFailed, "开启事务失败", err)
	}
	defer func() { _ = tx.Rollback() }()
	deleted := 0
	for _, id := range uniq {
		if _, err := tx.Exec(`DELETE FROM task_steps WHERE run_id = ?`, id); err != nil {
			return 0, errno.Wrap(errno.CodeStoreFailed, "删除任务步骤失败", err)
		}
		res, err := tx.Exec(`DELETE FROM task_runs WHERE id = ?`, id)
		if err != nil {
			return 0, errno.Wrap(errno.CodeStoreFailed, "删除任务失败", err)
		}
		n, _ := res.RowsAffected()
		deleted += int(n)
	}
	if deleted == 0 {
		return 0, errno.New(errno.CodeNotFound, "任务不存在", strings.Join(uniq, ","))
	}
	if err := tx.Commit(); err != nil {
		return 0, errno.Wrap(errno.CodeStoreFailed, "提交删除失败", err)
	}
	return deleted, nil
}

// UpdateTaskRunStatus 更新任务状态；status=done|failed|cancelled 时写 ended_at。
func (s *Store) UpdateTaskRunStatus(id, status string) error {
	id = strings.TrimSpace(id)
	status = strings.TrimSpace(status)
	if id == "" || status == "" {
		return errno.New(errno.CodeInvalidArg, "任务 id/status 不能为空", "")
	}
	ended := int64(0)
	if status == "done" || status == "failed" || status == "cancelled" {
		ended = time.Now().Unix()
	}
	res, err := s.db.Exec(`UPDATE task_runs SET status = ?, ended_at = CASE WHEN ? > 0 THEN ? ELSE ended_at END WHERE id = ?`,
		status, ended, ended, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "更新任务状态失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "任务不存在", id)
	}
	return nil
}

// GetTaskRun 取单次任务（不含步骤）。
func (s *Store) GetTaskRun(id string) (model.TaskRunDO, error) {
	row := s.db.QueryRow(taskRunSelectSQL+` WHERE id = ?`, strings.TrimSpace(id))
	r, err := scanTaskRun(row)
	if err == sql.ErrNoRows {
		return model.TaskRunDO{}, errno.New(errno.CodeNotFound, "任务不存在", id)
	}
	if err != nil {
		return model.TaskRunDO{}, errno.Wrap(errno.CodeStoreFailed, "读取任务失败", err)
	}
	return r, nil
}

// FindOpenTaskRunBySession 找该 session 最近一条 running。
func (s *Store) FindOpenTaskRunBySession(session string) (model.TaskRunDO, error) {
	session = strings.TrimSpace(session)
	row := s.db.QueryRow(taskRunSelectSQL+` WHERE session = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`, session)
	r, err := scanTaskRun(row)
	if err == sql.ErrNoRows {
		return model.TaskRunDO{}, nil
	}
	if err != nil {
		return model.TaskRunDO{}, errno.Wrap(errno.CodeStoreFailed, "读取进行中任务失败", err)
	}
	return r, nil
}

// ListTaskRuns 列出近期任务；session 空则跨任务。
func (s *Store) ListTaskRuns(session string, limit int) ([]model.TaskRunDO, error) {
	if limit <= 0 {
		limit = 30
	}
	var (
		rows *sql.Rows
		err  error
	)
	if strings.TrimSpace(session) == "" {
		rows, err = s.db.Query(
			`SELECT r.id, r.session, r.title, r.intent, r.status, r.source, r.started_at, r.ended_at,
			        (SELECT COUNT(*) FROM task_steps s WHERE s.run_id = r.id) AS step_count
			 FROM task_runs r ORDER BY r.started_at DESC LIMIT ?`, limit)
	} else {
		rows, err = s.db.Query(
			`SELECT r.id, r.session, r.title, r.intent, r.status, r.source, r.started_at, r.ended_at,
			        (SELECT COUNT(*) FROM task_steps s WHERE s.run_id = r.id) AS step_count
			 FROM task_runs r WHERE r.session = ? ORDER BY r.started_at DESC LIMIT ?`, strings.TrimSpace(session), limit)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "列出任务失败", err)
	}
	defer rows.Close()
	var out []model.TaskRunDO
	for rows.Next() {
		var r model.TaskRunDO
		if err := rows.Scan(&r.ID, &r.Session, &r.Title, &r.Intent, &r.Status, &r.Source, &r.StartedAt, &r.EndedAt, &r.StepCount); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取任务失败", err)
		}
		out = append(out, r)
	}
	return out, nil
}

// AppendTaskStep 追加一步；seq 由本函数按 run 自增。
func (s *Store) AppendTaskStep(st model.TaskStepDO) (model.TaskStepDO, error) {
	if strings.TrimSpace(st.RunID) == "" {
		return st, errno.New(errno.CodeInvalidArg, "runId 不能为空", "")
	}
	if st.ID == "" {
		st.ID = uuid.NewString()
	}
	if st.CreatedAt == 0 {
		st.CreatedAt = time.Now().Unix()
	}
	var maxSeq sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(seq) FROM task_steps WHERE run_id = ?`, st.RunID).Scan(&maxSeq)
	st.Seq = int(maxSeq.Int64) + 1
	ok := 0
	if st.OK {
		ok = 1
	}
	approved := 0
	if st.Approved {
		approved = 1
	}
	if st.ArgsJSON == "" {
		st.ArgsJSON = "{}"
	}
	if strings.TrimSpace(st.Kind) == "" {
		st.Kind = model.TaskStepKindOp
	}
	_, err := s.db.Exec(
		`INSERT INTO task_steps (id, run_id, seq, kind, provider, tool, action, intent, summary, args_json, locator_json, result_json, ok, error, approved, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		st.ID, st.RunID, st.Seq, st.Kind, st.Provider, st.Tool, st.Action, st.Intent, st.Summary, st.ArgsJSON, st.Locator, st.Result, ok, st.Error, approved, st.CreatedAt,
	)
	if err != nil {
		return st, errno.Wrap(errno.CodeStoreFailed, "写入任务步骤失败", err)
	}
	return st, nil
}

// ListTaskSteps 按序返回某次任务的全部步骤。
func (s *Store) ListTaskSteps(runID string) ([]model.TaskStepDO, error) {
	rows, err := s.db.Query(taskStepSelectSQL+` WHERE run_id = ? ORDER BY seq ASC`, strings.TrimSpace(runID))
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "列出任务步骤失败", err)
	}
	defer rows.Close()
	var out []model.TaskStepDO
	for rows.Next() {
		st, err := scanTaskStep(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, nil
}

// GetTaskRunDetail 任务 + 步骤。
func (s *Store) GetTaskRunDetail(id string) (model.TaskRunDetailDO, error) {
	run, err := s.GetTaskRun(id)
	if err != nil {
		return model.TaskRunDetailDO{}, err
	}
	steps, err := s.ListTaskSteps(id)
	if err != nil {
		return model.TaskRunDetailDO{}, err
	}
	if steps == nil {
		steps = []model.TaskStepDO{}
	}
	run.StepCount = len(steps)
	return model.TaskRunDetailDO{Run: run, Steps: steps}, nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanTaskRun(row scannable) (model.TaskRunDO, error) {
	var r model.TaskRunDO
	err := row.Scan(&r.ID, &r.Session, &r.Title, &r.Intent, &r.Status, &r.Source, &r.StartedAt, &r.EndedAt)
	return r, err
}

func scanTaskStep(row scannable) (model.TaskStepDO, error) {
	var st model.TaskStepDO
	var ok, approved int
	err := row.Scan(
		&st.ID, &st.RunID, &st.Seq, &st.Kind, &st.Provider, &st.Tool, &st.Action, &st.Intent, &st.Summary,
		&st.ArgsJSON, &st.Locator, &st.Result, &ok, &st.Error, &approved, &st.CreatedAt,
	)
	if err != nil {
		return st, errno.Wrap(errno.CodeStoreFailed, "读取任务步骤失败", err)
	}
	st.OK = ok == 1
	st.Approved = approved == 1
	if strings.TrimSpace(st.Kind) == "" {
		st.Kind = model.TaskStepKindOp
	}
	return st, nil
}
