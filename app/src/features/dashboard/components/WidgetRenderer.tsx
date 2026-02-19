import { Empty, Spin } from 'antd'
import type { DashboardWidget, WidgetData } from '../types'
import { BarWidget } from './widgets/BarWidget'
import { LineWidget } from './widgets/LineWidget'
import { MetricWidget } from './widgets/MetricWidget'
import { PieWidget } from './widgets/PieWidget'
import { TableWidget } from './widgets/TableWidget'

type Props = {
  widget: DashboardWidget
  data?: WidgetData
}

export function WidgetRenderer({ widget, data }: Props) {
  if (!data) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin size="small" />
      </div>
    )
  }

  if (data.error) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data.error} />
  }

  switch (widget.type) {
    case 'metric':
      return <MetricWidget data={data} />
    case 'bar':
      return <BarWidget data={data} />
    case 'line':
      return <LineWidget data={data} />
    case 'pie':
      return <PieWidget data={data} />
    case 'table':
      return <TableWidget data={data} />
    default:
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`未知组件类型: ${widget.type}`} />
  }
}

