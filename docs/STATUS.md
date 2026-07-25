# WhatAisle 需求 / 进度对照表

> 最后核对：2026-07-25 · 分支 `fix/tenant-isolation-bypass`（8 个 commit 待合并）
>
> 标记：🔴 阻塞上线　🟡 上线后尽快　⚪ 可延后　✂️ 已主动砍掉（不是遗漏）
>
> 「未完成」里带文件路径的都是本次实际核对过代码得出的；标〔笔记〕的来自你自己的记录，未复核。

| 需求 | 已完成 | 未完成 |
|---|---|---|
| **多租户与隔离**<br>§5 第一验收标准 | 租户身份**只从 Host 推导**（`storeHandleFromHost()`，proxy 与服务端共用一份）<br>proxy 不再设置 `x-store-handle`，机制已移除<br>`src/data/` 七个 repo 构造时绑定 `storeId`<br>店员 cookie 绑 `(storeId, pinVersion)`，host-only<br>E2E 三条伪造头用例（实测把 bug 加回去会红） | ⚪ 暂无已知缺口 |
| **店员扫描录入**<br>§4.2 | OpenRouter rows-hd 管线（行检测→3072px 条带→网格读名）<br>HEIC 上传、EXIF 归一<br>一照一请求，单张失败不拖累整批<br>去重、别名生成、嵌入、缩略图人工复核 | ⚪ ✂️ 照片不再打码（随旧管线退役，有意取舍）——若做「照片回看」功能必须先补回 |
| **顾客搜索** | SSE 流式管线，文字/语音/拍照三种输入<br>中英双语、混合检索、答复语气合成<br>护栏拦提示词注入<br>未命中记录 + 顾客反馈回流 | 🔴 **生产从未真实跑过**——线上 0 商品，DashScope 搜索/别名/嵌入链路只验证了「密钥被接受」<br>⚪ 暂无已知缺口（stub 向量污染已修） |
| **楼层图** | admin 画图工具 + 发布流程<br>店铺侧 SVG 高亮定位<br>`mapping_ticket` 队列（todo→drawing→awaiting_confirm→published） | ⚪ 暂无明显缺口 |
| **店主门户** | shelves / insights / posters / profile / map / data / video 七个页面<br>数据导出、闭店流程 | ✂️ 周报邮件已砍 |
| **平台后台**<br>§7 | tenants / costs / users / tickets / announcements / audit / onboarding / mapping | 🟡 `impersonation_grant` 表**零应用代码**——模拟登录只写 `auditLog` 就签 token，令牌可重放，换来的 cookie 是 30 天且撤不掉<br>🟡 `background_job` 表**零应用代码**——没有运行器，也没有定时触发（需要 Cloud Scheduler 新基础设施） |
| **认证与注册** | Better Auth；邮箱验证、改密、重置<br>Google OAuth + 账号关联<br> + `PUBLIC_SIGNUP_ENABLED` 开关<br>admin 角色与 demo 模式 | ⚪ 暂无已知缺口 |
| **支付与定价**<br>§3 | $999 一次性档，付费墙卡在建店与视频上传之间<br>Stripe webhook 履约、`premium-access` 门禁<br>E2E 覆盖三条付费路径<br>生产全链路人工走通过一次（07-11） | 🔴 **仍是 Stripe 测试模式**：live 需重建产品/价格/webhook、换 Secret Manager 密钥、更新构建期变量 `NEXT_PUBLIC_STRIPE_PRICE_LIFETIME` 再重新部署<br>🔴 商户名还是 "CUP ICE LEMON"<br>✂️ 订阅档与 credits 包（保留但休眠） |
| **AI 成本与用量** | `ai_usage_log` 全链路计量<br>OpenRouter 每调用真实 `usage.cost` 入库（`cost_usd`，可空区分「未计量」与真实 0）<br>后台分「实计 · 预估」显示，按花费排序<br>实测基数：**$0.258 / 次扫描**（12MP 密集货架，82 件，24 次调用） | 🔴 GCP 预算上限 + 成本告警没配<br>（`$/扫描` 已上页面；实测 $0.26/次） |
| ~~**上门录入服务**~~<br>§6 末条 | — | ✂️ **整块作废**（2026-07-25 决定：没有上门录入服务）。真实流程改为「下单→传视频→平台绘图并解锁→店家扫描」，已在 Phase 3 实现 |
| **部署与运维** | Cloud Run + Cloud SQL + 全局 LB + 通配符证书<br>push main 自动部署（WIF 免密）<br>迁移 job 自动执行<br>apex→www 规范化重定向 | 🔴 生产库有遗留 QA 测试数据（测试账号、`qa-test-market` 店、测试 payment 行）待清<br>⚪ 存储迁 Cloudflare R2〔笔记〕<br>⚪ 本地 gcloud 对 `whataisle-prod` 已失效，改环境变量只能走 GitHub secrets → deploy.yml〔笔记〕 |
| **测试与 CI** | 28 个 E2E（7 spec）+ 32 个单测<br>**审计闸已清零**（next 16.2.11 + 六组 override + shadcn 挪 devDeps；0 high）<br>PR 跑 audit + lint + typecheck + build<br>`e2e.yml` 独立 release 工作流<br>`AI_STUB` 让全链路可离线跑 | 🟡 16 个 dependabot PR 待重跑（闸已通，应能自行变绿）<br>🟡 延期覆盖 7 项中的 4 项其实不需要新基础设施（视频断点续传、闭店、跨店 ACL、Stripe webhook 签名 fixture）<br>⚪ E2E 结构性覆盖不到生产构建行为（`isE2ETestMode()` 硬要求 `NODE_ENV=development`） |
| **合规与法务** | 隐私 / 条款 / Cookie 中英双语<br>条款变更再确认流程<br>审计日志 | 🔴 **AI 供应商商务条款未核实**——现在是两家（DashScope + OpenRouter），要确认转售许可 + 店铺数据不被用于训练。真实店铺数据流入前必须先过 |
| **代码健康** | 死掉的 docs/blog/changelog 脚手架已清（-1689 行）<br>CLAUDE.md / AGENTS.md / README.md 已按代码实况重写 | ⚪ knip 报的 ~70 文件 / 38 依赖模板残留（data-table、未用 Radix 包等），单独一次改动处理 |

---

## 剩余待办（2026-07-25 更新）

**我做不了的，需要你操作：**
1. 🔴 **AI 供应商商务条款** —— 法务动作。两家（DashScope + OpenRouter）都要确认转售许可 + 店铺数据不用于训练。纯等待项，越早启动越好。
2. 🔴 **Stripe 切 live + 改商户名** —— 需要 Stripe Dashboard。
3. 🔴 **清生产库遗留 QA 数据** / **配 GCP 预算告警** —— 本地 gcloud 对 `whataisle-prod` 凭据已失效，需你 `gcloud auth login` 后执行。

**还没做完的代码：**
4. 🟡 `impersonation_grant` 完整版（一次性令牌 + 可撤销 + 退出审计）。**现在做代价最低**：cookie 格式变化会让所有店员重输 PIN，而线上目前没有真实店员会话。
5. 🟡 `background_job` 运行器 + Cloud Scheduler。当前唯一真痛点是 re-embed 超时且不能续传。
6. 🟡 四项其实不需要新基础设施的 E2E：视频断点续传、闭店、跨店 ACL、Stripe webhook 签名 fixture。
7. ⚪ knip 报的模板残留（~70 文件 / 38 依赖）。

## 已知会同时首次验证的三件事

生产目前 1 店 0 商品。第一家真实付费店铺接入时，会**同时**首次验证：收款链路、搜索质量、单店真实成本。建议第一家店当成受控试点，别当成正常客户。
