# DashScope QPS 配额提升工单草稿（提交用）

> 提交入口：阿里云国际站控制台 → 工单（Support Center → Submit Ticket）→
> 产品选 Model Studio / DashScope，类别选 Quota / Rate Limit。
> 下文英文部分可直接粘贴。

---

**Subject:** Request: raise request-rate (RPM/QPS) quota for qwen3-vl-flash — burst-parallel vision pipeline

**Body:**

We run a production retail shelf-scanning pipeline on Model Studio
(Singapore region, account: <你的账号ID>) that fans one photo out into
~30 short parallel vision calls (strip-parallel detection + batched
transcription, raced for tail-latency control). Latency target is <10s
per photo end to end.

Measured behavior (2026-07-15, qwen3-vl-flash, paid tier, temporary TPM
already raised to 2,000,000 via self-service):

- A lone call completes in ~2.4s.
- With 6+ calls in flight, every call slows to ~4.9s; with 12+, retry
  tails appear (up to 23s). This matches request-rate smoothing around
  the default 1,200 RPM (20 QPS) rather than TPM (our burst is ~25K
  tokens/s, well under the raised TPM).
- Consequence: our per-photo latency is 9-10s in off-peak hours but
  11-14s during Singapore business hours.

Request:

1. Raise the request-rate allowance for `qwen3-vl-flash` on this account
   from 1,200 RPM to 3,600 RPM (or the Beijing-region parity of 3,000
   RPM), or advise the intended mechanism for burst-parallel workloads.
2. If `qwen3-vl-flash` is scheduled for retirement (the console labels
   it "即将下线"), please confirm the recommended successor for
   low-latency vision grounding and its rate limits, so we can plan our
   migration (we are evaluating qwen3.5-flash).

Usage evidence available on the account: ~3,000 calls / 3.3M tokens on
2026-07-15 across qwen3-vl-flash and qwen3.5-flash.

---

## 附：给自己看的背景数据（不必贴进工单）

| 配置 | 窗口 | 实测 |
|---|---|---|
| qwen-race + fast（终版） | 多伦多白天（SGT 夜间，轻载） | 8.9-9.9s，5/5 <10s |
| 同上 | 多伦多夜间（SGT 白天，重载） | 9.7-12.3s，P50 11.5s |
| TPM 1M→2M 提额后 | 重载 | 无显著改善 → 卡点为 QPS 平滑 |

- 24h 测绘：scratchpad/loadmap.csv（每小时一行，自动汇总）
- 一键复测：`./scripts/bench-label-pipeline.sh <照片> <cookie> qwen-race 5`
