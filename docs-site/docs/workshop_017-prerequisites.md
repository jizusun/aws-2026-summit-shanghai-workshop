# 预部署资源

## 预部署资源

以下资源已通过 CloudFormation 自动部署到你的 Workshop 账号中：

| 资源 | 说明 |
| --- | --- |
| VPC + 私有子网 + NAT 网关 | Harness VPC 模式所需的网络基础设施 |
| S3 存储桶 + S3 访问点 | 存储 Skill 文件，通过 BYO Filesystem 挂载到 Harness 会话 |
| 安全组 | Harness + EC2 出站访问（全部放行） |
| EC2 实例 (t3.medium, 30GB) | 预装 Node.js 22 + AgentCore CLI + jq，通过 SSM Session Manager 连接 |

## 实验过程中由参与者创建的资源

| 资源 | 说明 |
| --- | --- |
| AgentCore Harness | Agent 运行时（VPC 模式） |
| AgentCore Gateway + Target | HR 工具（Lambda → Bedrock KB + HR 操作） |
| AgentCore Memory | 自动提取用户偏好并跨会话检索 |
| Skill 文件 (S3) | `deep-policy-analysis` 和 `leave-calculator` Skills |

## 连接方式

- **SSM Session Manager**（内置于控制台，无需 SSH 密钥，无需开放端口）

!!! warning
    请确认你正在 **us-west-2 (Oregon)** 区域中操作。
