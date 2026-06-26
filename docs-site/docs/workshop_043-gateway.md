# 2.3 创建 Gateway

## 目标

为 Agent 建立一个调用外部工具的**受控通道**。知识库解决了"用什么回答",Gateway 解决"怎么调用外部能力"——它是 Agent 访问所有工具的唯一入口。对应 BP3(清晰的工具策略):工具定义越清晰,后续评估"工具调用正确性"的信号越精准。

这一步创建一个带 Lambda 目标的 Gateway,为 Agent 提供 HR 知识检索 + 模拟 HR 操作(查余额、提交申请、查薪资)。

### Step 1: 运行 Gateway 创建脚本

一条命令完成:部署 HR Tools Lambda → 创建 Gateway → 创建指向该 Lambda 的 Target。

```bash
cd ~/workshop
bash 02-create-gateway.sh
```

![](/images/placeholder-gateway-running.png)

### Step 2: 确认 Gateway 就绪

脚本完成后打印 Gateway 与 Target 详情:

```text
=========================================
✅ Gateway ready!
=========================================
  Gateway name:    hrgateway
  Gateway ID:      hrgateway-xxx
  Gateway URL:     https://hrgateway-xxx.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp
  Target name:     hr-tools
  Lambda ARN:      arn:aws:lambda:us-west-2:<account-id>:function:hr-tools-handler
  Protocol:        MCP
  Authorizer:      AWS_IAM
=========================================
```

![](/images/placeholder-gateway-success.png)

确认 Protocol 是 **MCP**、Target name 是 **hr-tools**。Gateway ARN 会自动写入 SSM,后续创建 Harness 时引用。

!!! info "一个 Lambda 怎么处理多个工具"
    HR Tools Lambda 内部根据 Gateway 传来的工具名分发到不同操作(retrieve_hr_policy、check_leave_balance、submit_leave_request、query_salary_info)。一个函数承载多个工具,Gateway 负责路由。

!!! success
    受控通道建好了! Agent 现在能通过 Gateway 检索知识库、执行 HR 操作。下一步为它配置按需加载的 Skills。
