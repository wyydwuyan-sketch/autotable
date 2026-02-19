import { Empty, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { WidgetData } from '../../types'

type TableRow = Record<string, unknown> & { id: string }

export function TableWidget({ data }: { data: WidgetData }) {
  const rows = ((data.data as TableRow[] | null) ?? []).filter((item) => item && typeof item === 'object')
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
  }

  const sample = rows[0]
  const fieldKeys = Object.keys(sample).filter((key) => key !== 'id')
  const columns: ColumnsType<TableRow> = fieldKeys.map((key) => ({
    title: key,
    dataIndex: key,
    key,
    ellipsis: true,
    render: (value) => (value === null || value === undefined || value === '' ? '-' : String(value)),
  }))

  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={rows}
      columns={columns}
      scroll={{ y: 220 }}
    />
  )
}

