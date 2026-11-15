package app

import (
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/homeclient"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/store"
)

func (s *Service) homeClient() (*homeclient.Client, error) {
	token, _ := s.store.GetAppSetting(store.SettingHomeAccessToken)
	return homeclient.New(homeclient.ResolveBaseURL(), token), nil
}

func deviceName(fallback string) string {
	host, _ := os.Hostname()
	if host != "" {
		return host
	}
	if fallback != "" {
		return fallback
	}
	return "wwb"
}

func (s *Service) persistAuth(res *homeclient.AuthResponse) error {
	if res == nil {
		return errno.New(errno.CodeInvalidArg, "登录响应为空", "")
	}
	if err := s.store.SetAppSetting(store.SettingHomeAccountID, res.AccountID); err != nil {
		return err
	}
	if err := s.store.SetAppSetting(store.SettingHomeUsername, res.Username); err != nil {
		return err
	}
	return s.store.SetAppSetting(store.SettingHomeAccessToken, res.AccessToken)
}

// GetHomeStatus 本机账号服务连接状态。
func (s *Service) GetHomeStatus() ApiResult[model.HomeStatusDO] {
	url := homeclient.ResolveBaseURL()
	accountID, _ := s.store.GetAppSetting(store.SettingHomeAccountID)
	username, _ := s.store.GetAppSetting(store.SettingHomeUsername)
	token, _ := s.store.GetAppSetting(store.SettingHomeAccessToken)
	st := model.HomeStatusDO{
		URL:       url,
		AccountID: strings.TrimSpace(accountID),
		Username:  strings.TrimSpace(username),
		LoggedIn:  strings.TrimSpace(token) != "",
		HasToken:  strings.TrimSpace(token) != "",
	}
	c := homeclient.New(url, token)
	if err := c.Health(); err != nil {
		st.Error = homeclient.HumanizeAuthError(err)
		return OkResult(st)
	}
	st.Reachable = true
	if st.LoggedIn {
		if aid, uname, err := c.Me(); err == nil {
			st.AccountID = aid
			st.Username = uname
			_ = s.store.SetAppSetting(store.SettingHomeAccountID, aid)
			_ = s.store.SetAppSetting(store.SettingHomeUsername, uname)
		} else {
			st.LoggedIn = false
			st.Error = err.Error()
		}
	}
	return OkResult(st)
}

// HomeRegister 注册并登录账号服务。
func (s *Service) HomeRegister(in model.HomeAuthDO) ApiResult[model.HomeStatusDO] {
	user := strings.TrimSpace(in.Username)
	if err := homeclient.ValidateAuth(user, in.Password); err != nil {
		return ErrResult[model.HomeStatusDO](errno.New(errno.CodeInvalidArg, err.Error(), ""))
	}
	c := homeclient.New(homeclient.ResolveBaseURL(), "")
	res, err := c.Register(user, in.Password, deviceName(in.Device))
	if err != nil {
		return ErrResult[model.HomeStatusDO](errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), ""))
	}
	if err := s.persistAuth(res); err != nil {
		return ErrResult[model.HomeStatusDO](err)
	}
	return s.homeStatusAfterAuthSync()
}

// HomeLogin 登录账号服务（同账号换机即可同步）。
func (s *Service) HomeLogin(in model.HomeAuthDO) ApiResult[model.HomeStatusDO] {
	user := strings.TrimSpace(in.Username)
	if err := homeclient.ValidateAuth(user, in.Password); err != nil {
		return ErrResult[model.HomeStatusDO](errno.New(errno.CodeInvalidArg, err.Error(), ""))
	}
	c := homeclient.New(homeclient.ResolveBaseURL(), "")
	res, err := c.Login(user, in.Password, deviceName(in.Device))
	if err != nil {
		return ErrResult[model.HomeStatusDO](errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), ""))
	}
	if err := s.persistAuth(res); err != nil {
		return ErrResult[model.HomeStatusDO](err)
	}
	return s.homeStatusAfterAuthSync()
}

// homeStatusAfterAuthSync 登录/注册成功后自动双向同步台账。
func (s *Service) homeStatusAfterAuthSync() ApiResult[model.HomeStatusDO] {
	st := s.GetHomeStatus()
	if !st.Ok {
		return st
	}
	syncRes := s.HomeSyncNow()
	if !syncRes.Ok && syncRes.Error != nil {
		// 登录已成功；同步失败只记提示，不阻断会话
		msg := syncRes.Error.Message
		if syncRes.Error.Detail != "" {
			msg = msg + "（" + syncRes.Error.Detail + "）"
		}
		st.Data.Error = "已登录，但同步失败：" + msg
	}
	return st
}

// HomeLogout 退出账号（清除本机会话）。
func (s *Service) HomeLogout() ApiResult[model.HomeStatusDO] {
	if c, err := s.homeClient(); err == nil && strings.TrimSpace(c.Token) != "" {
		_ = c.Logout()
	}
	_ = s.store.SetAppSetting(store.SettingHomeAccountID, "")
	_ = s.store.SetAppSetting(store.SettingHomeUsername, "")
	_ = s.store.SetAppSetting(store.SettingHomeAccessToken, "")
	_ = s.store.SetAppSetting(store.SettingHomeDeviceID, "")
	_ = s.store.SetAppSetting(store.SettingHomeDeviceToken, "")
	return s.GetHomeStatus()
}

func requireLogin(c *homeclient.Client) error {
	if c == nil || strings.TrimSpace(c.Token) == "" {
		return errno.New(errno.CodeInvalidArg, "请先登录账号", "")
	}
	return nil
}

// HomePushProject 推送单个项目台账 + 项目区笔记。
func (s *Service) HomePushProject(id string) ApiResult[model.HomePushPullResultDO] {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrResult[model.HomePushPullResultDO](errno.New(errno.CodeInvalidArg, "id 不能为空", ""))
	}
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	p, err := s.store.GetWorkbenchProject(id)
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	saved, err := c.PutProject(projectToHomeClient(p))
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](errno.Wrap(errno.CodeStoreFailed, "推送项目失败", err))
	}
	out := model.HomePushPullResultDO{Project: homeClientToProject(*saved)}
	out.DocsPushed = s.pushProjectDocs(c, p)
	out.Note = "已推送到账号云端"
	return OkResult(out)
}

func (s *Service) pushProjectDocs(c *homeclient.Client, p model.WorkbenchProjectDO) int {
	if s.notebook == nil || c == nil {
		return 0
	}
	n := 0
	name := p.Name
	if name == "" {
		name = filepath.Base(p.LocalPath)
	}
	prefix := notebook.WorkbenchProjectDirRel(name)
	list, err := s.notebook.ListNotes()
	if err != nil {
		return 0
	}
	for _, sum := range list {
		nid := strings.TrimSpace(sum.ID)
		if nid == "" {
			continue
		}
		if !strings.HasPrefix(nid, prefix+"/") && nid != prefix {
			pinned := false
			for _, l := range p.Links {
				if (l.Kind == "note" || l.Kind == "skill") && l.ID == nid {
					pinned = true
					break
				}
			}
			if !pinned {
				continue
			}
		}
		note, err := s.notebook.GetNote(nid)
		if err != nil || note == nil {
			continue
		}
		if _, err := c.PutDoc(nid, note.Content, 0); err == nil {
			n++
		}
	}
	return n
}

// HomePullProject 从账号云端拉取单个项目。
func (s *Service) HomePullProject(id string) ApiResult[model.HomePushPullResultDO] {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrResult[model.HomePushPullResultDO](errno.New(errno.CodeInvalidArg, "id 不能为空", ""))
	}
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	hp, err := c.GetProject(id)
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](errno.Wrap(errno.CodeNotFound, "拉取项目失败", err))
	}
	local, err := s.store.GetWorkbenchProject(id)
	merged := homeClientToProject(*hp)
	if err == nil {
		if strings.TrimSpace(local.LocalPath) != "" {
			merged.LocalPath = local.LocalPath
		}
		merged.CreatedAt = local.CreatedAt
	}
	saved, err := s.store.SaveWorkbenchProject(merged)
	if err != nil {
		return ErrResult[model.HomePushPullResultDO](err)
	}
	out := model.HomePushPullResultDO{Project: saved}
	out.DocsPulled = s.pullProjectDocs(c, saved)
	out.Note = "已从账号云端拉取"
	return OkResult(out)
}

func (s *Service) pullProjectDocs(c *homeclient.Client, p model.WorkbenchProjectDO) int {
	if s.notebook == nil || c == nil {
		return 0
	}
	name := p.Name
	if name == "" {
		name = filepath.Base(p.LocalPath)
	}
	prefix := notebook.WorkbenchProjectDirRel(name)
	metas, err := c.ListDocs(prefix)
	if err != nil {
		return 0
	}
	n := 0
	for _, m := range metas {
		doc, err := c.GetDoc(m.Path)
		if err != nil || doc == nil {
			continue
		}
		title := filepath.Base(m.Path)
		title = strings.TrimSuffix(title, filepath.Ext(title))
		note := model.NoteDO{
			ID:       m.Path,
			GroupID:  filepath.ToSlash(filepath.Dir(m.Path)),
			Title:    title,
			Content:  doc.Content,
			Language: "markdown",
			Role:     model.NoteRoleNote,
		}
		if _, err := s.notebook.SaveNote(note); err == nil {
			n++
		}
	}
	return n
}

// HomeListRemoteProjects 列出当前账号云端项目。
func (s *Service) HomeListRemoteProjects() ApiResult[[]model.WorkbenchProjectDO] {
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[[]model.WorkbenchProjectDO](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[[]model.WorkbenchProjectDO](err)
	}
	list, err := c.ListProjects()
	if err != nil {
		return ErrResult[[]model.WorkbenchProjectDO](errno.Wrap(errno.CodeStoreFailed, "列出云端项目失败", err))
	}
	out := make([]model.WorkbenchProjectDO, 0, len(list))
	for _, p := range list {
		out = append(out, homeClientToProject(p))
	}
	return OkResult(out)
}
