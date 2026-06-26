# 2.2 创建知识库

## 目标

创建一个 Bedrock Knowledge Base,把 11 篇 HR 政策文档灌入其中,作为 Agent 回答问题的**唯一**知识来源。为什么强调"唯一"——因为后面评估 Agent 有没有"编造"时,判断依据就是回答能否回溯到这些文档。知识来源越清晰,Groundedness(有据可查)才越有意义。

### Step 1: 运行知识库创建脚本

在 SSM 终端中执行:

```bash
1
2
cd ~/workshop
bash 01-create-kb.sh
```

脚本会自动完成:生成 11 篇 HR 政策文档 → 上传到 S3 → 创建 Bedrock Knowledge Base(S3 Vectors 向量存储)→ 灌库 → 把 KB ID 写入 SSM 参数(后续脚本自动读取)。运行约 **2-3 分钟**。

![](/images/placeholder-kb-running.png)

!!! warning "如果报 No such file or directory"
    说明 EC2 初始化脚本还没跑完。等 1-2 分钟后重试,或参考 2.1 的故障排除提示。

### Step 2: 确认创建成功

脚本完成后会打印知识库详情:

```text
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
=========================================
✅ Knowledge Base ready!
=========================================
  Name:              hr-knowledge-base
  Knowledge Base ID: EZCECPHWSQ
  Data Source ID:    9GQAOFSSZ9
  Region:            us-west-2
  Data location:     s3://workshop-data-<account-id>-us-west-2/hr/
  Vector Store Type: S3 Vectors
  Embedding model:   amazon.titan-embed-text-v2:0
  Dimension:         1024
=========================================
```

![](/images/placeholder-kb-success.png)

确认 **Ingestion COMPLETE** 且 indexed 文档数 > 0。

!!! warning
    如果显示 `Ingestion FAILED` 或索引文档数为 0,请确认 workshop-infra 栈已部署,然后重新运行脚本。

!!! info "为什么用 S3 Vectors 而不是 OpenSearch"
    传统做法是建一个 OpenSearch Serverless 集群作向量库,但它有最低 2 OCU 的常开成本(~$11.5/天)。S3 Vectors 是 2025 年推出的替代方案:向量索引直接存在 S3 里,**无常开费用、无集群管理**,按用量计费——对 workshop 和中小规模生产 KB 都很合适。

!!! success
    知识库就绪! Agent 现在有了回答 HR 问题的知识来源。下一步为它建立调用工具的受控通道。
