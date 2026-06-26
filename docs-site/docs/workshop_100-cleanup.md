# 清理资源

!!! warning
    如果你使用的是 Workshop Studio 提供的临时账号，Workshop 结束后资源会自动清理——无需手动操作。以下步骤仅适用于自有账号。

## 一键清理（阶段一）

清理脚本位于仓库的 `static/scripts/` 目录，从该目录运行：

```bash
cd static/scripts
bash 99-cleanup.sh
```

脚本按**依赖反向顺序**销毁资源（顺序很重要，下面有说明）：

- 销毁 AgentCore 项目（Harness、Memory、两个自定义评估器 Lambda，通过 `agentcore destroy`）

- 删除独立 Gateway（target、Gateway 本身、`hrassistant-gateway-role` 角色、SSM 参数）

- 删除 Bedrock Knowledge Base（KB、数据源、**S3 Vectors 向量桶/索引**、KB 执行角色、SSM 参数）

- 删除游离的 `hr-tools-lambda-role`（CFN 之外、由建网关脚本创建的同名无后缀角色）

- **清空** `workshop-infra` 栈管理的 S3 桶（按**所有版本 + delete-marker** 清空，因为桶开启了版本控制）

- 删除 `workshop-infra` CloudFormation 栈（VPC、子网、NAT、EC2、Lambda、S3 桶、IAM 角色等）

- （可选）回滚账户级 X-Ray Transaction Search 改动——默认跳过，设 `CLEANUP_XRAY=1` 才执行

- 清理本地 `~/workshop/hrassistant` 目录

!!! warning
    **为什么顺序不能乱：**
    
    
    
    - **必须先删独立 Gateway / KB，`agentcore destroy` 不管它们。** 它们是脚本用 boto3 单独创建的、Harness 仅按 ARN 外部引用，不在 AgentCore 项目栈里——靠 `agentcore destroy` 删不掉，会残留 Gateway、向量桶和 IAM 角色。
    
    - **必须先清空 S3 桶，再删 CloudFormation 栈。** 桶由栈管理且开启了版本控制（Versioning）+ 对象锁定（ObjectLock），CloudFormation 无法删除非空桶。`aws s3 rm --recursive` 只删当前版本，会留下旧版本和 delete-marker 导致删栈失败，因此脚本用 `s3api delete-objects` 按版本逐批清空。

## 关于网络资源（ENI 回收）

!!! info
    **`workshop-infra` 栈删除时可能会卡在网络资源上，这是预期行为，无需人工干预。**
    
    HR Tools Lambda 挂载在 VPC 中，AgentCore Harness 运行时也使用同一组私有子网和安全组。删除它们之后，AWS 托管的弹性网络接口（ENI）需要**异步回收，通常 20–40 分钟**，期间这些 ENI 仍占用子网/安全组，导致子网、安全组、VPC 暂时删不掉。这些 ENI 是托管的，无法手动删除，只能等 AWS 回收。
    
    清理脚本会自动处理：如果删栈卡在网络资源上，它用 `--retain-resources` 把这些资源标记为保留，让栈立即进入 `DELETE_COMPLETE`（**栈名 `workshop-infra` 当场释放，可立即重建**）。被保留的 VPC/子网/安全组会在 ENI 回收后由 AWS 自动清理，**无需人工干预，也不产生费用**。保留资源清单写入 `~/workshop/.cleanup-retained-resources.txt` 供参考。

## 验证

清理完成后，确认无残留栈：

```bash
aws cloudformation list-stacks \
  --stack-status-filter DELETE_COMPLETE \
  --query "StackSummaries[?contains(StackName,'workshop') || contains(StackName,'hrassistant')].{Name:StackName,Status:StackStatus}" \
  --output table --region us-west-2
```

确认 VPC 已彻底删除（应无输出）：

```bash
aws ec2 describe-vpcs --region us-west-2 \
  --filters "Name=tag:Name,Values=workshop-harness-vpc" \
  --query "Vpcs[].VpcId" --output text
```

!!! info
    脚本在删除某项资源失败时会打印 ⚠️ 警告但继续执行，确保尽量多的资源被清理。整个过程：阶段一约 10–15 分钟，之后等 ENI 回收约 20–40 分钟，再跑阶段二约 1–2 分钟。如有未删除项，根据告警提示到 AWS 控制台手动确认。
