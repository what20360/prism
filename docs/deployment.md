# PRISM 私有测试站点与源码同步

站点地址：https://prism-what20360.what20360.chatgpt.site

| 项目 | 配置 |
|---|---|
| 权威源码 | `what20360/prism` 的 `main` 分支 |
| Site 身份 | `.openai/hosting.json` 中的 `project_id`，后续不得另建站点替代 |
| 访问范围 | 仅站点所有者，保持私有 |
| 发布产物 | `npm run build` 生成的 `dist/` |
| 版本核对 | 站点 `/version.json` 中的 `commit_sha` 对应 GitHub 提交 |

## 每次开发后的同步流程

1. 读取 GitHub `main` 的最新状态与当前 Site，避免覆盖他人的新提交。
2. 完成功能，运行相关测试和生产构建，将源码提交到 GitHub。
3. 按 Sites 技能打开同一 Site 的源码仓库，将刚提交的 GitHub 快照同步进去；保留 Site 的 Git 元数据和 `.openai/hosting.json`。
4. 在 Sites 源码工作区写入 `.openai/source.json`，记录本次 GitHub 快照：

```json
{
  "repository": "what20360/prism",
  "branch": "main",
  "commit_sha": "本次 GitHub 提交的完整 SHA"
}
```

5. 使用 Sites 的源码工作流执行必要检查与构建、提交、推送和打包。打包产物和提交必须来自同一个源码状态。
6. 发布这个确切版本，等待部署成功，再提供同一站点地址和对应提交。

`scripts/write-build-info.mjs` 在构建后写出 `dist/version.json`。Sites 构建优先读取上述来源记录；普通 GitHub 克隆中的本地构建使用本地 Git 提交。

## 同步范围

以后在本项目中由助手完成的代码修改，应按上述流程同时更新 GitHub 与站点；根目录 `AGENTS.md` 保存了这项约定。

当前账号未启用 Sites 的「推送即发布」，因此采用显式保存、发布和核对版本的流程。Sites 的此项能力面向其自身的源码仓库，也不等于 GitHub `main` 的任意推送都会自动部署。当前没有配置定时监控或永久 GitHub webhook。

若在 GitHub 网页或本机直接修改代码，需要再执行一次此同步发布流程，站点才会更新。

浏览器设置保存在访问站点的浏览器中。离线文件与这个站点使用不同地址，其设置分别保存。
