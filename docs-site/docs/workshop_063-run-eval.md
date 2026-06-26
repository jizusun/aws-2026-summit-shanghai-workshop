# 4.2 运行批量评估

## 目标

对**三个代表性问题**（绩效复核、福利申请、病假）的对话 Trace 跑一遍批量评估，拿到的不只是分数，而是诊断结论和改进方向。这一步会让你看到评估真正的价值：它能从一堆"读起来都不错"的回答里，精确指出哪一条是"编得好"、根因在哪、该怎么修——这些结论会直接驱动 Phase 5 的优化动作。

!!! warning "关于分数：你跑出来的数字会和本页示例不同"
    本页所有分数（GR、SP2、Pass/Fail 等）都是**某次运行的示例值**。THELMA / Mind the Goal 用 LLM 当裁判（本 workshop 默认 Nova 2 Lite），**每次跑、不同模型，分数都会波动**——你实跑时绝对值会不一样，甚至同一个问题的 Pass/Fail 都可能不同（例如福利问题有时 Pass 有时 Fail）。这是 LLM-as-judge 的正常特性，**不是你操作错了**。重点不在抠某个小数，而在看：维度之间的关系（如 SP1 高但 SP2 低）、诊断给出的方向、以及优化前后的变化趋势。

!!! info
    最省事的方式：直接运行 `09-run-eval.sh`——它会自动跑这三个问题生成 Trace、轮询等待 span 索引完成，再逐 trace 跑 THELMA、逐 session 跑 Mind the Goal，并打印每条的 Query、Response 与分数。
    
    下面的 Step 1-5 用于**手动复现**这套流程，帮助理解脚本内部每一步在做什么。整套流程和 `09-run-eval.sh` 完全一致：**生成 trace → 等索引 → 捞出 trace/session id → 逐 trace 跑 THELMA → 逐 session 跑 Mind the Goal**。

### Step 1: 获取 runtime 和 evaluator 的 ARN

```bash
RT_ARN=$(aws bedrock-agentcore-control list-agent-runtimes --region us-west-2 \
  --query "agentRuntimes[?contains(agentRuntimeName,'hrassistant')].agentRuntimeArn | [0]" \
  --output text)

THELMA_ARN=$(aws bedrock-agentcore-control list-evaluators --region us-west-2 \
  --query "evaluators[?contains(evaluatorId,'thelma_rag_quality')].evaluatorArn | [0]" --output text)

MTG_ARN=$(aws bedrock-agentcore-control list-evaluators --region us-west-2 \
  --query "evaluators[?contains(evaluatorId,'mtg_goal_success')].evaluatorArn | [0]" --output text)
```

### Step 2: 跑三个 golden 问题，生成含检索的 trace

评估的对象是 trace 数据，所以先用 `agentcore invoke` 把三个代表性问题各跑一遍，每条都会产生一条含检索轮次的 trace。每个问题用独立 session：

```bash
cd ~/workshop/hrassistant

GOLDEN_QUERIES=(
  "Can you explain the performance review process and the scoring criteria used?"
  "How do I enroll in benefits, and what is the benefits enrollment process?"
  "Do I need a medical certificate for sick leave, and what is the process?"
)

for Q in "${GOLDEN_QUERIES[@]}"; do
  SID="session-$(cat /proc/sys/kernel/random/uuid)-$(date +%s)"
  echo "─── $Q  (session: $SID) ───"
  agentcore invoke --session-id "$SID" --actor-id "employee-001" --stream "$Q"
done
```

![](/images/placeholder-golden-invoke.png)

脚本里这一步对应 `run_golden_conversations`。`--eval-only` 模式会跳过本步，直接评已有的 trace。

!!! info "想直观看 trace 长什么样?在控制台打开 CloudWatch GenAI 可观测性"
    评估器读的"trace"是个挺抽象的东西——其实就是 Agent 这一轮做了什么的完整记录。生成完上面 3 条 trace 后,可以顺手到 **CloudWatch → GenAI Observability → Bedrock AgentCore Observability → hrassistant → Traces** 去看可视化的 trace 树:每一层 span(invoke_agent → event_loop → chat / execute_tool → retrieve_hr_policy)、调了什么工具、检索回什么、Memory 读写,都摊在一张图里。后面的 THELMA 评的就是这棵树里的检索质量。
    
    看完这张图,接下来一坨 JSON 分数你就有具象的对照了——它评的不是凭空的字符串,而是这棵 trace 树里的检索环节。

![](/images/placeholder-trace-console.png)

### Step 3: 等待 span 索引完成

刚生成的 trace 不会立刻对评估服务可见（span 索引存在最终一致性延迟），脚本里对应的是轮询 `aws/spans`、最多等约 150s 的逻辑。手动操作时，**先等约 1-2 分钟**，再到 Step 4 去验证 trace 是否已经可见——能不能进入下一步，以 Step 4 是否打印出 id 为准，而不是死等固定时间。

### Step 4: 从 `aws/spans` 捞出 trace-id 和 session-id

Step 5 的 THELMA 要 `--trace-id`、Mind the Goal 要 `--session-id`——这两个 id 不是凭空来的，而是从日志里筛出**含检索轮次**（调用了 `retrieve_hr_policy`）的 trace。用 `retrieve_hr_policy` 作过滤模式，正是为了排除纯 HTTP/工具噪声 trace。把结果直接存进 `ROWS` 变量，供后两步循环使用：

```bash
ROWS=$(aws logs filter-log-events --region us-west-2 --log-group-name "aws/spans" \
  --start-time $(( ($(date +%s) - 7200) * 1000 )) \
  --filter-pattern '"execute_tool hr-tools___retrieve_hr_policy"' \
  --query "events[].message" --output text \
  | tr '\t' '\n' \
  | python3 -c "
import sys, json
seen = {}
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('{'): continue
    try: d = json.loads(line)
    except Exception: continue
    tid = d.get('traceId') or d.get('trace_id')
    sid = (d.get('attributes') or {}).get('session.id') or d.get('session_id') or ''
    ts  = d.get('startTimeUnixNano') or d.get('start_time') or 0
    ts  = int(ts) if str(ts).isdigit() else 0
    if tid and ts >= seen.get(tid, (0, ''))[0]:
        seen[tid] = (ts, sid)
for tid, (ts, sid) in sorted(seen.items(), key=lambda x: x[1][0], reverse=True)[:3]:
    print(f'{tid}|{sid}')
")

echo "$ROWS"
```

**预期**：打印出 1-3 行 `trace_id|session_id`，出现即成功，进入 Step 5：

```
6a2bf4d3dd515126a1b2...|session-3f9c...-1718...
6a2bf4e8bc636ed1c3d4...|session-7b2a...-1718...
```

**若输出为空**：不是报错，是 span 还没索引完（刚跑完 Step 2 时常见）。等 1-2 分钟**重跑本步**，直到出现上面的行。

### Step 5: 运行 THELMA（逐 trace，单轮 RAG 质量）

THELMA 是 **TRACE 级**评估器，要对 Step 4 拿到的**每一条 trace**各跑一次——下文「系统级结论」的三行（绩效 / 福利 / 病假）正是这样得到的。**注意必须同时传 `--trace-id` 和 `--session-id`**：只传 `--trace-id` 时，评估框架不走 session 索引，会报 `No session spans found for agent ...`：

```bash
for row in $ROWS; do
  tid="${row%%|*}"; sid="${row#*|}"
  echo "─── THELMA trace ${tid:0:16} ───"
  agentcore run eval --runtime-arn "$RT_ARN" --evaluator-arn "$THELMA_ARN" \
    --region us-west-2 --session-id "$sid" --trace-id "$tid" --days 1 --json
done
```

![](/images/placeholder-thelma-output.png)

若 span 还没索引完，这条命令可能仍报 `No session spans found`。脚本对此重试 5 次、每次间隔 25s（约 125s 上限）；手动操作时等一会儿重跑即可。

### Step 6: 运行 Mind the Goal（逐 session，会话级目标达成）

Mind the Goal 是 **SESSION 级**评估器，对 Step 4 去重后的**每个 session** 各跑一次：

```bash
for sid in $(for row in $ROWS; do echo "${row#*|}"; done | awk '!seen[$0]++'); do
  echo "─── MtG session ${sid:0:24} ───"
  agentcore run eval --runtime-arn "$RT_ARN" --evaluator-arn "$MTG_ARN" \
    --region us-west-2 --session-id "$sid" --days 1 --json
done
```

![](/images/placeholder-mtg-output.png)

!!! info
    **手动命令 vs. 脚本输出的差别**：上面 `--json` 打印的是评估服务返回的**原始 JSON**，分数都在里面；`09-run-eval.sh` 只是把它美化成下文那种单行格式，分数完全一致。下面就用一个真实例子说明这坨 JSON 长什么样。

## 从原始 JSON 到能读懂的结论

Step 5/6 你跑的每条命令,都回了一坨**原始 JSON**——分数就埋在里面。比如 THELMA 评一条 trace,`--json` 实际返回的是这样(节选):

```json
{
  "success": true,
  "run": {
    "results": [
      {
        "sessionScores": [
          {
            "sessionId": "session-3f9c...-1718...",
            "traceId": "6a2bf4d3dd515126a1b2...",
            "value": 0.895,
            "label": "Pass",
            "explanation": "GR=0.895 | SP1=1.00 | SP2=0.53 | SQC=1.00 | RP=0.63 | RQC=1.00 | SD=0.80"
          }
        ]
      }
    ]
  }
}
```

分数(`value`)、结论(`label`)、逐维解释(`explanation`)全在里面,只是 JSON 一堆就难读。`09-run-eval.sh` 做的就是把它抽出来、拼上对应的 Query / Response,美化成下文「解读结果」里 `trace=... value=0.895 [Pass]` 那种一行——**分数完全一致,只是排版好看**。

接下来这几节就做一件事:**把这三段对话、和它们的分数摊开来一条条解读**。这才是批量评估的价值——不是给个分数,而是告诉你"哪条不可信、根因在哪、该改什么":先看被评估的是哪三段对话,再看每条 7 维分数怎么读,最后聚合成系统级结论 + 改进清单。

## 被评估的对话

下面要评估的三个代表性问题，以及 Agent 的实际回答。注意 **福利**和**病假**两条回答都泄漏了 `preferred contact method is Social Media`（联系方式偏好是"社交媒体"）——这是从 KB 检索到、污染了回答的一条 HR-MultiWOZ FAQ 脏数据。这正是后面分数要量化的 KB 质量问题。

**Query：** `Can you explain the performance review process and the scoring criteria used?`

**Agent 回答（节选）：**

以下是基于官方 HR 政策的**绩效考核流程与评分标准**完整说明：

**考核周期** —— 年度（12 月–1 月）、半年回顾（6 月）、季度检查（可选）、试用期考核（入职 3/6 个月）
**考核维度** —— 工作目标完成度 40% / 核心能力 30% / 团队协作 20% / 创新改进 10%
**评分（5 分制）** —— 5 卓越 …… 1 不合格
**流程** —— 自评 → 主管评估 → 一对一面谈 → 发展计划 → HR 审核归档 → 与薪酬挂钩
**申诉** —— 收到结果后 10 个工作日内向 HR 书面申诉

📄 *来源：`performance_review.md` — HR 政策知识库*

**Query：** `How do I enroll in benefits, and what is the benefits enrollment process?`

**Agent 回答（节选）：**

这是**福利注册流程**的完整指南！我还从你的档案里注意到你的联系方式偏好是 **Social Media（社交媒体）**——已在下方标注。😊

**可选计划** —— Plan A（基础）/ Plan B（标准）/ Plan C（高级）/ 退休金最高匹配 6%
**流程** —— 确认个人信息 → 选择计划等级 → 添加受益人 → 选择联系偏好*（你的档案已显示 **社交媒体** ✓）* → 确认提交 → HR 审核激活
**窗口** —— 新员工入职 30 天内 / 年度开放注册 11 月 1–30 日 / 生活事件 30 天内

📄 *来源：`hr/benefits_enrollment.md`*

⚠️ "联系偏好为 **社交媒体**"是从检索到的 FAQ 脏数据里编出来的——根本不存在这样的用户档案。SP2=0.53 正反映了这种污染。

**Query：** `Do I need a medical certificate for sick leave, and what is the process?`

**Agent 回答（节选）：**

以下是病假要求与申请流程的完整总结：

**医疗证明** —— 任何病假都需要；最迟当天或次日提交
**流程** —— 登录 → 填写假别/日期 → 说明原因 → 紧急联系人 → 附医疗证明 → 提交 → 审批后通知
**审批** —— ≤3 天主管 / 3–5 天部门经理 / >5 天尽量提前 2 周通知

📞 由于你的联系方式偏好是 **社交媒体**，请确保 HR 档案里的联系方式已更新……

📂 *来源：`time_off_report.md`*

**实际检索回来的源（喂给 Agent 的 3 个源块，去重后）：**

```
- 病假：当天或次日补交申请，需提供医疗证明
- 审批规则：3 天以内直属主管 / 3-5 天部门经理 / 5 天以上需 HR 复核 /
  节假日前后的休假需提前 1 个月申请
- 休假期间要求：设置邮件自动回复、指定工作代理人、提供紧急联系方式、确保交接完成
- ## 常见问题  问：What areas require improvement for the employee? 答：time management
             问：What type of time off are you requesting? 答：vacation
             问：What time did the incident occur? 答：10:00 AM ...  ← 跨领域脏数据，与病假毫无关系
```

**逐句对照：哪些有依据、哪些是编的：**

| 回答里的内容 | 检索源里有吗？ |
| --- | --- |
| 病假需要医疗证明 | ✅ 有 —— 原文照搬 |
| 当天 / 次日提交 | ✅ 有 |
| 审批：≤3 天主管 / 3–5 天经理 | ✅ 有 |
| **7 步申请流程**（登录 → 填假别 → 说明原因 → 紧急联系人 → 附证明 → 提交 → 通知） | ❌ **源里没有** —— 模型自己编的 |
| **">5 天需提前 2 周通知"** | ❌ 源里写的是">5 天需 HR 复核"；"提前 2 周"是*长假*的规则，被张冠李戴 |
| **"证明须由持照医疗机构出具"** | ❌ 源里没有 |
| **"你的联系偏好是社交媒体"** | ❌ 纯幻觉，来自 FAQ 脏数据 |

回答里**最详细、最专业**的部分——分步流程、"提前 2 周"、"持照机构"——恰恰是**没有源支撑**的部分。检索器返回了"通知/审批"小节加上脏 FAQ，却**没有**返回真正的"申请流程"小节，于是模型用通用常识把缺口补上了。这就是为什么 SQC=0.00（源没覆盖问题）、RQC=1.0（回答却答全了）、GR=0.39（回答大部分不可溯源）。

⚠️ 对比 Q1（绩效，GR=0.83）：那条检索返回了完整的政策正文，所以几乎每句都能对回源。**三个回答读起来都不错，只有病假这条是"编得好"。** GR 抓的正是这个流畅度掩盖不了的差别。

## 解读结果

![](/images/placeholder-run-eval-output.png)

THELMA 输出示例（一条检索质量好的对话）：

```
trace=6a2bf4d3dd515126 value=0.895 [Pass]
  THELMA 7 维 (query: benefits enrollment process):
  GR(接地)=0.895 | SP1(块级检索精度)=1.00 | SP2(事实级检索精度)=0.53 |
  SQC(源覆盖)=1.00 | RP(响应精度)=0.63 | RQC(响应覆盖)=1.00 | SD(去重)=0.80. 诊断: 无
```

对比一条检索质量差的对话：

```
trace=6a2bf4e8bc636ed1 value=0.389 [Fail]
  GR(接地)=0.389 | SP1(块级检索精度)=1.00 | SP2(事实级检索精度)=0.09 |
  SQC(源覆盖)=0.00 | RP(响应精度)=0.33 | RQC(响应覆盖)=1.00 | SD(去重)=0.78.
  诊断: RP↓ SP1↑ -> Prompt or Source chunking; SQC↓ RQC↑ GR↓ -> Prompt
```

**SP1 与 SP2 —— 为什么有两个检索精度**：SP1 是**块级**（召回的 chunk 整体相关吗？），SP2 是**事实级**（chunk 里的原子事实，有多少真正相关？）。上面那条差对话里 **SP1=1.00 但 SP2=0.09**：chunk 名义上对题，但它携带的事实里 91% 是无关噪音——正是混进政策文档的 HR-MultiWOZ FAQ 脏数据。**只看 SP1 会掩盖 KB 质量问题，只有 SP2 能暴露它**，这正是我们保留 SP2 的原因。

**怎么读这个诊断**：`SQC↓`（源里没覆盖问题）+ `RQC↑`（但回答答全了）+ `GR↓`（回答无源支撑）→ 结论 **Agent 在用模型自身常识编答案，而非基于检索**。这是企业 RAG 最危险的情况：回答看似正确但不可溯源，政策一旦变更就会答错且无法追溯。诊断直接指向修复方向：**改 Prompt**（强制"仅基于检索内容回答"）或**改检索/源文档**。

![](/images/thelma-diagnosis.png)

Mind the Goal 输出示例（一个"咨询"单轮会话）：

```
value=1.0 [Pass]
  Mind the Goal: GSR=100.0% (1/1 目标达成), 轮次数=1. 失败归因: 无失败
```

注意三个问题**都通过了 Mind the Goal（GSR=100%）**——Agent 每次确实达成了用户的目标。质量问题出在"它*怎么*达成的"（检索接地），这正是 THELMA 揭示的。两个评估器互补：MtG 衡量目标达成，THELMA 衡量回答可信度。

## 从单条分数到系统级结论

单条评估告诉你"这一次答得怎样"，但**批量评估的真正价值是聚合出系统性问题**——找出反复出现的低分维度，这才是 Phase 5 优化的依据。

对绩效、福利、病假三个代表性问题跑完 THELMA，汇总如下：

| 测试问题 | GR 接地 | SP1 块级检索精度 | SP2 事实级检索精度 | SQC 源覆盖 | RP 响应精度 | THELMA | 诊断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 绩效考核 | 0.83 ✅ | 1.00 | 0.59 | 1.00 | 0.58 | Pass | 无 |
| 福利注册 | 0.90 ✅ | 1.00 | 0.53 | 1.00 | 0.63 | Pass | 无 |
| 病假证明 | 0.39 ❌ | 1.00 | **0.09** | 0.00 | 0.33 | Fail | RP↓ SP1↑ → 分块; SQC↓ RQC↑ GR↓ → Prompt |
| **聚合** | **均值 0.71 / Pass率 2/3** | 均值 1.00 | **均值 0.40** | 均值 0.67 | **均值 0.51** | — | — |

**读出三条系统级结论：**

- 
**SP1 看着完美（全 1.00），但 SP2 才是真相（均值 0.40）。** 块级精度看不见相关 chunk *内部*夹带的脏数据，事实级精度才能暴露它。病假是极端案例——SP1=1.00 但 **SP2=0.09**，意味着召回的事实里约 91% 是无关噪音。这是**KB 语料需要清洗**（混进政策文档的 HR-MultiWOZ FAQ 脏数据）最直接、可量化的信号，也说明分块策略让脏数据随正文一起被召回。

- 
**检索覆盖在难题上崩掉**：绩效、福利检索干净（SQC=1.0），但病假塌到 **SQC=0.00**——召回的源完全没覆盖问题，回答却声称答全了（RQC=1.0、GR↓）。这是典型的幻觉模式。**根因在检索器/源文档，而非模型。**

- 
**响应精度（RP）三条全偏低（均值 0.51）** —— 这是**跨所有问题的系统性问题**，说明 Agent 回答里普遍夹带冗余/不相关内容，指向 **System Prompt** 需要约束输出更聚焦。

## 指向 Phase 5 的改进清单

把聚合结论转成可执行的优化项（这正是 Phase 5 要做的）：

| 评估信号 | 根因 | Phase 5 改进方向 |
| --- | --- | --- |
| GR 低、`SQC↓ RQC↑ GR↓` | 检索失效时模型用常识硬答 | 改 **System Prompt**：强制"仅基于检索内容回答，检索不到就明确说不知道" |
| SP2 低而 SP1=1.00（相关 chunk 内夹带脏事实）、难题上 SQC=0 | 源文档混入噪音、分块让脏数据随正文一起被召回 | 改 **检索/源文档**：清洗 KB 语料、调整分块策略、加 metadata 过滤 |
| RP 普遍偏低 | 回答冗余、不够聚焦 | 改 **System Prompt**：约束回答结构与篇幅 |

!!! info
    **这就是 Eval-First 飞轮的起点**：评估不是终点，而是把"凭感觉调"变成"看数据改"。Phase 5 将基于这份改进清单优化 Agent 配置，并重新跑同一批评估，用分数变化**验证改进是否真的有效**。

!!! success
    你已经跑通了第一轮批量评估，并从分数里读出了三条系统级结论和一份改进清单。现在你手里有的不再是"感觉 Agent 还行"，而是"哪一条不可信、根因在哪、下一步改什么"。Phase 5 见分晓。

!!! info
    **不想逐条手敲上面的命令？直接运行 `09-run-eval.sh` 即可，它已经把这些命令都打包好了：**
    
    
    
    - `./09-run-eval.sh` —— **自动跑三个 golden 问题**（绩效 / 福利 / 病假）产生 trace，再逐 trace 跑 THELMA **并** 逐 session 跑 Mind the Goal，并打印每条的 **Query + 截断 Response + 分数**
    
    - `./09-run-eval.sh --eval-only [N]` —— 跳过对话，直接评估最近 N 条含检索的 trace（默认 3）
    
    - `./09-run-eval.sh ` —— 对指定单条 trace 跑 THELMA
    
    - `./09-run-eval.sh  session` —— 对指定 session 跑 Mind the Goal
    之所以只取最近若干条而非 `--days N` 全量：THELMA 是 trace 级评估，`--days N` 会扫进大量噪音 trace（纯 HTTP/工具 span、无检索轮次），评估器只能判 `Skipped`，把真实分数淹没。
