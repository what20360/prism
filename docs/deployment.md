# PRISM 源码交付约定

从 2026-10-30 起，按用户要求仅将开发成果提交到 `what20360/prism` 的 `main` 分支。停止维护本地预览和测试站点，不再自动同步 Site 源码、打包发布或更新离线下载文件；再次部署需用户明确提出。

## 当前开发流程

1. 读取 GitHub `main` 最新状态，避免覆盖外部提交。
2. 按需求修改代码与相应文档，运行相关测试和 `npm run build`。
3. 将验证后的源码提交到 GitHub，更新分支时检查预期旧 SHA。
4. 提供 GitHub 提交链接与验证结果。

`AGENTS.md` 保存了同一交付约定。生产构建用于校验代码，不意味着站点已经发布。

## 历史站点

原私有测试地址为 https://prism-what20360.what20360.chatgpt.site ，其现有版本保留，不保证与 GitHub 最新源码一致。保留 `.openai/hosting.json` 中的既有身份与访问范围，不新建、不删除、不改为公开。

`.openai/source.json` 仅为历史 Sites 工作区的来源记录，不提交到 GitHub。`scripts/write-build-info.mjs` 仍可记录构建来源；在普通 GitHub 克隆中使用本地 Git 提交。

源码仍保留 `npm run dev` 和 `npm run build:offline`，供用户自行运行；助手不再自动维护对应预览和发行文件。
