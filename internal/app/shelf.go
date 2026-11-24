package app

import (
	"path/filepath"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/homeclient"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/skill"
	"WWorkbench/internal/skill/fsstore"
	"WWorkbench/internal/workbenchtools"
)

// newSkillStore 产品路径策略注入 PreferRoots；磁盘根可与笔记本工作区重合，但不依赖 notebook.Service。
func newSkillStore(nb *notebook.Service) skill.Store {
	if nb == nil {
		return nil
	}
	packageRoot := nb.WorkspacePath()
	if packageRoot == "" {
		return nil
	}
	return fsstore.New(fsstore.Options{
		DataDir:     filepath.Dir(packageRoot),
		PackageRoot: packageRoot,
		PreferRoots: notebook.SystemTopDirs(),
		DefaultRoot: notebook.SkillGroupName,
	})
}

func (s *Service) skillStore() skill.Store {
	if s == nil {
		return nil
	}
	if s.skills != nil {
		return s.skills
	}
	return newSkillStore(s.notebook)
}

// ListSkillShelf 列出本机技能货架（经 skill 领域）。
func (s *Service) ListSkillShelf() ApiResult[[]skill.ShelfCard] {
	st := s.skillStore()
	if st == nil {
		return ErrResult[[]skill.ShelfCard](errno.New(errno.CodeInvalidArg, "技能存储未就绪", ""))
	}
	cards, err := st.ListShelf()
	if err != nil {
		return ErrResult[[]skill.ShelfCard](err)
	}
	return OkResult(cards)
}

// ExportSkillShelf 把选中的技能目录导出到本机货架。
func (s *Service) ExportSkillShelf(dirRel string) ApiResult[skill.Bundle] {
	st := s.skillStore()
	if st == nil {
		return ErrResult[skill.Bundle](errno.New(errno.CodeInvalidArg, "技能存储未就绪", ""))
	}
	bundle, err := st.Export(dirRel)
	if err != nil {
		return ErrResult[skill.Bundle](err)
	}
	return OkResult(bundle)
}

// InstallSkillShelf 安装货架上的一个版本到对应业务根，并打目录版本。
func (s *Service) InstallSkillShelf(id, version string) ApiResult[skill.InstallResult] {
	st := s.skillStore()
	if st == nil {
		return ErrResult[skill.InstallResult](errno.New(errno.CodeInvalidArg, "技能存储未就绪", ""))
	}
	out, err := st.Install(id, version)
	if err != nil {
		return ErrResult[skill.InstallResult](err)
	}
	return OkResult(out)
}

// ListSkillPackages 列出已安装方法包摘要（上架候选；prefix 可筛业务根）。
func (s *Service) ListSkillPackages(prefix string) ApiResult[[]skill.Package] {
	st := s.skillStore()
	if st == nil {
		return ErrResult[[]skill.Package](errno.New(errno.CodeInvalidArg, "技能存储未就绪", ""))
	}
	list, err := st.List(prefix)
	if err != nil {
		return ErrResult[[]skill.Package](err)
	}
	return OkResult(list)
}

// ListSkillMarket 列出账号服务上的技能商店。
func (s *Service) ListSkillMarket() ApiResult[[]homeclient.MarketListing] {
	list, err := s.listSkillMarket()
	if err != nil {
		return ErrResult[[]homeclient.MarketListing](err)
	}
	return OkResult(list)
}

// PublishSkillMarket 把选中技能目录导出并上架到账号服务。需要已登录。
func (s *Service) PublishSkillMarket(dirRel string) ApiResult[homeclient.MarketListing] {
	saved, err := s.publishSkillMarket(dirRel)
	if err != nil {
		return ErrResult[homeclient.MarketListing](err)
	}
	return OkResult(saved)
}

// InstallSkillMarket 从商店下载一个版本，放进货架并安装。安装后仍由人确认危险动作。
func (s *Service) InstallSkillMarket(id, version string) ApiResult[skill.InstallResult] {
	out, err := s.installSkillMarket(id, version)
	if err != nil {
		return ErrResult[skill.InstallResult](err)
	}
	return OkResult(out)
}

func (s *Service) listSkillMarket() ([]homeclient.MarketListing, error) {
	c, err := s.homeClient()
	if err != nil {
		return nil, err
	}
	list, err := c.ListMarket()
	if err != nil {
		return nil, errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), "")
	}
	return list, nil
}

func (s *Service) publishSkillMarket(dirRel string) (homeclient.MarketListing, error) {
	st := s.skillStore()
	if st == nil {
		return homeclient.MarketListing{}, errno.New(errno.CodeInvalidArg, "技能存储未就绪", "")
	}
	c, err := s.homeClient()
	if err != nil {
		return homeclient.MarketListing{}, err
	}
	if err := requireLogin(c); err != nil {
		return homeclient.MarketListing{}, err
	}
	bundle, err := st.Export(dirRel)
	if err != nil {
		return homeclient.MarketListing{}, err
	}
	if bundle.Unchanged {
		has, err := marketHasCommit(c, bundle.ID, bundle.Version)
		if err != nil {
			return homeclient.MarketListing{}, err
		}
		if has {
			return homeclient.MarketListing{}, errno.New(errno.CodeInvalidArg, "没有新的提交", dirRel)
		}
	}
	bodies, err := st.ReadBundleBodies(bundle.ID, bundle.Version)
	if err != nil {
		return homeclient.MarketListing{}, err
	}
	saved, err := c.PublishMarket(homeclient.MarketPackage{
		MarketListing: homeclient.MarketListing{
			ID: bundle.ID, Name: bundle.Name, Version: bundle.Version,
			Root: bundle.Root, Bind: bundle.Bind, Intent: bundle.Intent,
			Description: bundle.Description, Limits: bundle.Limits, Files: bundle.Files,
		},
		Bodies: bodies,
	})
	if err != nil {
		return homeclient.MarketListing{}, errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), "")
	}
	return *saved, nil
}

// marketHasCommit 云端该仓库是否已有这次提交。没有则允许把本机已有快照再推一次。
func marketHasCommit(c *homeclient.Client, id, version string) (bool, error) {
	list, err := c.ListMarket()
	if err != nil {
		return false, errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), "")
	}
	for _, it := range list {
		if it.ID == id && it.Version == version {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) installSkillMarket(id, version string) (skill.InstallResult, error) {
	st := s.skillStore()
	if st == nil {
		return skill.InstallResult{}, errno.New(errno.CodeInvalidArg, "技能存储未就绪", "")
	}
	c, err := s.homeClient()
	if err != nil {
		return skill.InstallResult{}, err
	}
	pkg, err := c.GetMarketPackage(id, version)
	if err != nil {
		return skill.InstallResult{}, errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), "")
	}
	bundle := skill.Bundle{
		ID: pkg.ID, Name: pkg.Name, Version: pkg.Version, Root: pkg.Root, Bind: pkg.Bind,
		Intent: pkg.Intent, Description: pkg.Description, Limits: pkg.Limits, Files: pkg.Files,
		SharedBy: pkg.AuthorName, Bodies: pkg.Bodies,
	}
	if err := st.Materialize(bundle); err != nil {
		return skill.InstallResult{}, err
	}
	return st.Install(pkg.ID, pkg.Version)
}

// skillMarketOps MCP / 工具面接入：复用本 Service 的商店原语。
func (s *Service) skillMarketOps() *workbenchtools.SkillMarketOps {
	return &workbenchtools.SkillMarketOps{
		List: func() ([]homeclient.MarketListing, error) {
			return s.listSkillMarket()
		},
		Publish: func(dirRel string) (homeclient.MarketListing, error) {
			return s.publishSkillMarket(dirRel)
		},
		Install: func(id, version string) (skill.InstallResult, error) {
			return s.installSkillMarket(id, version)
		},
		ListShelf: func() ([]skill.ShelfCard, error) {
			st := s.skillStore()
			if st == nil {
				return nil, errno.New(errno.CodeInvalidArg, "技能存储未就绪", "")
			}
			return st.ListShelf()
		},
	}
}
