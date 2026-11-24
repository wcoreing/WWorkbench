package app

import (
	"WWorkbench/internal/errno"
	"WWorkbench/internal/homeclient"
	"WWorkbench/internal/notebook"
)

// ListSkillShelf 列出本机技能货架。
func (s *Service) ListSkillShelf() ApiResult[[]notebook.ShelfCard] {
	if s.notebook == nil {
		return ErrResult[[]notebook.ShelfCard](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	cards, err := s.notebook.ListSkillShelf()
	if err != nil {
		return ErrResult[[]notebook.ShelfCard](err)
	}
	return OkResult(cards)
}

// ExportSkillShelf 把选中的技能目录导出到本机货架。
func (s *Service) ExportSkillShelf(dirRel string) ApiResult[notebook.ShelfManifest] {
	if s.notebook == nil {
		return ErrResult[notebook.ShelfManifest](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	manifest, err := s.notebook.ExportSkillPackage(dirRel)
	if err != nil {
		return ErrResult[notebook.ShelfManifest](err)
	}
	return OkResult(manifest)
}

// InstallSkillShelf 安装货架上的一个版本到对应业务根，并打目录版本。
func (s *Service) InstallSkillShelf(id, version string) ApiResult[notebook.ShelfInstallResult] {
	if s.notebook == nil {
		return ErrResult[notebook.ShelfInstallResult](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	out, err := s.notebook.InstallSkillPackage(id, version)
	if err != nil {
		return ErrResult[notebook.ShelfInstallResult](err)
	}
	return OkResult(out)
}

// ListSkillMarket 列出账号服务上的技能商店。
func (s *Service) ListSkillMarket() ApiResult[[]homeclient.MarketListing] {
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[[]homeclient.MarketListing](err)
	}
	list, err := c.ListMarket()
	if err != nil {
		return ErrResult[[]homeclient.MarketListing](errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), ""))
	}
	return OkResult(list)
}

// PublishSkillMarket 把选中技能目录导出并上架到账号服务。需要已登录。
func (s *Service) PublishSkillMarket(dirRel string) ApiResult[homeclient.MarketListing] {
	if s.notebook == nil {
		return ErrResult[homeclient.MarketListing](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[homeclient.MarketListing](err)
	}
	if err := requireLogin(c); err != nil {
		return ErrResult[homeclient.MarketListing](err)
	}
	manifest, err := s.notebook.ExportSkillPackage(dirRel)
	if err != nil {
		return ErrResult[homeclient.MarketListing](err)
	}
	bodies, err := s.notebook.ReadShelfBodies(manifest.ID, manifest.Version)
	if err != nil {
		return ErrResult[homeclient.MarketListing](err)
	}
	saved, err := c.PublishMarket(homeclient.MarketPackage{
		MarketListing: homeclient.MarketListing{
			ID: manifest.ID, Name: manifest.Name, Version: manifest.Version,
			Root: manifest.Root, Bind: manifest.Bind, Intent: manifest.Intent,
			Description: manifest.Description, Limits: manifest.Limits, Files: manifest.Files,
		},
		Bodies: bodies,
	})
	if err != nil {
		return ErrResult[homeclient.MarketListing](errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), ""))
	}
	return OkResult(*saved)
}

// InstallSkillMarket 从商店下载一个版本，放进货架并安装。安装后仍由人确认危险动作。
func (s *Service) InstallSkillMarket(id, version string) ApiResult[notebook.ShelfInstallResult] {
	if s.notebook == nil {
		return ErrResult[notebook.ShelfInstallResult](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	c, err := s.homeClient()
	if err != nil {
		return ErrResult[notebook.ShelfInstallResult](err)
	}
	pkg, err := c.GetMarketPackage(id, version)
	if err != nil {
		return ErrResult[notebook.ShelfInstallResult](errno.New(errno.CodeInvalidArg, homeclient.HumanizeAuthError(err), ""))
	}
	manifest := notebook.ShelfManifest{
		ID: pkg.ID, Name: pkg.Name, Version: pkg.Version, Root: pkg.Root, Bind: pkg.Bind,
		Intent: pkg.Intent, Description: pkg.Description, Limits: pkg.Limits, Files: pkg.Files,
		SharedBy: pkg.AuthorName,
	}
	if err := s.notebook.MaterializeShelfPackage(manifest, pkg.Bodies); err != nil {
		return ErrResult[notebook.ShelfInstallResult](err)
	}
	out, err := s.notebook.InstallSkillPackage(pkg.ID, pkg.Version)
	if err != nil {
		return ErrResult[notebook.ShelfInstallResult](err)
	}
	return OkResult(out)
}
