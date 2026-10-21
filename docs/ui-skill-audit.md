# LiberClean UI 技能审查

2026-10-21，依据 [emilkowalski/skills](https://github.com/emilkowalski/skills) 提交 `2d22863` 中的全部 15 个技能检查。项目定位为 macOS uTools 维护插件，使用 React、TypeScript、原生 HTML 控件和 CSS。

## 全部技能的适用性与处理

| 技能 | 检查内容 | 处理结果 |
| --- | --- | --- |
| [emil-design-eng](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng) | 信息层级、组件反馈、整体一致性 | 统一颜色、字体、间距、阴影和焦点；重新组织设备、指标、存储与维护入口 |
| [animate](https://github.com/emilkowalski/skills/tree/main/skills/animate) | 是否需要动画、用途、属性、时长 | 按压 100ms、反馈 140ms、弹窗进入 200ms；共用 easing 与时长变量 |
| [review-animations](https://github.com/emilkowalski/skills/tree/main/skills/review-animations) | 键盘动作、进入方式、动画属性 | 键盘操作即时响应；弹窗从 0.97 比例进入；关闭即时完成 |
| [improve-animations](https://github.com/emilkowalski/skills/tree/main/skills/improve-animations) | 全局动效、优先级与重复规则 | 审查旧样式并移除容量条宽度过渡与阴影过渡；合并时长与曲线约定 |
| [find-animation-opportunities](https://github.com/emilkowalski/skills/tree/main/skills/find-animation-opportunities) | 哪些反馈缺失、哪些动画应省略 | 补齐按压与确认弹窗反馈；导航、筛选、实时数据和预览数据切换保持即时 |
| [animation-performance](https://github.com/emilkowalski/skills/tree/main/skills/animation-performance) | 布局动画、绘制成本、React 更新 | 容量条改用 transform；移除全屏背景模糊；应用行独立 memo；长列表虚拟化 |
| [apple-design](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) | 平台字体、清晰反馈、控制权、无障碍偏好 | 系统字体、明确主次操作、原生确认窗口；适配减少动态效果、减少透明度和高对比度 |
| [mobile-native](https://github.com/emilkowalski/skills/tree/main/skills/mobile-native) | 输入能力、视口、滚动、安全区域 | dvh、hover 能力判断、触控字号、安全区域、点击反馈；当前仍为桌面插件，未声明手机真机验证 |
| [break-ui](https://github.com/emilkowalski/skills/tree/main/skills/break-ui) | 长文本、Emoji、空值、单项、千项、窄窗口 | 新增可切换开发数据；处理不可用指标、完整 Emoji 首字形、文本省略与长列表键盘操作 |
| [pick-ui-library](https://github.com/emilkowalski/skills/tree/main/skills/pick-ui-library) | 已有依赖、原生能力、是否需要额外库 | 只为长列表增加 react-virtuoso；对话框与选择器继续使用原生控件 |
| [ask-sonner](https://github.com/emilkowalski/skills/tree/main/skills/ask-sonner) | 消息生命周期、重复通知、模态层级 | 当前流程需要持续显示检查范围与任务结果，保留页面内状态提示；未增加 Toast 依赖 |
| [prototype](https://github.com/emilkowalski/skills/tree/main/skills/prototype) | 是否需要分叉方案及独立比较页面 | 本次直接优化已有产品并提供可操作预览；未额外生成多套待选择方案 |
| [animation-vocabulary](https://github.com/emilkowalski/skills/tree/main/skills/animation-vocabulary) | 动效术语是否准确 | 使用按压反馈、缩放进入、缓动、虚拟列表等明确术语；该技能为术语查询，无独立运行时改动 |
| [animate-expo](https://github.com/emilkowalski/skills/tree/main/skills/animate-expo) | React Native、手势线程、触觉反馈 | 已检查适用性；本仓库为 React Web，不引入 Expo 或原生手势依赖 |
| [write-swift](https://github.com/emilkowalski/skills/tree/main/skills/write-swift) | Swift 数据建模、并发与原生界面 | 已检查适用性；仓库没有 Swift 实现，不将 Swift 规则套入 TypeScript |

## 修正前后

| Before | After | Why |
| --- | --- | --- |
| 小字号配合低对比度灰色 | 加深主要文字与说明文字，建立统一颜色变量 | 增强密集工具界面的可读性 |
| 设备、评分和存储数值层级接近 | 设备名称、健康评分环与可用容量分别突出 | 先看到设备与空间状态，再选择操作 |
| 关闭确认窗口后焦点可能落到页面开头 | 将焦点还给查看并确认按钮 | 便于继续使用键盘核对与操作 |
| 更新权限窗口手动维护 Tab 循环 | 原生 dialog 管理模态状态与背景交互 | 减少自定义焦点处理和可访问性遗漏 |
| 全局 hover 可能在触控设备保留 | 仅精确指针与 hover 能力设备启用 | 避免点击后一直保留悬停状态 |
| 减少动态效果时取消所有反馈 | 去除移动，保留短暂颜色与透明度变化 | 保持状态可辨认，同时减少位置变化 |
| 清理项目名称通过 click 模拟复选框标签 | 使用 htmlFor 关联复选框 | 名称点击与原生键盘行为保持一致 |
| 全选框只显示选中或未选中 | 增加部分选择状态 | 筛选与批量选择后能够准确理解当前状态 |
| Emoji 名称按 UTF-16 字符截取 | 使用 Intl.Segmenter 取得完整字形 | 避免显示半个 Emoji 或缺失字形 |
| 非有限数值可能显示 NaN% 或无意义速率 | 展示不可用占位，不绘制非法趋势点 | 区分未取得数据与实际的零值 |
| 应用页直接渲染千项 | 超过 100 项使用 Virtuoso，少量项目保留原生 Tab 顺序 | 限制 DOM 规模并保持常用场景的操作习惯 |

## 数据边界

| 字段 | 来源与约束 | 覆盖方式 |
| --- | --- | --- |
| 应用名称 | InstalledApp.name；本机桥接允许的名称最长 256 字符 | 长名称、中英文、单字符、完整 Emoji |
| 应用路径与标识 | InstalledApp.path / bundleId；展示类型未声明长度上限 | 长路径省略，并通过 title 提供完整内容 |
| 应用大小 | InstalledApp.sizeLabel；可能为 N/A 或 Unknown | 显示大小暂不可用，保留大小列 |
| 应用选择权限 | InstalledApp.selectable / reason | 禁止选择的项目仍显示原因 |
| 应用总数 | ApplicationInventory.apps；展示类型未声明上限 | 0、1、1000 项，计数添加千分位 |
| 维护项目 | MaintenanceItem；大小可为 null，路径可为空 | 文件与系统维护分别展示；全选仅作用于可选项目 |
| 设备与指标 | Snapshot 可选字段 | 缺少评分、网络不可用、NaN CPU、接近满容量磁盘 |
| 状态与任务结果 | Task、MaintenanceFlow、UninstallFlow | 检查、确认、停止、成功、部分结果与失败提示 |

## 动效取舍

保留的动效只有按压反馈和偶尔出现的模态窗口。它们用于确认输入、帮助理解界面层级，使用 CSS transform / opacity，不通过 React 状态逐帧驱动。

以下场景保持即时更新：

- 页面切换和键盘快捷键：高频操作，优先减少等待。
- CPU、内存、磁盘与网络指标：用户需要直接读数，保留等宽数字。
- 搜索筛选、行选择和预览数据切换：即时反映用户输入。
- 删除确认：保留原有预览和明确确认，不额外叠加长按计时。

## 验证记录与限制

- 浏览器中检查 1280×720、800×600、390×720 与 320×600 布局，检查横向溢出、长名称、省略与操作入口。
- 验证应用选择、部分全选、筛选保留选择、清除筛选、检查清单、确认弹窗、Escape 和焦点恢复。
- 千项数据在 800×600 中，改造前有 1000 个应用行、约 9083 个 main 子节点；改造后一次测得 7 行、约 157 个子节点。数量随视口与缓冲范围变化，此记录不代表帧率测试。
- 验证千项列表 End 到末项、Home 回首项、方向键和空格选择，并验证筛选后选择保持。
- 更新授权窗口使用开发示例与测试文字验证；没有调用本机更新或处理真实密码。
- pnpm build、39 项现有测试与 git diff --check 通过；单独验证异常与零值数值格式，并检查生产 JavaScript 不含开发示例数据。
- 新浏览器预览中的控制台未发现错误或警告。
- 系统偏好的减少动态效果、减少透明度与高对比度分支检查了 CSS；仍需在目标 uTools 环境下确认实际系统设置效果。
- 未进行手机真机、低端设备 GPU、屏幕阅读器或真实文件删除验证。

开发预览位于 [本地预览](http://127.0.0.1:5174/?preview=1)，底部可切换数据。生产模式不启用示例桥接或数据选择器。

动效代码审查结论：Approve。交互不依赖动画结束，不包含布局属性过渡或逐帧 React 动画；实际设备表现仍以上述验证范围为限。
