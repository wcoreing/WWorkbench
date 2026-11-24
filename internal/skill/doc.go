// Package skill 是方法包（Skill）独立领域：只提供契约与存储接口。
//
// 产品（项目 / 任务 / 笔记本 / Agent / 商店）各自实现路径策略与场景业务，
// 不得把「默认落到工作流/」等产品语义写进本包核心。
//
// 对外动词：List / Get / Put / Pin / ListVersions / Restore / Export / Install。
// 分发面：ListShelf / Materialize（本机货架）；商店适配器只调 Export/Install。
//
// FS 后端见子包 fsstore（实现 Store）；正文模板见 docfmt（纯函数）。
// 领域核心不依赖 notebook.Service；笔记本可委托 Store / docfmt。
package skill
