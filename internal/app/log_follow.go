package app

import (
	"context"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/logs"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type logFollowEntry struct {
	cancel context.CancelFunc
}

type logFollowManager struct {
	mu      sync.Mutex
	active  map[string]*logFollowEntry
	service *Service
}

// newLogFollowManager 创建日志跟随管理器。
func newLogFollowManager(s *Service) *logFollowManager {
	return &logFollowManager{active: map[string]*logFollowEntry{}, service: s}
}

// CloseAll 停止全部跟随任务。
func (m *logFollowManager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, e := range m.active {
		if e.cancel != nil {
			e.cancel()
		}
		delete(m.active, id)
	}
}

// Start 启动日志实时跟随，返回流 ID。
func (m *logFollowManager) Start(src model.LogSourceDO, tail int) (string, error) {
	if err := validateLogSourceConfig(src); err != nil {
		return "", err
	}
	streamID := uuid.NewString()
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.active[streamID] = &logFollowEntry{cancel: cancel}
	m.mu.Unlock()
	go m.run(ctx, streamID, src, tail)
	return streamID, nil
}

// Stop 停止指定跟随流。
func (m *logFollowManager) Stop(streamID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.active[streamID]; ok {
		if e.cancel != nil {
			e.cancel()
		}
		delete(m.active, streamID)
	}
}

func (m *logFollowManager) run(ctx context.Context, streamID string, src model.LogSourceDO, tail int) {
	defer m.Stop(streamID)
	var prev string
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	emit := func(chunk string, reset bool) {
		if chunk == "" && !reset {
			return
		}
		runtime.EventsEmit(m.service.ctx, "logs:chunk", map[string]interface{}{
			"streamId": streamID,
			"chunk":    chunk,
			"reset":    reset,
		})
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reqCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
			content, err := logs.Fetch(reqCtx, src, m.service.sshHosts, m.service.docker, tail)
			cancel()
			if err != nil {
				emit(err.Error()+"\n", false)
				continue
			}
			chunk, reset := logsDiffAppend(prev, content)
			prev = content
			emit(chunk, reset)
		}
	}
}

// logsDiffAppend 计算相对上次快照的新增文本。
func logsDiffAppend(prev, full string) (chunk string, reset bool) {
	if prev == "" {
		return full, len(full) > 0
	}
	if strings.HasPrefix(full, prev) {
		return full[len(prev):], false
	}
	return full, true
}

// StartLogFollow 启动日志实时跟随。
func (s *Service) StartLogFollow(src model.LogSourceDO, tail int) ApiResult[string] {
	id, err := s.logFollow.Start(src, tail)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(id)
}

// StopLogFollow 停止日志跟随。
func (s *Service) StopLogFollow(streamID string) ApiResult[bool] {
	if s.logFollow != nil {
		s.logFollow.Stop(streamID)
	}
	return OkResult(true)
}
