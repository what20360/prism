# PRISM 的 GitHub 构建与公开访问

权威源码为 `what20360/prism` 的 `main` 分支。通过 GitHub Actions 构建，由 GitHub Pages 托管纯静态游戏；访问者无需 GitHub 账号。

- 游戏地址： https://what20360.github.io/prism/
- 工作流： `.github/workflows/deploy-pages.yml`
- 发布目录： `dist/`

首次启用 Pages 并成功运行工作流后，游戏地址才会生效。原来的私有测试站点与本地预览继续停止维护。

## 自动更新

每次推送到 `main`，工作流依次执行：

1. 检出该次提交，使用 Node.js 22 和 `npm ci` 安装锁定依赖。
2. 执行 `npm test`。
3. 以 `VITE_BASE_PATH=/prism/` 执行 `npm run build`，确保脚本与样式从仓库子路径加载。
4. 上传 `dist/`，部署到 `github-pages` 环境。

测试或构建失败不会发布该次修改，原有成功部署保留。Actions 可以查看进度和错误，并使用 `Run workflow` 手动发布；新推送会取消较旧的运行。更新经过构建与发布后生效，并非即时文件同步。

工作流只使用 GitHub 官方 Actions 与短期 `GITHUB_TOKEN`，无需额外服务、部署密钥或个人访问令牌。构建任务只读源码，部署任务拥有 `pages: write` 和 `id-token: write`。

## 首次启用（仅一次）

1. 在仓库打开 **Settings → Pages**。
2. 将 **Build and deployment → Source** 设为 **GitHub Actions**。
3. 若 fork 的 Actions 尚未启用，在 **Actions** 页启用工作流。
4. 打开 **Deploy PRISM to GitHub Pages**，点击 **Run workflow**，选择 `main`。
5. 等待 `build` 与 `deploy` 均成功，使用运行结果中提供的 Pages 链接。

日后只需向 `main` 提交代码。更改公开访问、域名或关闭 Pages 时仍需仓库管理员配置。

## 版本核对与本地构建

站点的 `/prism/version.json` 中 `commit_sha` 对应该次 GitHub Actions 的 `GITHUB_SHA`。本地普通构建保留 `/` 资源路径；可自行用 `VITE_BASE_PATH=/prism/ npm run build` 检查 Pages 输出。

设置依然保存在访问者自己的浏览器中，Pages 不提供跨设备存档或后端服务。源码保留 `npm run dev` 和 `npm run build:offline`，供用户自行运行；助手不再自动维护本地预览或离线发行文件。

## 历史站点

原私有测试地址为 https://prism-what20360.what20360.chatgpt.site ，现有版本保留，不保证与 GitHub 最新源码一致。保留 `.openai/hosting.json` 中的既有身份与访问范围，不自动同步、不删除、不改为公开。

`.openai/source.json` 仅为历史 Sites 工作区的来源记录，不提交到 GitHub。构建脚本优先使用 Actions 提供的提交 SHA；普通 GitHub 克隆在无来源记录时使用本地 Git 提交。
