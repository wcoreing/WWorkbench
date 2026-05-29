package app

// ListAppSettings 列出全部应用设置。
func (s *Service) ListAppSettings() ApiResult[map[string]string] {
	m, err := s.store.ListAppSettings()
	if err != nil {
		return ErrResult[map[string]string](err)
	}
	if m == nil {
		m = map[string]string{}
	}
	return OkResult(m)
}

// SetAppSetting 保存单项应用设置。
func (s *Service) SetAppSetting(key, value string) ApiResult[bool] {
	if err := s.store.SetAppSetting(key, value); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// LoadWorkspace 读取产品线工作区 JSON 快照。
func (s *Service) LoadWorkspace(product string) ApiResult[string] {
	content, err := s.store.LoadWorkspaceJSON(product)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(content)
}

// SaveWorkspace 保存产品线工作区 JSON 快照。
func (s *Service) SaveWorkspace(product, content string) ApiResult[bool] {
	if err := s.store.SaveWorkspaceJSON(product, content); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
