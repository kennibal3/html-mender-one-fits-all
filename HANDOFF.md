# HTML Mender 下一轮开发交接

更新时间：2026-07-19

## 1. 接手后先读

项目目录：

```text
/Users/kdongnmt.edu/Desktop/new skills/html-mender/local-app
```

GitHub：`kennibal3/html-mender-one-fits-all`

当前分支：`feat/interactions-A`

阶段一功能基线提交：

```text
70c32a8 feat: add minimal scene model and live modal runtime
```

必须按顺序阅读：

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/GOAL-深层内容编辑第一版.md`（当前唯一规格）
4. `docs/development-progress-2026-07-19.md`
5. `docs/complex-scene-editing-design.md`（长期设计参考）
6. `docs/GOAL-互动功能完整验收.md`（A1–A5 基线与 B 类 backlog）

## 2. 当前工作区状态

阶段一已经在用户授权下提交为 `70c32a8`。规格同步已提交为 `a8e71d5` 并推送 `origin/feat/interactions-A`，没有创建 PR。

规格同步提交包含：

```text
AGENTS.md
HANDOFF.md
docs/GOAL-深层内容编辑第一版.md
docs/GOAL-互动功能完整验收.md
docs/complex-scene-editing-design.md
docs/development-progress-2026-07-19.md
```

当前样本库改动尚未提交，接手时必须先运行：

```bash
git status --short --branch
git diff --check
git diff --stat
```

禁止清理、覆盖或回退用户修改。除已授权的本次规格提交与推送外，后续提交、PR 和合并仍需重新确认。

## 3. 用户协作规则

- 默认使用中文。
- 文件修改前先说明计划并等用户确认。
- 开发按阶段逐项确认；不能把一次确认扩张到后续阶段。
- 功能或修复先写失败测试，再写实现。
- 每格必须有自动化测试或可复现端到端证据。
- 不修改用户真实课件；原件只读，测试使用脱敏副本和临时目录。
- 两条互动运行时必须保持行为一致并分别测试。
- 未经授权不得提交 Git 或推送远端。

## 4. 已完成基线

以下基础能力已完成：

- HTML/ZIP 导入、任务重开和多页管理。
- 页面新增、复制、排序、删除、恢复和版本。
- HTML/ZIP/自定义目录导出。
- 文字、图片、媒体、形状、布局和组合编辑。
- Windows 构建配置。

A1–A5 已独立提交：

- A1 点击显示/隐藏：`e627004`
- A2 弹窗：`0e54216`
- A3 页面跳转：`936a312`
- A4 网址跳转：`0e6ddef`
- A5 逐步讲解：`6ad73ff`

阶段一“最小场景模型 + 活动节点弹窗”已提交：

```text
70c32a8 feat: add minimal scene model and live modal runtime
```

## 5. 阶段一成果

### 5.1 最小场景模型

`src/scene-model.js` 与 `src/server.js` 已实现：

- 稳定页面场景 ID。
- 从 A2 互动生成弹窗场景。
- 根据触发器和目标节点推导嵌套父子关系。
- 损坏互动清单不丢页面根场景。
- 循环关系自动降级。
- 导入、保存、页面管理、恢复和重开时维护场景清单。

### 5.2 活动节点弹窗

两条运行时均已改为移动真实活动节点，不克隆弹窗内容：

- `vendor/html-slide-mender/assets/html-slide-mender-runtime.js`
- `vendor/html-slide-mender/assets/html-slide-mender-interactions.js`

已保留原事件、表单值、媒体状态、内部互动标识、焦点和多层弹窗栈；关闭后恢复原父节点、顺序、样式与隐藏状态。

两条路径都会派发 `hsm-scene-event`，含 `scene.entered`、`scene.exited`、场景 ID、互动 ID、深度和预览标记。

编辑器运行时版本为 27。

### 5.3 阶段一证据

- 105/105 自动化测试通过。
- A1–A5 平面回归通过。
- 编辑预览与导出运行的活动节点、多层弹窗、内部互动和场景事件通过。
- 页面管理、保存、重开、恢复、HTML/ZIP 独立导出通过。
- JavaScript 语法检查和 `git diff --check` 通过。
- `npm audit --audit-level=high`：0 vulnerabilities。

## 6. 当前唯一目标

当前切片只执行：

```text
docs/GOAL-深层内容编辑第一版.md
```

目标是让老师进入弹窗内部和同源子 HTML 页面，编辑元素、配置 A1–A5，并保证保存、恢复、重开和独立导出仍然有效。

当前明确不做：

- 同源 iframe 内部编辑。
- SPA、Hash/History 路由、Shadow DOM、Canvas 内部对象、小游戏。
- B1–B8。
- 多学习者档案、演示/练习模式、可信项目模式。
- 轻量媒体编辑和 A 档大规模性能优化。

旧的“下一阶段先做 B5 状态基础设施”计划已经失效，B5 回到 backlog。

## 7. 课件样本扫描结论

只读扫描范围：G1–G4、G7–G12。

| 指标 | 结果 |
| --- | ---: |
| 可扫描课程 | 83 门 |
| 主 HTML 页面 | 2,063 页 |
| 含弹窗结构 | 82 门（98.8%） |
| 含普通动态内容 | 82 门（98.8%） |
| 含本地 HTML 引用 | 14 门 |
| 本地 HTML 唯一引用 | 79 条 |
| 失效引用 | 69 条（87.3%） |
| 本地同源 HTML iframe | 0 |

新增小学 G1–G4 部分样本为 14 门、296 页。它们同样包含拖拽、媒体、Canvas、答题、参数实验和作品状态，低龄友好不等于功能减少。

数据限制：

- G5–G6 没有原始 HTML。
- 初中评审总览写 1,161 页，实际为 1,160 页。
- `G12-33/P01.html` 是零字节文件。
- 当前覆盖率是静态代码特征，最终验收仍需浏览器端到端证据。

完整分析笔记位于项目外的 Codex 可视化目录，未写入或修改课件原件。

## 8. 建议样本库候选

按当前规格的 5–8 个上限，建议从以下 8 个候选建立“原件只读 + 脱敏最小复现”样本库：

| 样本 | 用途 |
| --- | --- |
| G1-08《AI在哪里》 | 低龄关卡、Canvas 场景创作与反馈 |
| G2-23《智能教室》 | 逻辑组装、输入/拖拽与自由创作 |
| G3-38《预测游戏》 | 阈值滑块、策略权衡与重试 |
| G4-52b《无人书店大营救》 | 输入、生成/回退、媒体、投票和作品状态 |
| G8-23 | 高密度弹窗、活动节点和反馈 |
| G8-25 | 动态代码预览与沙箱反例 |
| G10-05 | 外部 iframe 反例与 Canvas 外层管理 |
| G12-35 | 可工作的本地子页面跳转 |

样本库已经按上述 8 个候选建立：

- `docs/deep-content-sample-library.md`：来源、脱敏原则和覆盖边界。
- `test/fixtures/deep-content-v1/manifest.json`：机器可读清单。
- `test/fixtures/deep-content-v1/*`：8 个脱敏最小 HTML 样本。
- `test/deep-content-sample-library.test.js`：样本数量、覆盖、子页面正反例和 iframe 安全占位校验。

证据：样本测试 3/3 通过；全量测试从 105 增加到 108，108/108 通过；高危依赖漏洞为 0。样本库改动尚未提交或推送。

## 9. 执行顺序

严格深度优先：

1. 重新跑 A1–A5 与全量基线，确认阶段一提交稳定。
2. 建立 5–8 个代表样本的只读索引和脱敏最小复现。
3. 先完成弹窗十步闭环。
4. 弹窗证据齐全后再做同源子页面十步闭环。
5. 补齐人工登记、高级维护模式隐藏和 T1 友好性。
6. 统一加固草稿、正式版本、恢复点、独立 ZIP 和导出前检查。
7. 全量测试、安全审计和人工 diff 审查。

弹窗闭环的十步验收要求同时包含“真实点击”和“场景树进入”。因此允许在第 3 步实现闭环所必需的最小场景树与可见标题面包屑；完整人工维护体验仍在第 5 步补齐。

## 10. 下一次允许做什么

用户已经确认：

1. A1–A5/全量基线验证；结果为 105/105 通过，高危依赖漏洞为 0。
2. 将本次规格、交接和进度文档单独提交并推送当前分支。
3. 建立样本库：只读来源索引、脱敏最小复现和样本覆盖校验测试；已经完成并通过验证。

仍未授权：

- 修改生产代码。
- 开始弹窗闭环功能实现。
- 提交或推送当前样本库改动。
- 创建 PR 或合并分支。

样本库完成并留证据后，必须重新确认才能开始弹窗闭环的第一格失败测试。

## 11. 常用命令

```bash
cd "/Users/kdongnmt.edu/Desktop/new skills/html-mender/local-app"
npm test
npm audit --audit-level=high
git diff --check
```

本地服务：

```bash
npm start
```

访问：`http://127.0.0.1:8787/`
