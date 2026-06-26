# 2.5 创建并配置 Harness

## 目标

把前面创建的知识库、Gateway、Skills 整合到一个 Managed Harness 里——定义 System Prompt、接入 Gateway 工具、挂载 Skills、限定工具范围。这页步骤较多,但全是纯配置(改 `harness.json`),没有编排代码。完成后即可在下一页部署。

### Step 1: 编写 System Prompt

System Prompt 定义 Agent 的角色和行为规范:

```bash
cat > ~/workshop/system-prompt.txt << 'PROMPT'
You are a professional enterprise HR assistant (你是一位专业的企业HR助手). Your role is to help employees with all HR-related inquiries and operations.

## Capabilities
1. Answer HR policy questions — Leave policies, attendance rules, benefits, compliance guidelines
2. Help with leave applications — Guide employees through leave request procedures and approval workflows
3. Explain salary structure — Base pay, bonuses, deductions, pay grades, and compensation adjustments
4. Guide onboarding/offboarding — New hire checklists, equipment setup, exit procedures, knowledge transfer

## Tool Usage
- Use hr-tools to query the HR knowledge base and execute HR operations (leave balance lookup, policy retrieval, employee record queries)
- Do not use shell to directly call external APIs (all external data access must go through hr-tools)

## Output Format
- Provide clear, structured answers
- Always cite which policy document the answer comes from (e.g., "According to Employee Handbook Section 3.2...")
- When multiple policies apply, list each with its reference
- For procedural questions, provide step-by-step guidance

## Important Principles
- If you know the employee's department or role context, tailor your answers to their specific situation
- If you remember previous interactions with the employee, proactively apply that context rather than asking again
- Always cite which policy document the answer comes from
- If a question falls outside HR scope, politely redirect the employee to the appropriate department
PROMPT
```

!!! info
    两条关键设计原则:
    
    
    
    - **"所有外部数据必须通过 hr-tools"**——配合后面的 `allowedTools` 限制,防止 Agent 绕过 Gateway。
    
    - **"主动应用已知上下文"**——引导 Agent 利用 Memory 检索到的用户偏好。

### Step 2: 获取预部署的网络配置

```bash
export REGION="us-west-2"

SUBNETS=$(aws cloudformation describe-stacks \
  --stack-name workshop-infra \
  --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnets'].OutputValue" \
  --output text --region "$REGION")

SG=$(aws cloudformation describe-stacks \
  --stack-name workshop-infra \
  --query "Stacks[0].Outputs[?OutputKey=='SecurityGroupId'].OutputValue" \
  --output text --region "$REGION")

DATA_AP_ARN=$(aws cloudformation describe-stacks \
  --stack-name workshop-infra \
  --query "Stacks[0].Outputs[?OutputKey=='DataAccessPointArn'].OutputValue" \
  --output text --region "$REGION")

echo "Subnets: $SUBNETS"
echo "Security Group: $SG"
echo "Data Access Point: $DATA_AP_ARN"
```

### Step 3: 创建 Harness

```bash
agentcore create --name hrassistant --model-provider bedrock \
  --model-id "us.amazon.nova-2-lite-v1:0" \
  --network-mode VPC \
  --subnets "$SUBNETS" \
  --security-groups "$SG" \
  --memory longAndShortTerm \
  --max-iterations 30 \
  --max-tokens 8192 \
  --timeout 300

cd hrassistant
```

!!! warning "这一步要等约 60 秒,期间没输出是正常的"
    `agentcore create` 在后台会校验模型/网络/Memory 配置,并生成本地项目骨架(`hrassistant/` 目录 + `harness.json` + CDK 工程)。这一步**通常要等约 60 秒**,期间终端可能一直没有输出——这是正常的,耐心等它返回提示符即可,**不要重复敲命令或 Ctrl-C**。

![](/images/placeholder-harness-create.png)

!!! info
    `agentcore create` 会在当前目录创建 `hrassistant/` 子目录,包含 `app/hrassistant/harness.json` 配置文件和 `agentcore/` CDK 项目目录。这些参数在创建时一次性完成配置:
    
    
    
    - `--memory longAndShortTerm`:同时启用短期和长期 Memory。
    
    - `--max-iterations` / `--max-tokens` / `--timeout`:设置 agent 循环上限、单次响应最大输出 token 数、最大执行时长。

### Step 4: 接入 Gateway 工具

`hrgateway` 已在上一节创建,这里通过 ARN 引用(脚本已把 ARN 存到 SSM):

```bash
GATEWAY_ARN=$(aws ssm get-parameter \
  --name /app/hr/gateway_arn \
  --query "Parameter.Value" --output text --region "$REGION")

agentcore add tool --harness hrassistant \
  --type agentcore_gateway \
  --name hr-tools \
  --gateway-arn "$GATEWAY_ARN"
```

复制 System Prompt 到项目:

```bash
cp ~/workshop/system-prompt.txt app/hrassistant/system-prompt.md
```

### Step 5: 挂载 Skills 文件系统

把 S3 access point 挂载到 `/mnt/skills`(Skill 文件已在 2.4 上传):

```bash
cat app/hrassistant/harness.json | \
  jq --arg arn "$DATA_AP_ARN" \
  '.environment.agentCoreRuntimeEnvironment.filesystemConfigurations = [{"mountPath": "/mnt/skills", "s3FilesAccessPoint": {"accessPointArn": $arn}}]' \
  > tmp.json && mv tmp.json app/hrassistant/harness.json
```

告知 Harness 可用 Skill 文件的位置:

```bash
cat app/hrassistant/harness.json | \
  jq '.skills = ["/mnt/skills/skills/deep-policy-analysis/SKILL.md", "/mnt/skills/skills/leave-calculator/SKILL.md"]' \
  > tmp.json && mv tmp.json app/hrassistant/harness.json
```

### Step 6: 限制工具范围

把 Agent 能用的工具锁定为 hr-tools(防止它绕过 Gateway):

```bash
cat app/hrassistant/harness.json | \
  jq '.allowedTools = ["@hr-tools/*"]' > tmp.json && \
  mv tmp.json app/hrassistant/harness.json
```

### Step 7: 确认配置

```bash
cat app/hrassistant/harness.json | jq '{model, tools, memory, maxIterations, maxTokens, networkMode, skills, allowedTools, environment}'
```

确认以下关键字段:

- `model`：bedrock provider,modelId = `us.amazon.nova-2-lite-v1:0`

- `memory`:已启用短期 + 长期(`longAndShortTerm`)

- `allowedTools`:`["@hr-tools/*"]`

- `skills`:两个 SKILL.md 路径

- `networkMode`：VPC,且 `environment` 含 `filesystemConfigurations` 挂载配置

![](/images/placeholder-harness-config.png)

!!! success
    Harness 配置完成! 所有组件都拼到位了。下一步部署到 AWS,让 Agent 真正跑起来。
