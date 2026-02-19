import { Statistic } from 'antd'
import type { WidgetData } from '../../types'

type MetricPayload = {
  value?: number | string
  label?: string
}

export function MetricWidget({ data }: { data: WidgetData }) {
  const metric = (data.data ?? {}) as MetricPayload
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <Statistic title={metric.label ?? '指标'} value={metric.value ?? 0} />
    </div>
  )
}

