# 4.1 创建自定义评估器

## 目标

把 THELMA 和 Mind the Goal 两个评估算法注册为 AgentCore 原生评估器并部署。注册后它们成为平台的一部分——后续每次 `run eval`,AgentCore 会自动调用它们、传入 Trace 数据、收回评分。

评估器源码(含评估算法、适配层、Lambda handler)随 workshop 提供,位于 `evaluators/thelma_eval/` 和 `evaluators/mtg_eval/`——这正是"买平台、拥有内容"的体现:平台负责调度,评估标准是你自己的资产。

!!! info
    **嫌步骤多?** 直接运行 `bash ~/workshop/08-create-evaluators.sh` 即可,它打包了"复制源码 → 注册 → 部署 → 授权 Bedrock 权限"的完整流程。下面是逐步展开。

## 评估器的工作方式

每个评估器本质上是一个 **Lambda 函数**。部署后，它**不由你调用**——当你触发评估时，**AgentCore 评估服务会自动调用它**：把一次对话的 trace 数据"喂"进去，再收回一个评分结果。整个过程是这样：

```
你的对话 trace ──→ AgentCore 评估服务 ──→ 调用评估器 Lambda ──→ 返回评分
                （自动封装成输入）                          （写入结果）
```

**评估器收到什么（输入）**——评估服务会把一次对话的原始追踪数据传给评估器，主要包含：

| 输入信息 | 说明 |
| --- | --- |
| 评估级别 | 这次评估是按整场会话（SESSION）、单轮（TRACE）、还是单次工具调用（TOOL_CALL）来评 |
| 会话 span 数据 | 这次对话的全部原始追踪数据（即 trace），评估器从中提取问题、检索内容、回答等 |
| 目标 trace | TRACE 级评估时，指明要评的是哪一条 |

**评估器返回什么（输出）**——评估器算完后，回传三样东西：

| 输出字段 | 含义 |
| --- | --- |
| **分数（value）** | 一个数值分，例如 `0.94` |
| **标签（label）** | 一个结论标签，例如 `Pass` / `Fail` |
| **说明（explanation）** | 一段文字解释，说明这个分数是怎么来的 |

## 注册评估器

### Step 1: 复制源码并注册

把评估器源码复制到项目目录,然后逐个注册:

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
cd ~/workshop/hrassistant
cp -r ~/workshop/evaluators/thelma_eval evaluators/
cp -r ~/workshop/evaluators/mtg_eval evaluators/

# 注册 THELMA（TRACE 级）。config 文件只含 config 层。
cat > /tmp/thelma-config.json <<'JSON'
{"codeBased":{"managed":{"codeLocation":"evaluators/thelma_eval","entrypoint":"lambda_function.handler","timeoutSeconds":180}}}
JSON
agentcore add evaluator --name thelma_rag_quality --level TRACE \
  --type code-based --config /tmp/thelma-config.json

# 注册 Mind the Goal（SESSION 级）
cat > /tmp/mtg-config.json <<'JSON'
{"codeBased":{"managed":{"codeLocation":"evaluators/mtg_eval","entrypoint":"lambda_function.handler","timeoutSeconds":180}}}
JSON
agentcore add evaluator --name mtg_goal_success --level SESSION \
  --type code-based --config /tmp/mtg-config.json

# 注册会用 scaffold 重建 evaluator 目录,丢掉 shared/ 和 evaluators/ 子模块。
# 这里直接整个目录覆盖回去(含 shared/、evaluators/ 子模块),保证打包完整。
rm -rf evaluators/thelma_eval evaluators/mtg_eval
cp -r ~/workshop/evaluators/thelma_eval evaluators/
cp -r ~/workshop/evaluators/mtg_eval    evaluators/
```

![](/images/placeholder-register-evaluator.png)

!!! warning
    必须 `rm -rf` + `cp -r` 整个目录,不能只 cp `lambda_function.py` 和 `pyproject.toml`。`agentcore add evaluator` 的 scaffold 会重建 codeLocation 目录,丢掉 `shared/` 和 `evaluators/` 子模块,部署后 Lambda 启动时会报 `No module named 'shared'`。

## 部署

### Step 2: 部署评估器

```bash
1
2
3
4
# 清构建缓存，确保用最新代码
rm -rf agentcore/.cache/thelma_rag_quality agentcore/.cache/mtg_goal_success

agentcore deploy --yes
```

![](/images/placeholder-eval-deploy.png)

!!! warning "如果部署报 LogGroup already exists"
    在**同一账号重复跑过本 workshop**时，可能残留上次的评估器日志组，导致部署回滚并报 `AWS::Logs::LogGroup '/aws/lambda/hrassistant-eval-...' already exists`。先删掉残留日志组再重试即可（全新临时账号不会遇到）：
    
    `1
    2
    3
    4
    `for FN in hrassistant-eval-thelma_rag_quality hrassistant-eval-mtg_goal_success; do
      aws logs delete-log-group --log-group-name "/aws/lambda/$FN" --region us-west-2 2>/dev/null || true
    done
    agentcore deploy --yes（脚本 `08-create-evaluators.sh` 已自动做这步预清理。）

### Step 3: 授予评估器 Bedrock 权限

评估器执行角色默认只有 `AWSLambdaBasicExecutionRole`，没有 Bedrock 权限。LLM-as-judge 评估必须能调用模型，否则报 `AccessDenied`。给两个 evaluator 角色补权限：

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
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cat > /tmp/eval-bedrock-policy.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],
  "Resource":["arn:aws:bedrock:*::foundation-model/*","arn:aws:bedrock:*:${ACCOUNT_ID}:inference-profile/*"]}]}
JSON

for FN in hrassistant-eval-thelma_rag_quality hrassistant-eval-mtg_goal_success; do
  ROLE=$(aws lambda get-function-configuration --function-name "$FN" --region us-west-2 \
    --query Role --output text | sed 's/.*role\///')
  aws iam put-role-policy --role-name "$ROLE" \
    --policy-name EvaluatorBedrockInvoke --policy-document file:///tmp/eval-bedrock-policy.json
done
```

!!! info
    inference-profile（如 `us.amazon.nova-2-lite-v1:0`）需同时授权 profile ARN 和底层 foundation-model ARN。

## 验证

### Step 4: 确认评估器 ACTIVE

```bash
1
2
aws bedrock-agentcore-control list-evaluators --region us-west-2 \
  --query "evaluators[?contains(evaluatorId,'thelma')||contains(evaluatorId,'mtg')].{id:evaluatorId,level:level,status:status}"
```

两个评估器应为 `ACTIVE`。

![](/images/placeholder-evaluators-active.png)

!!! success
    两个评估器已上线! 下一步对 Phase 3 的对话跑一次评估,看 Agent 答得到底好不好。
