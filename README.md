# LiberClean

<img src="./logo.png" width="96" height="96" alt="LiberClean logo" />

LiberClean 是一个基于 [Mole](https://github.com/tw93/Mole) 的独立 uTools 插件，为 macOS 提供系统状态查看、磁盘分析、应用卸载和日常维护的图形界面。

界面按插件小窗口设计，支持先检查、再选择和确认操作。实际维护由本机安装的 Mole 执行。

## 功能

| 功能 | 说明 |
| --- | --- |
| 系统概览 | 查看 CPU、内存、网络、存储空间等本机状态 |
| 磁盘分析 | 选择目录，查看占用并逐层浏览子目录 |
| 深度清理 | 预览缓存、日志等清理范围，确认后按 Mole 规则执行 |
| 应用卸载 | 选择应用，检查关联文件和保留项目后确认卸载 |
| 系统优化 | 检查维护项目，确认后执行缓存刷新等系统维护 |
| 项目清理 | 查找旧项目的依赖目录和构建产物，勾选并复核后清理 |
| 安装包清理 | 查找安装包，勾选并确认需要移除的文件 |
| 操作记录 | 查看 Mole 保存在本机的命令记录与删除记录 |
| 环境设置 | 自动检测或手动指定 mo 路径，查看版本、打开日志和更新 Mole |

每次打开插件都会重新检查 Mole 安装状态。未检测到可用命令时，界面会提供安装说明、重新检测和手动选择路径入口。

## 使用条件

- macOS，支持 Apple Silicon 和 Intel Mac。
- 已安装 [uTools](https://www.u-tools.cn/)。
- 已安装 Mole CLI。当前图形维护适配已在 Mole `1.61.0` 验证，其他版本需以运行时兼容性检查为准。
- 从源码开发或构建时，需要 Node.js `22.12+` 和 pnpm。日常运行插件使用 uTools 提供的运行环境。

### 安装 Mole

已安装 Homebrew 时，可以执行：

```bash
brew install mole
mo --version
```

脚本安装等其他方式见 [Mole 官方安装说明](https://github.com/tw93/Mole#quick-start)。完成后打开 LiberClean，点击我已安装，重新检测即可。

插件会查找系统 PATH、Homebrew 常见目录、`~/.local/bin/mo` 和 `~/bin/mo`。安装在其他位置时，可在环境设置中选择 mo 可执行文件。

## 从源码安装插件

```bash
git clone https://github.com/zdkcomeon/liberClean.git
cd liberClean
pnpm install
pnpm build
```

1. 在 uTools 中打开开发者工具。
2. 导入构建生成的 `dist/plugin.json`，将应用名称设为 LiberClean。
3. 按开发者工具的提示安装并打开插件。
4. 在 uTools 中搜索 `LiberClean` 进入系统概览。

构建目录包含插件入口、页面资源和本地脚本，可以独立加载，无需启动开发服务器。导入方式参见 [uTools 创建插件文档](https://next.u-tools.cn/docs/getting-started/create-plugin.html)。

### 搜索入口

| 指令示例 | 打开页面 |
| --- | --- |
| `LiberClean` | 系统概览 |
| `LiberClean 磁盘分析` | 磁盘分析 |
| `LiberClean 深度清理` | 深度清理 |
| `LiberClean 应用卸载` | 应用卸载 |
| `LiberClean 系统优化` | 系统优化 |
| `LiberClean 项目清理` | 项目清理 |
| `LiberClean 安装包清理` | 安装包清理 |
| `LiberClean 操作记录` | 操作记录 |

也可使用 `Mole`、`mo` 以及已有的 Mole 功能指令进入插件。

## 日常操作

### 检查与维护

进入维护页面后先检查当前范围。项目清理和安装包清理支持搜索、筛选与勾选文件，执行前会重新核对所选内容；深度清理和系统优化按 Mole 的规则整批处理。应用卸载会展示关联文件和将保留的项目，确认后才继续卸载。

需要管理员权限时，在插件的授权区域输入 Mac 登录密码。密码仅传给当前验证进程，不保存或写入插件日志；部分清理和优化流程也可以跳过管理员步骤。

清理操作可能永久删除文件，执行前请核对范围和页面提示。停止任务不会撤销已经完成的处理。

### 更新 Mole

在环境设置中点击更新 Mole，插件会调用当前安装的 `mo update`，显示检查、下载、安装和版本核对结果。更新采用 Mole 自带的安装渠道处理方式，具体支持范围见 [Mole 官方说明](https://github.com/tw93/Mole#quick-start)。

更新期间暂停系统状态采样，并阻止同时执行维护任务；完成后重新检测版本并恢复采样。网络或权限错误会显示在页面中，可处理后重试。打开插件时会自动检测安装状态，版本更新由用户点击触发。

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器固定使用 `http://127.0.0.1:5174`。在 uTools 开发者工具中导入仓库根目录的 `plugin.json`，其 `development.main` 会连接该地址。

前端页面支持 Vite 热更新。修改 `preload.js`、`maintenance.js`、`maintenance-helper.sh` 或 `mole-update.js` 后，需要结束插件进程并重新打开，让本地脚本重新加载。可在开发者工具中开启退出到后台立即结束运行，具体见 [uTools 运行与调试文档](https://next.u-tools.cn/docs/getting-started/run-debug.html)。

直接用普通浏览器打开页面会显示运行环境提示；调用本机命令需要 uTools 注入的桥接接口。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动本地开发服务器 |
| `pnpm test` | 运行后台逻辑与脚本适配测试 |
| `pnpm build` | 检查 TypeScript 并生成完整的插件目录 |

## 打包分发

先执行 `pnpm build`，再通过 uTools 开发者工具，将 `dist/` 作为插件根目录打包成 `.upx` 离线安装包。接收者可将 `.upx` 文件拖入 uTools 安装。具体流程见 [uTools 离线打包文档](https://www.u-tools.cn/docs/developer/basic/offline-plugin.html)。

分发使用构建后的 `dist/`，不要将包含源码、缓存和 `node_modules/` 的仓库根目录直接打包。构建过程会去除开发服务器配置，并生成适用于本地文件加载的页面资源。

## 项目结构

```text
src/
  App.tsx                 页面入口、导航与状态管理
  MaintenancePage.tsx     清理与优化的图形操作界面
  UninstallPage.tsx       应用列表与卸载流程
  MoleEnvironment.tsx     安装提示、更新状态与授权窗口
  api.ts                  本地桥接接口
  types.ts                界面与桥接接口的数据类型
  plugin.css              插件小窗口布局
preload.js                uTools 本地能力与任务管理
maintenance.js            维护流程适配与结果校验
maintenance-helper.sh     Mole 脚本的图形交互适配
mole-update.js            Mole 更新、授权与版本核对
plugin.json               插件入口与搜索指令
vite.config.mts           前端构建与插件目录组装
tests/                    后台逻辑和脚本测试
dist/                     构建生成的插件目录，不提交到 Git
```

## 常见问题

### 已安装 Mole，但插件提示未找到

先在终端运行 `mo --version` 确认命令可用，再回到环境设置中刷新信息。如果安装位置不在自动检测范围内，点击选择 mo 路径。发现文件但无法运行时，界面会提示检查权限或重新安装。

### 无法读取部分目录

根据 macOS 的实际权限提示，为 uTools 授予所需的文件访问权限；需要时可在系统设置的隐私与安全性中检查完全磁盘访问权限，再重新打开插件扫描。

### 更新或维护失败

先查看页面中的结果说明，再在环境设置中点击打开日志。插件日志路径为 `~/Library/Logs/mo-utools/plugin.log`，其中记录检测、任务执行和更新过程。Mole 的操作记录通过插件的操作记录页面查看。

### 修改代码后仍显示旧界面

开发模式下确认 `pnpm dev` 正在运行；修改本地脚本后结束插件进程再打开。使用构建目录时，需要重新执行 `pnpm build` 后重载插件或重新打包安装。

## 相关项目

- [Mole](https://github.com/tw93/Mole)：提供本机维护命令、清理规则和文件保护能力。
- [uTools 开发者文档](https://www.u-tools.cn/docs/developer/welcome.html)：插件运行、开发和打包说明。
- [LiberClean 项目主页](https://github.com/zdkcomeon/liberClean)：源码、问题反馈与项目更新。
