import { Button, Card, Popconfirm, Typography } from 'antd'
import { DeleteOutlined, DragOutlined, EditOutlined } from '@ant-design/icons'
import { useDashboardStore } from '../dashboardStore'
import type { DashboardWidget } from '../types'
import { WidgetRenderer } from './WidgetRenderer'

type Props = {
  widget: DashboardWidget
  readOnly?: boolean
  onEdit?: () => void
}

export function WidgetCard({ widget, readOnly = false, onEdit }: Props) {
  const deleteWidget = useDashboardStore((state) => state.deleteWidget)
  const widgetData = useDashboardStore((state) => state.widgetDataMap[widget.id])

  return (
    <Card
      size="small"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!readOnly ? <DragOutlined className="widget-drag-handle" style={{ cursor: 'grab', color: '#999' }} /> : null}
          <Typography.Text strong>{widget.title}</Typography.Text>
        </div>
      }
      extra={
        readOnly ? null : (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="small" icon={<EditOutlined />} onClick={onEdit}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除此组件？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void deleteWidget(widget.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </div>
        )
      }
      styles={{
        body: {
          flex: 1,
          overflow: 'hidden',
          padding: 8,
        },
      }}
    >
      <WidgetRenderer widget={widget} data={widgetData} />
    </Card>
  )
}

