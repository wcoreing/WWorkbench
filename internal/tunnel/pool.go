package tunnel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/model"

	"golang.org/x/crypto/ssh"
)

// SSHPoolIdle 引用归零后保留热连接的时长（二次打开免握手）。
const SSHPoolIdle = 5 * time.Minute

type sshPoolEntry struct {
	key    string
	client *ssh.Client
	refs   int
	idle   *time.Timer
}

type sshPoolState struct {
	mu      sync.Mutex
	byKey   map[string]*sshPoolEntry
	byClient map[*ssh.Client]*sshPoolEntry
	dialing map[string]*sshDialWait
}

type sshDialWait struct {
	done   chan struct{}
	client *ssh.Client
	err    error
}

var sshPool = &sshPoolState{
	byKey:    make(map[string]*sshPoolEntry),
	byClient: make(map[*ssh.Client]*sshPoolEntry),
	dialing:  make(map[string]*sshDialWait),
}

// AcquireSSH 取得主机级共享 SSH 连接（同一 user@host:port+认证 复用）。
// 用完必须 ReleaseSSH；连接已死后调 DropSSH。禁止对返回值直接 Close。
// reused 表示命中池中已有连接（未重新握手）。
func AcquireSSH(ctx context.Context, spec model.TunnelSpecDO) (client *ssh.Client, reused bool, err error) {
	key := specPoolKey(spec)
	for {
		sshPool.mu.Lock()
		if e := sshPool.byKey[key]; e != nil && e.client != nil {
			e.refs++
			if e.idle != nil {
				e.idle.Stop()
				e.idle = nil
			}
			c := e.client
			sshPool.mu.Unlock()
			return c, true, nil
		}
		if w := sshPool.dialing[key]; w != nil {
			sshPool.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, false, ctx.Err()
			case <-w.done:
			}
			if w.err != nil {
				return nil, false, w.err
			}
			// 拨号方已放入池；下一轮加引用
			continue
		}
		w := &sshDialWait{done: make(chan struct{})}
		sshPool.dialing[key] = w
		sshPool.mu.Unlock()

		c, dialErr := DialSSH(ctx, spec)
		sshPool.mu.Lock()
		delete(sshPool.dialing, key)
		if dialErr != nil {
			w.err = dialErr
			close(w.done)
			sshPool.mu.Unlock()
			return nil, false, dialErr
		}
		KeepAlive(c)
		e := &sshPoolEntry{key: key, client: c, refs: 1}
		sshPool.byKey[key] = e
		sshPool.byClient[c] = e
		w.client = c
		close(w.done)
		sshPool.mu.Unlock()

		go watchPooledSSH(key, c)
		return c, false, nil
	}
}

// ReleaseSSH 归还共享连接；引用归零后闲置 SSHPoolIdle 再真正关闭。
// 已 Drop 或不在池中时为空操作（勿对裸 DialSSH 结果调用）。
func ReleaseSSH(client *ssh.Client) {
	if client == nil {
		return
	}
	sshPool.mu.Lock()
	e := sshPool.byClient[client]
	if e == nil {
		sshPool.mu.Unlock()
		return
	}
	if e.refs > 0 {
		e.refs--
	}
	if e.refs > 0 {
		sshPool.mu.Unlock()
		return
	}
	if e.idle != nil {
		e.idle.Stop()
	}
	key := e.key
	cl := e.client
	e.idle = time.AfterFunc(SSHPoolIdle, func() {
		sshPool.mu.Lock()
		cur := sshPool.byKey[key]
		if cur == nil || cur.client != cl || cur.refs > 0 {
			sshPool.mu.Unlock()
			return
		}
		delete(sshPool.byKey, key)
		delete(sshPool.byClient, cl)
		sshPool.mu.Unlock()
		_ = cl.Close()
	})
	sshPool.mu.Unlock()
}

// DropSSH 连接已失效：立刻移出池并关闭（忽略引用计数）。
func DropSSH(client *ssh.Client) {
	if client == nil {
		return
	}
	sshPool.mu.Lock()
	e := sshPool.byClient[client]
	if e == nil {
		sshPool.mu.Unlock()
		_ = client.Close()
		return
	}
	if e.idle != nil {
		e.idle.Stop()
	}
	delete(sshPool.byKey, e.key)
	delete(sshPool.byClient, client)
	sshPool.mu.Unlock()
	_ = client.Close()
}

// CloseSSHPool 进程退出时关闭全部热连接。
func CloseSSHPool() {
	sshPool.mu.Lock()
	clients := make([]*ssh.Client, 0, len(sshPool.byClient))
	for c, e := range sshPool.byClient {
		if e.idle != nil {
			e.idle.Stop()
		}
		clients = append(clients, c)
	}
	sshPool.byKey = make(map[string]*sshPoolEntry)
	sshPool.byClient = make(map[*ssh.Client]*sshPoolEntry)
	sshPool.mu.Unlock()
	for _, c := range clients {
		_ = c.Close()
	}
}

// SSHPoolStats 池状态（诊断 / 热连接展示）。
type SSHPoolStats struct {
	Entries int `json:"entries"`
	Refs    int `json:"refs"`
}

// GetSSHPoolStats 当前池条目与总引用数。
func GetSSHPoolStats() SSHPoolStats {
	sshPool.mu.Lock()
	defer sshPool.mu.Unlock()
	refs := 0
	for _, e := range sshPool.byKey {
		refs += e.refs
	}
	return SSHPoolStats{Entries: len(sshPool.byKey), Refs: refs}
}

func watchPooledSSH(key string, client *ssh.Client) {
	_ = client.Wait()
	sshPool.mu.Lock()
	e := sshPool.byKey[key]
	if e != nil && e.client == client {
		if e.idle != nil {
			e.idle.Stop()
		}
		delete(sshPool.byKey, key)
		delete(sshPool.byClient, client)
	}
	sshPool.mu.Unlock()
}

func specPoolKey(spec model.TunnelSpecDO) string {
	port := spec.Port
	if port <= 0 {
		port = 22
	}
	user := strings.TrimSpace(spec.User)
	host := strings.TrimSpace(spec.Host)
	var auth string
	if kp := strings.TrimSpace(spec.KeyPath); kp != "" {
		auth = "key:" + filepath.Clean(kp)
	} else if spec.Password != "" {
		sum := sha256.Sum256([]byte(spec.Password))
		auth = "pw:" + hex.EncodeToString(sum[:8])
	} else {
		auth = "agent"
	}
	return fmt.Sprintf("%s@%s:%d|%s", user, host, port, auth)
}
