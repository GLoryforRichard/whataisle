# WhatAisle 功能与需求对照 · MVP 讨论底稿

> 核对日期：2026-09-04（Toronto）。这是讨论底稿，**MVP 范围尚未拍板**。
> 建议阅读顺序：先看「当前产品边界」和「MVP 建议」，需要核实时再看完整功能表。

**现在已有“拍货架 → 记商品位置 → 顾客找货”的核心代码。接下来最重要的是把保存、纠错、权限和稳定性补成可交付的闭环。**

## 当前产品边界

这次同时核对了两份实际代码，不能只看当前官网仓库里的旧需求文档。

| 项目 | 本次核对版本 | 当前职责 |
| --- | --- | --- |
| `whataisle` | `main` · `9569440`，2026-08-04 | 官网、免费试扫、账号、Stripe 收款和订阅管理 |
| `whataisle-store` | `main` · `8c1ef0f`，2026-08-03 | 单店顾客找货、店员扫货、货架与运行数据界面 |
| `what-aisle` | `69cd126`，2026-07-04 | 较早的另一个实现；本轮不把其中功能混入当前完成清单 |

官网的 `8d03489` 提交明确拆走了原来的门店产品。**“官网收款 + 人工安排独立门店部署”是当前代码对应的交付方式。** 官网购买成功不等于自动创建服务器或开通门店。

原来的 [需求文档](./REQUIREMENTS.zh.md)、[进度表](./STATUS.md)、README 和 AGENTS.md 有多处落后于拆分。门店仓库的部分 ADK/MCP 描述也落后于源码。本表以实际路由、界面事件、服务端逻辑和部署脚本为证据；旧需求章节只用来追溯意图。

**状态口径：**「已实现」表示代码路径存在且已核对，不表示这次已在生产完整实测；「部分」表示还缺关键环节；「演示」表示界面操作不写入真实数据；「未见」表示在本次两份代码中没找到，不排除人工在外部处理。测试数量和历史演示记录均不作为当前验收通过证明。

## MVP 建议：先让一家真实商店每天用得起来

建议第一版的承诺是：**我们协助开店、配置货架；店员拍照录入；顾客扫码用文字找到货架；发现错位后能真正修正。** 已有语音和拍照找货可以保留，但要能单独关闭，出错时仍能打字找货。

| 核对项 | 建议 | 这版怎样算完成 | 决定 |
| --- | --- | --- | --- |
| M1 开店交付 | 必须；先人工协助 | 每店有稳定网址、正确店名与货架编号、访问凭据、可打印二维码；真机完成一次找货 | 待确认 |
| M2 员工录入 | 必须 | 选架、拍照、识别、保存；刷新后可见；重试同一任务不重复计数；失败能明确恢复 | 待确认 |
| M3 顾客文字找货 | 必须 | 中英查询、候选商品、货架号、没找到提示；绝不读到别家店的数据 | 待确认 |
| M4 地图 | 建议保留，允许分阶段交付 | 实体货架编号先正确；真实地图人工配置；无地图时明确显示货架列表，不能把网格当真实平面图 | 待确认 |
| M5 纠错 | 必须补齐 | 店员改名称/位置后确实保存；顾客能报告不在原位；报告有人处理，不自动乱改商品 | 待确认 |
| M6 权限、恢复与成本 | 必须补齐 | 顾客看不到内部目录/日志/花费；能恢复数据；有费用提醒；AI 故障仍有文字检索 | 待确认 |
| M7 付款与服务交付 | 若首批收费则必须 | Stripe 真实收款、订阅变更、人工交付台账能对应到同一家店；取消后的处理规则明确 | 待确认 |
| M8 语音与拍照找货 | 已有，作为可关闭的增强项 | 识别后可改字再搜；权限拒绝或识别失败能回到文字输入 | 待确认 |
| M9 简单使用反馈 | 保留少量指标 | 搜了多少、没找到什么、最近一次录入；员工测试与顾客使用分开 | 待确认 |
| M10 自助老板门户、自动绘图工单、复杂运营后台 | 建议延后 | 前十店先以受控的人工流程交付，记录责任人和完成状态 | 待确认 |

以上是建议取舍，**没有删除已有功能，也没有改写原始需求**。延后界面自动化不等于取消备份、导出、纠错和客户支持这些交付责任。

## 完整功能—需求对照表

证据中的「官网」指 `whataisle`，「门店」指 `whataisle-store`。同一行合并的是同一个用户目的；必要的差异单列。

### A. 获客、账号和收费

| 编号 | 功能及它解决的需求 | 当前实现与限制 | 原需求 | 证据 |
| --- | --- | --- | --- | --- |
| A01 | 官网介绍产品，让老板理解用途 | 已实现：首页、关于、联系、定价页 | §三、§九 | [官网页面][P1] |
| A02 | 英中官网和语言切换 | 已实现：双语路由、浏览器语言识别与语言记忆 | §九 | [语言路由][P2]、[官网 proxy][P3] |
| A03 | 付款前试扫货架照片 | 已实现：上传、预检、识别和结果展示；不是正式门店建档，不会因此开店 | §六同步说明 | [免费试扫 API][P4] |
| A04 | 免费试扫防滥用 | 已实现：图片大小/类型、IP 等限制；不要据此推断门店搜索也有相同限制 | §十、§十二 | [免费试扫 API][P4] |
| A05 | 搜索引擎收录和分享 | 已实现：sitemap、robots、页面 metadata、结构化内容 | 获客配套 | [sitemap][P5]、[metadata][P6] |
| A06 | 老板注册、登录和找回密码 | 已实现：邮箱账号、验证与密码恢复；Google 登录由配置决定；未见手机号登录；不是门店员工 PIN | §五 | [官网认证][P7] |
| A07 | 个人资料、安全与账号设置 | 已实现：资料与安全设置页面；不是店铺资料管理页面 | §五 | [设置页面][P8] |
| A08 | 法律页和条款更新确认 | 部分：英中隐私/条款/Cookie、后台条款版本再确认已实现；注册表单未见原要求的勾选框；条款是否匹配单店新模式仍需复核 | §十 | [法律页][P9]、[条款更新][P10]、[注册表单][P17] |
| A09 | 月付与年付 | 已实现配置：**USD 199/月、USD 1,990/年**；年付附店铺品牌定制宣传，人工履约 | §三，价格为后续决定 | [价格配置][P11] |
| A10 | 收款与订阅状态更新 | 部分：Stripe checkout、webhook、付款结果已接入；webhook 处理失败仍回应成功，可能漏记账且不触发该次自动重送；未实测真实扣款/退款/续费 | §三 | [Stripe 实现][P12]、[webhook 入口][P18] |
| A11 | 顾客自行管理账单订阅 | 已实现：账单页、Stripe customer portal；变化是否反映到独立门店仍靠额外运营流程 | §三 | [账单页面][P13]、[Stripe 实现][P12] |
| A12 | 付款后安排安装 | 部分：成功页告知人工安排；未见自动创建云资源、配域名或下发门店权限的通路 | §六 | [官网控制台][P14]、[门店部署手册][S1] |
| A13 | 官网管理员管理用户 | 已实现：管理员用户页及权限区分；原跨店运营后台已拆走 | §七 | [用户管理页][P15] |
| A14 | 联系支持与事务邮件 | 已实现联系渠道及认证/支付相关邮件基础；不是完整店铺工单系统 | §七 | [邮件模块][P16]、[官网控制台][P14] |
| A15 | 旧价格和模板能力 | 非新售产品：$999 lifetime 停售保留旧客户识别；Free/Pro、credits/newsletter 等受关闭/演示开关控制；Creem 不应算当前已接通产品 | 历史/模板 | [网站配置][P11] |
| A16 | 优惠码与试点优惠 | 已实现 checkout 输入优惠码；优惠券需人工配置，未配置自动三个月试用；公开免费试点文案已撤 | 后续商业决定 | [价格配置][P11] |
| A17 | 自助删除官网账号 | 部分：有账号删除及确认；未见同步取消 Stripe 订阅、关闭独立门店或删除门店数据 | §五、§七 | [账号设置][P8]、[官网认证][P7] |
| A18 | 真实演示店入口 | 当前关闭：官网配置不再提供真演示店链接；首页展示动画不等于真实门店体验 | §三新增要求 | [网站配置][P11] |

### B. 顾客找货

| 编号 | 功能及它解决的需求 | 当前实现与限制 | 原需求 | 证据 |
| --- | --- | --- | --- | --- |
| B01 | 顾客无需登录、安装即可找货 | 已实现：门店公开网页和手机界面；二维码打印物未见一键生成 | §4.1、§九 | [门店首页][S2] |
| B02 | 店铺名字、货架和地图各不相同 | 部分：店名/布局可配置，但顾客首页仍写死 Wherebear，品牌展示未接全；由部署人员修改 | §4.1、§九 | [店铺配置][S3]、[门店首页][S2] |
| B03 | 门店英中界面 | 部分：核心语言切换已实现；相机和管理页面仍有英文文案；复杂查询质量仍要用真实商品验收 | §九 | [语言文案][S4]、[相机组件][S32] |
| B04 | 用名字、品牌、描述、错拼找商品 | 已实现：理解问题、文字与向量检索、候选判断；真实召回率未在本轮测量 | §4.1 | [搜索入口][S5]、[搜索流程][S6] |
| B05 | 语音找货 | 已实现录音识别与确认/改字后搜索；未见嘈杂环境多个转写候选的完整选择机制 | §4.1 | [找货界面][S7]、[语音 API][S8] |
| B06 | 拍商品照片找货 | 已实现照片识别、确认/改字后搜索；真实设备的权限/弱网体验仍需验收 | §4.1 | [找货界面][S7]、[识别 API][S9] |
| B07 | 搜索时知道系统正在做什么 | 已实现：实时步骤、完成后收起、答案与候选 | §4.1 | [找货界面][S7]、[搜索入口][S5] |
| B08 | 展示实拍包装、货架号、出现次数 | 已实现：商品小图、seen 次数、货架位置；图片为货架裁图 | §4.1 | [找货界面][S7]、[搜索工具][S10] |
| B09 | 多个可能商品与不确定提示 | 部分：有排序、不同置信表达与没找到；最终最多 5 个商品，不是旧需求的全部候选 | §4.1 | [搜索工具][S10] |
| B10 | 用地图指向目标货架 | 已实现：目标高亮、候选切换、主架/侧面位；地图人工填坐标，无地图时显示货架网格 | §4.1、§六 | [地图组件][S11]、[店铺配置][S3] |
| B11 | 同一商品能出现在多个位置 | 部分：保存/结果含多个货架；旧管理读写仍大量使用 latest_aisle，删某位置与删整件商品未形成一致规则 | §八 | [保存逻辑][S12]、[管理 API][S13] |
| B12 | 没找到也能留下业务线索 | 已实现搜索历史、结果数和未命中信息；还不是可派给员工的补拍待办 | §4.3 | [操作与搜索记录][S14] |
| B13 | “按图找了，不在这”与纠错闭环 | 未完成：顾客结果未接上该入口；遗留评价 API 不等于多人反馈降语气、核查提醒与结案 | §八 | [找货界面][S7]、[反馈 API][S15] |
| B14 | AI 出问题时继续找货 | 未完成文字降级：搜索结果页已有友好错误提示，但 API 仍返回底层错误；语音/照片识别错误可能直接显示原文 | §七、§九 | [搜索入口][S5]、[找货界面][S7] |
| B15 | 公开搜索防乱用、保护商品目录 | 部分：有面向找商品的提示约束；门店公开 API 未见完整限速/长度限制，内部读接口也未全面鉴权 | §十 | [搜索入口][S5]、[管理 API][S13] |

### C. 员工拍货架与维护

| 编号 | 功能及它解决的需求 | 当前实现与限制 | 原需求 | 证据 |
| --- | --- | --- | --- | --- |
| C01 | 员工输入口令进入工作区 | 已实现服务端签名会话、登录限速、改口令使旧会话失效；不是独立员工账号系统 | §4.2、§五 | [员工会话][S16]、[员工入口][S17] |
| C02 | 扫描前选择货架 | 已实现货架列表/地图入口；货架清单来自配置文件 | §4.2 | [扫货界面][S18]、[店铺配置][S3] |
| C03 | 相机拍照和相册多选 | 已实现批量录入、逐张状态及进度 | §4.2 | [扫货界面][S18]、[相机组件][S32]、[队列执行][S19] |
| C04 | 高清照片自动识别商品 | 已实现 rows-hd 管线、HEIC/方向处理、商品裁图、旧引擎切换；扫描走 Vertex，和官网试扫的供应商不同 | §二、§4.2 | [扫描入口][S20]、[扫描服务][S21] |
| C05 | 切页面/重开后找回未完任务 | 部分：浏览器本地队列可恢复被中断的进行中任务；后台挂起不能保证持续运行；网络失败后需重试，未实现恢复联网后自动重试 | §九 | [本地待办箱][S22]、[队列执行][S19] |
| C06 | 一张失败不拖住其他照片 | 已实现独立状态、失败提示/重试及队列控制 | §4.2 | [队列执行][S19] |
| C07 | 默认拍完就保存，减少员工点击 | 已实现自动保存；可在店铺配置切为人工确认模式 | §〇、§4.2 | [店铺配置类型][S23]、[队列执行][S19] |
| C08 | 合并重复商品并记录位置印证 | 部分：名称匹配、合并及累计次数已实现；保存重试缺稳定任务去重标识，可能重复加次数；掉线后的成功判断不够精确 | §二、§4.2 | [保存逻辑][S12]、[队列执行][S19] |
| C09 | 自动生成多种叫法 | 部分：有中文别名增强和搜索文本；未完整实现旧需求固定的英文/中文/拼音/罗马音/错拼组合；后台增强尚无可靠任务恢复 | §4.2 | [录入工具][S24]、[保存逻辑][S12] |
| C10 | 按货架查看商品 | 已实现读取商品与数量；公开读取接口权限是缺口 | §4.2 | [货架管理界面][S25]、[管理 API][S13] |
| C11 | 编辑、删除、新增商品和清空货架 | **演示状态：界面只改本地列表，刷新后恢复。** 服务端写 API 存在，但 UI 未接入，另受写开关控制 | §4.2、§八 | [货架界面事件][S25]、[管理 API][S13] |
| C12 | 员工试搜，验证刚录入商品 | 部分：能使用同一搜索；没有可靠的员工演练流量标识，仍会计入搜索历史 | §4.2 | [搜索入口][S5] |
| C13 | 老板才可清架/批量删等敏感操作 | 未完成：独立门店没有老板/员工两层权限；写接口主要验证员工口令与总开关 | §五 | [管理 API][S13]、[员工会话][S16] |

### D. 老板、运营、数据和交付

| 编号 | 功能及它解决的需求 | 当前实现与限制 | 原需求 | 证据 |
| --- | --- | --- | --- | --- |
| D01 | 查看店内商品、搜索、录入等情况 | 部分：有 dashboard、历史、统计；混有技术指标和内部花费，缺老板专用视图和完整权限 | §4.3、§七 | [数据面板][S26]、[统计 API][S27] |
| D02 | 看哪些商品顾客找不到 | 部分：有搜索记录；未见“真没有/没拍到”两清单、补拍派单和自动销账 | §4.3 | [搜索日志 API][S28] |
| D03 | 自动周报邮件 | 未见当前门店实现；旧 STATUS 称主动砍掉，需求正文仍要求，须重新确认 | §4.3、§八 | [历史进度说明](./STATUS.md) |
| D04 | 老板改店名/logo/营业时间/公告 | 部分：店名可人工改配置；完整品牌设置、营业时间和公告门户未见 | §九 | [店铺配置类型][S23] |
| D05 | 上传视频、绘图工单、老板确认和改图 | 当前两仓未见完整流程；现为人工配置地图，官网原 video/manage/mapping 已移除 | §六、§七 | [门店部署手册][S1]、[店铺配置][S3] |
| D06 | 海报、台牌、货架贴及员工培训材料 | 未见当前一键生成/完整英中培训材料；第一批可人工制作并记录交付 | §4.1、§六、§九 | 当前路由/组件盘点 |
| D07 | 跨店运营总台、风险店铺提醒 | 未见统一总台；现有部署台账模板和单店 dashboard 可作起点 | §七 | [门店部署手册][S1]、[数据面板][S26] |
| D08 | 支持工单、模拟进店、公告、帮助中心 | 未见当前完整产品流程；官网联系入口可支持人工服务 | §七 | [官网控制台][P14] |
| D09 | 按店了解成本与异常 | 部分：单店 token/费用估算和试用额度面板；不是完整云账单，未见全店汇总与自动告警闭环 | §七、§十二 | [统计 API][S27]、[操作记录][S14] |
| D10 | 导出商品、照片和地图 | 未见老板自助导出；当前扫描只留商品裁图，不能承诺导出已保存的原始货架照片 | §七 | [扫描服务][S21]、[保存逻辑][S12] |
| D11 | 备份、恢复、闭店删除 | 部分/待定：有运维资料，但未见经过验收的完整自动备份恢复与自助销户闭环；旧需求“立即删除”与新部署手册“保留数据”冲突 | §七、§十 | [门店部署手册][S1] |
| D12 | 照片隐私、顾客音视频留存规则 | 部分：原始货架图不持久保存，主要存商品裁图；自动人脸打码、留存说明与供应商数据条款不能视为已验收 | §十 | [扫描服务][S21] |
| D13 | POS/CSV 导入 | 未见当前实现；原需求允许二期 | §八 | 当前路由/录入逻辑盘点 |
| D14 | 每店数据隔离 | 有独立部署/数据库方案；应用查询不靠 storeId 筛选，必须确保各店凭据连接到各自数据库，不能只改店名复用同一库 | §五 | [Mongo 连接][S29]、[门店部署手册][S1] |
| D15 | 升级一店、换机器、扩容 | 部分：有初始化/部署脚本和店级配置；尚非统一版本发布、自动回退、无中断切换 | §七、§十二 | [部署脚本][S30] |
| D16 | 开店扫描不影响营业中找货 | 未完成保证：同店网页、图片处理和搜索共用进程/机器，Gemini 调用也共用 4 个并发名额 | §七 | [扫描入口][S20]、[AI 共用限制][S31] |
| D17 | 开发与排查工具 | 已实现 debug 数据查看、vision-test 图片识别对比、健康接口及若干 smoke 脚本；属于内部工具，须保护访问，不能当老板正式功能 | 研发/运维配套 | [诊断页面][S33]、[识别对比][S34] |

## 已发现、应优先核对的交付缺口

| 优先级 | 对店家/经营的影响 | 建议处理 |
| --- | --- | --- |
| 上真实店前 | 以为改好了货架，刷新后发现没改 | 接通真实编辑/移位/删除，验证刷新和重新搜索；区分删位置与删商品 |
| 上真实店前 | 访客可能读到内部商品列表、搜索日志、数据库信息和花费 | 为管理页和读 API 补服务端权限；诊断入口默认关闭；公网找货独立限速 |
| 上真实店前 | 错误位置一直留在答案里 | 完成顾客反馈 → 员工核实 → 修正 → 关闭提醒的最小流程 |
| 上真实店前 | 网络重试造成重复计数或误报保存完成 | 为上传/保存加稳定任务编号，服务端去重，逐任务查询真实完成状态 |
| 扩至十店前 | 扫货占满资源，顾客等很久；AI 故障无法找货 | 搜索优先、扫描服务端限流/排队、文字降级；压测后决定拆独立 worker |
| 扩至十店前 | 数据丢失或更新出错后恢复慢 | 做一次真实恢复演练；统一版本/配置台账，先一店升级再推广 |
| 首批收费前 | 官网说已付费，实际门店交付/停用无人跟进 | 为账号、订阅、门店网址、部署版本建立对应表；先人工履约也可 |
| 首批收费前 | 支付通知处理失败却回应成功，官网可能漏记付款 | 验收失败重试、重复事件不重复履约和账单对账；账号删除与取消订阅分开处理 |

这些是源码核对发现，**不是对线上已发生事故的断言**。本轮没有读取顾客数据、进行付费 AI 调用或测试真实支付。

### 测试证据的范围

门店目前仅有 bands、box-parser、cost、grid 四类扫描模块单元测试，未见核心业务端到端测试。扫描在 `AI_STUB` 开启或缺少扫描配置时会产生假检测；该开关不覆盖搜索、语音、照片识别和保存后的别名增强，不能把它当全系统离线保障。依据：[扫描配置][S35]。

官网当前有 5 个 E2E spec 文件，其中仍有访问已删管理页、期待已隐藏演示店链接的旧用例。不能沿用旧 AGENTS 的“41 个测试已覆盖全部门店功能”说法。本轮官网 `typecheck`、`lint`、完整 `build` 通过，sitemap/robots 使用生产域名；**这只验证官网代码检查和构建，不代表门店、真实 AI、收款和恢复已通过验收**。

## 旧需求需要重新拍板的地方

| 问题 | 旧要求 | 当前实际/新方向 | 本轮建议 |
| --- | --- | --- | --- |
| 服务交付 | 官网自助开店、传视频、平台绘图解锁 | 官网收款，人工独立部署 | 前十店明确采用人工协助交付 |
| 商业价格 | 历史进度表写 $999 一次性 | 当前配置 $199/月或 $1,990/年 | 以当前配置讨论；旧客户权益另记 |
| 店铺网址 | 固定 `xxx.whataisle.com` | 门店手册独立域名；官网将旧店铺子域跳回主页 | 先选永久顾客入口，未来换服务器保持网址/二维码不变 |
| 数据隔离 | 共享平台内按租户隔离 | 每店部署、数据库分开 | 十店阶段先沿用独立模式 |
| 地图等待 | 原正文允许先扫，7 月注释又要求绘图后解锁 | 当前可直接配货架列表，无图显示网格 | 先完成真实货架编号，真实地图随后交付 |
| 老板与员工权限 | 老板账号 + 员工 PIN | 官网老板账号与门店 PIN 分离，门店缺老板层 | 最小化补敏感操作授权，先不建复杂角色系统 |
| 数据保留 | 注销立即删除、原图可导出 | 部署手册建议停机留库；原图没有存 | 先明确实际承诺，再补导出/删除/备份策略 |
| 周报 | 需求要求，旧 STATUS 又称已砍 | 门店未见实现 | 延后自动邮件，保留简单使用反馈 |
| 上门全店建档 | 早期需求有付费人工建档服务 | 7 月已明确作废 | 不自动恢复；与人工配置/安装支持分开理解 |

下一轮只需先确认 **M1–M10 的“必须/可延后”**，再把决定转成开发任务。

## 代码证据

以下是本机核对入口，链接指向核对时的真实文件。具体版本见本文开头。

[P1]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(marketing)
[P2]: /Users/mystery/Desktop/dev/whataisle/src/i18n/routing.ts
[P3]: /Users/mystery/Desktop/dev/whataisle/src/proxy.ts
[P4]: /Users/mystery/Desktop/dev/whataisle/src/app/api/try-scan/route.ts
[P5]: /Users/mystery/Desktop/dev/whataisle/src/app/sitemap.ts
[P6]: /Users/mystery/Desktop/dev/whataisle/src/lib/metadata.ts
[P7]: /Users/mystery/Desktop/dev/whataisle/src/lib/auth.ts
[P8]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(protected)/settings
[P9]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(marketing)/(legal)
[P10]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/terms-update/page.tsx
[P11]: /Users/mystery/Desktop/dev/whataisle/src/config/website.tsx:121
[P12]: /Users/mystery/Desktop/dev/whataisle/src/payment/provider/stripe.ts
[P13]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(protected)/settings/billing/page.tsx
[P14]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(protected)/dashboard/page.tsx
[P15]: /Users/mystery/Desktop/dev/whataisle/src/app/[locale]/(protected)/admin/users/page.tsx
[P16]: /Users/mystery/Desktop/dev/whataisle/src/mail
[P17]: /Users/mystery/Desktop/dev/whataisle/src/components/auth/register-form.tsx:182
[P18]: /Users/mystery/Desktop/dev/whataisle/src/app/api/webhooks/stripe/route.ts:33
[S1]: /Users/mystery/Desktop/dev/whataisle-store/docs/DEPLOY_STORE.md
[S2]: /Users/mystery/Desktop/dev/whataisle-store/app/page.tsx
[S3]: /Users/mystery/Desktop/dev/whataisle-store/store.config.ts
[S4]: /Users/mystery/Desktop/dev/whataisle-store/lib/i18n.ts
[S5]: /Users/mystery/Desktop/dev/whataisle-store/app/api/search/route.ts:13
[S6]: /Users/mystery/Desktop/dev/whataisle-store/lib/agents/agent-b.ts
[S7]: /Users/mystery/Desktop/dev/whataisle-store/components/FindScreen.tsx
[S8]: /Users/mystery/Desktop/dev/whataisle-store/app/api/voice/route.ts
[S9]: /Users/mystery/Desktop/dev/whataisle-store/app/api/identify/route.ts
[S10]: /Users/mystery/Desktop/dev/whataisle-store/lib/agents/tools-b.ts
[S11]: /Users/mystery/Desktop/dev/whataisle-store/components/StoreMap.tsx
[S12]: /Users/mystery/Desktop/dev/whataisle-store/lib/shelf-save.ts
[S13]: /Users/mystery/Desktop/dev/whataisle-store/app/api/admin/products/route.ts:13
[S14]: /Users/mystery/Desktop/dev/whataisle-store/lib/ops.ts
[S15]: /Users/mystery/Desktop/dev/whataisle-store/app/api/search/feedback/route.ts:12
[S16]: /Users/mystery/Desktop/dev/whataisle-store/lib/staff-session.ts
[S17]: /Users/mystery/Desktop/dev/whataisle-store/app/admin/page.tsx
[S18]: /Users/mystery/Desktop/dev/whataisle-store/components/SnapScreen.tsx:159
[S19]: /Users/mystery/Desktop/dev/whataisle-store/lib/scan-queue/pump.ts
[S20]: /Users/mystery/Desktop/dev/whataisle-store/app/api/vision/route.ts:36
[S21]: /Users/mystery/Desktop/dev/whataisle-store/lib/scan/scan-service.ts
[S22]: /Users/mystery/Desktop/dev/whataisle-store/lib/scan-queue/outbox.ts
[S23]: /Users/mystery/Desktop/dev/whataisle-store/lib/store-config.ts:37
[S24]: /Users/mystery/Desktop/dev/whataisle-store/lib/agents/tools-a.ts
[S25]: /Users/mystery/Desktop/dev/whataisle-store/components/ShelfAdmin.tsx:59
[S26]: /Users/mystery/Desktop/dev/whataisle-store/app/dashboard/page.tsx
[S27]: /Users/mystery/Desktop/dev/whataisle-store/app/api/stats/route.ts
[S28]: /Users/mystery/Desktop/dev/whataisle-store/app/api/search-logs/route.ts
[S29]: /Users/mystery/Desktop/dev/whataisle-store/lib/mongodb.ts
[S30]: /Users/mystery/Desktop/dev/whataisle-store/scripts/deploy.sh:15
[S31]: /Users/mystery/Desktop/dev/whataisle-store/lib/vertex-core.ts:38
[S32]: /Users/mystery/Desktop/dev/whataisle-store/components/ShelfScanner.tsx
[S33]: /Users/mystery/Desktop/dev/whataisle-store/app/debug/page.tsx
[S34]: /Users/mystery/Desktop/dev/whataisle-store/app/vision-test/page.tsx
[S35]: /Users/mystery/Desktop/dev/whataisle-store/lib/scan/config.ts:49
