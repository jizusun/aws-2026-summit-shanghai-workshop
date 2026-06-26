# 5.2 重新评估验证效果

## 目标

用数据回答一个问题：刚才的 Prompt 优化，到底有没有用？这是 ADLC 飞轮闭合的最后一步——用同一套评估器、同一批问题，对比优化前后的分数。结论会有两面：哪些改进奏效了（检索好的问题），哪些问题的根因不在 Prompt（检索坏的问题）——后者恰恰反过来验证了 Phase 4 诊断的准确性。

### Step 1: 确认 v2 trace 已生成

和 Phase 4 一样，评估只对**刚生成的 3 条 v2 trace** 逐条进行——这样前后对比才是同样三个问题、只差 Prompt 这一个变量。所以**先确认 v2 trace 已落库并索引完成，再评估**，否则会评到优化前的旧 trace。

运行 5.1 的对话后等约 1-2 分钟，用 4.2 Step 4 的命令从 `aws/spans` 捞出最近 3 条含检索的 trace（即刚跑的 v2 三条），存进 `ROWS`：

```bash
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
RT_ARN=$(aws bedrock-agentcore-control list-agent-runtimes --region us-west-2 \
  --query "agentRuntimes[?contains(agentRuntimeName,'hrassistant')].agentRuntimeArn | [0]" --output text)
THELMA_ARN=$(aws bedrock-agentcore-control list-evaluators --region us-west-2 \
  --query "evaluators[?contains(evaluatorId,'thelma_rag_quality')].evaluatorArn | [0]" --output text)
MTG_ARN=$(aws bedrock-agentcore-control list-evaluators --region us-west-2 \
  --query "evaluators[?contains(evaluatorId,'mtg_goal_success')].evaluatorArn | [0]" --output text)

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

**预期**：打印出 3 行 `trace_id|session_id`（session 以 `v2-` 开头，对应刚跑的优化后对话），出现即成功，进入 Step 2。**若输出为空**：span 还没索引完，等 1-2 分钟重跑本步，直到出现。

### Step 2: 对 v2 trace 逐条重跑 THELMA

对 Step 1 拿到的每一条 v2 trace 跑 THELMA（必须同时传 `--session-id` 和 `--trace-id`）：

```bash
1
2
3
4
5
6
for row in $ROWS; do
  tid="${row%%|*}"; sid="${row#*|}"
  echo "─── THELMA trace ${tid:0:16} ───"
  agentcore run eval --runtime-arn "$RT_ARN" --evaluator-arn "$THELMA_ARN" \
    --region us-west-2 --session-id "$sid" --trace-id "$tid" --days 1 --json
done
```

### Step 3: 对 v2 session 逐个跑 Mind the Goal

```bash
1
2
3
4
5
for sid in $(for row in $ROWS; do echo "${row#*|}"; done | awk '!seen[$0]++'); do
  echo "─── MtG session ${sid:0:24} ───"
  agentcore run eval --runtime-arn "$RT_ARN" --evaluator-arn "$MTG_ARN" \
    --region us-west-2 --session-id "$sid" --days 1 --json
done
```

一键完成同样的事：`10-optimize-prompt.sh` 的 Step 4+5 会先轮询等待 v2 trace 索引、再调用 `09-run-eval.sh --eval-only 3` 逐条评估。**不要用 `--days 1` 全量评估**——它会把优化前的旧 trace 和噪声 trace 一起卷进来，让前后对比对不齐。

## 顺手在控制台看一眼:速度和成本变了吗

打开 **CloudWatch → GenAI Observability → Bedrock AgentCore → All sessions**(切到 Sessions 标签),你会看到 6 条 session:3 条 v1(老 session 名)+ 3 条 v2(`v2-...` 开头)。每条都自动带着 **Total tokens / Avg trace latency / Errors / Throttles**——这些指标**没人写过埋点代码**,Agent 一 invoke,平台就把它们结构化记录下来了。

![](/images/placeholder-sessions-compare.png)

把上下两批对着看,v2 三条的 **token 数和 latency 通常都明显低于 v1**——这是 5.1 那句"回答简洁聚焦"约束**第二个维度的证据**:

- THELMA 是从**质量**维度量改动(下面那张表会展开)

- Sessions 这张图是从**速度 + 成本**维度量同一个改动

合起来就是开头说的"三维记分牌:答得好、答得快、一次多少钱"。一次 Prompt 改动,三个维度同时改善——这才是能拿到 CXO 面前的论据,而不是只盯一项分数。

!!! info "对生产化的意义"
    这件事 **AWS 平台帮你做掉了**:每条对话自动带 token / latency / error / throttle 指标,session/trace 自动归档,**不需要自建可观测性栈**(对比传统 Agent:要么自己埋点 Prometheus + Grafana,要么用第三方 SaaS)。生产里把这些指标接进 CloudWatch 仪表盘和告警,质量回归(THELMA 跑 CI)+ 性能回归(token/latency 阈值告警)就能并行运行,这才是真正的 production-grade Agent 治理。

## 对比优化前后

![](/images/placeholder-reeval-compare.png)

!!! info
    这是一个**评估-迭代的示例**：大模型回答和检索召回都有一定随机性，这三条样本的分数在不同运行间会有所波动，甚至 Pass/Fail 结论也可能改变（例如病假这条，某次检索恰好成功时也可能 Pass）。下面的数字仅供参考，**重点看趋势和诊断方向，而非某个绝对分数**。

**绩效考核**（检索质量好，SP1=SQC=1.0）：

|  | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| GR 接地 | 0.83 ✅ | 0.87 ✅ | ↑0.04 |
| SP2 事实级精度 | 0.59 | **0.85** | **↑0.26，召回事实的相关性大幅提升** |
| RP 响应精度 | 0.58 | 0.73 | ↑0.15，回答更聚焦 |

**优化奏效！** 约束"严格基于检索 + 忽略无关内容 + 简洁聚焦"后，SP2 和 RP 明显上升——Agent 主动丢弃了 chunk 里夹带的脏 FAQ，只引用真正相关的事实。

最直观的证据是**福利注册**那条：优化前回答里凭空冒出 *"你的联系方式偏好是社交媒体"*（这是检索脏数据脑补出来的幻觉，根本不存在这样的用户档案）；优化后这句**彻底消失**了。这正回答了一个常见疑问——"LLM 难道分辨不出这条无关内容吗？"它能，但**基线 Prompt 没让它分辨**（反而要求它"主动应用上下文"）；加上"忽略无关检索内容"这条约束后，它就把脏数据过滤掉了。这证明：当检索内容本身没问题时，**Prompt 优化能有效减少幻觉、提升回答的可溯源性**。

## 有些问题改 Prompt 救不了

再看**病假证明**（检索本身失效，SP1=1.0 是假象、SP2 极低）：

|  | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| GR 接地 | 0.39 ❌ Fail | 0.31 ❌ **仍 Fail** | 仍是 Fail |
| SP1 块级精度 | 1.00 | 1.00 | 没变（块级看不出问题） |
| SP2 事实级精度 | 0.09 | 0.04 | **依旧极低（召回的事实 96% 无关）** |

**Prompt 优化救不了病假问题。** 原因一目了然：`SP1=1.00 但 SP2≈0` 说明**召回的 chunk 名义上对题、实则里面绝大多数是无关脏内容**（KB 混入了 MultiWOZ FAQ 噪音、分块把脏数据和正文切在一起）。当 Agent 手里根本没有正确的源文档时，再怎么约束"严格基于检索"也无济于事——巧妇难为无米之炊。

!!! info
    **这恰恰验证了 THELMA 诊断的准确性**：它早在 Phase 4 就用 `SP2≈0 / SQC=0` 告诉你"病假的问题在检索/知识库，不在 Prompt"。现在改 Prompt 救了绩效、福利（检索好），救不了病假（检索坏），完美印证了诊断的指向。

## 结论与下一步

| 问题类型 | 根因 | 正确的优化手段 | 状态 |
| --- | --- | --- | --- |
| 检索好、回答没用好 | Prompt | **改 System Prompt**（本阶段已演示） | ✅ 已完成 |
| 检索失效（SP2≈0、SQC=0） | 知识库/分块 | 清洗 KB 语料、调整分块、加 metadata 过滤 | 🔜 下一步计划（知识库工程） |

**关键认知**：评估不只是打分，它**精准区分了"该改 Prompt"还是"该改检索"**。盲目优化（比如对病假问题死磕 Prompt）只会浪费时间——Eval-First 让你把精力花在对的地方。

!!! info
    对于检索失效类问题，正确方向是回到知识库工程：清洗源文档、优化分块策略（如按语义/标题分块而非固定大小）、给文档加 metadata 做检索过滤。这超出本 workshop 范围，但评估数据已经明确告诉你该往这个方向走。

至此你完成了一轮完整的 **Eval → 诊断 → 优化 → 再评估**飞轮：批量评估发现问题（Phase 4）→ 诊断定位根因 → 优化 System Prompt（5.1）→ 重新评估用数据验证改进（5.2）。

这个闭环是可重复的：每次改动 Agent（Prompt、工具、检索配置）后，重跑同一批评估对比分数，就能客观判断改动是进步还是退步。生产环境还可在 AgentCore 控制台配置**在线评估**，对真实流量持续监控质量。

!!! success
    你完整跑通了一轮 Eval-First 飞轮：评估发现问题 → 诊断定位根因 → 优化 Prompt → 再评估用数据验证。更重要的是，你亲眼看到了评估的诊断价值——它提前告诉你"绩效、福利改 Prompt 能救，病假得改检索"，而数据完全印证了这一点。这就是从 Demo 走到生产的那道工程纪律。
