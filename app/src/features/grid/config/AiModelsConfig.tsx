import { Card, Typography } from 'antd'

export function AiModelsConfig() {
  return (
    <div className="grid-root" style={{ padding: 24, overflowY: 'auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
        模型管理
      </Typography.Title>
      <Typography.Text type="secondary">
        当前版本提供入口与占位内容，后续可在此维护模型接入配置、版本与权限。
      </Typography.Text>
      <Card style={{ marginTop: 16 }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          建议下一步增加模型提供商配置、默认模型选择和调用配额策略。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
