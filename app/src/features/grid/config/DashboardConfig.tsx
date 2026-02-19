import { useEffect, useMemo, useState } from 'react'
import GridLayout from 'react-grid-layout'
import { Button, Empty, Spin, Typography } from 'antd'
import { EyeOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useDashboardStore } from '../../dashboard/dashboardStore'
import { WidgetCard } from '../../dashboard/components/WidgetCard'
import { WidgetEditor } from '../../dashboard/components/WidgetEditor'
import type { DashboardWidget } from '../../dashboard/types'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

type LayoutItem = { i: string; x: number; y: number; w: number; h: number }

export function DashboardConfig() {
  const navigate = useNavigate()
  const { tableId = 'tbl_1' } = useParams()
  const dashboard = useDashboardStore((state) => state.dashboard)
  const isLoading = useDashboardStore((state) => state.isLoading)
  const loadDashboard = useDashboardStore((state) => state.loadDashboard)
  const updateLayout = useDashboardStore((state) => state.updateLayout)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null)

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const layouts = useMemo(
    () =>
      (dashboard?.widgets ?? []).map((widget) => ({
        i: widget.id,
        ...widget.layout,
        minW: 2,
        minH: 2,
      })),
    [dashboard?.widgets],
  )

  return (
    <div className="grid-root" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          首页大屏配置
        </Typography.Title>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<EyeOutlined />} onClick={() => navigate('/dashboard')}>
            预览
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingWidget(null)
              setEditorOpen(true)
            }}
          >
            添加组件
          </Button>
        </div>
      </div>

      {isLoading ? <Spin /> : null}

      {!isLoading && dashboard && dashboard.widgets.length === 0 ? (
        <Empty description="暂无组件，点击「添加组件」开始配置" style={{ marginTop: 80 }} />
      ) : null}

      {!isLoading && dashboard && dashboard.widgets.length > 0 ? (
        <GridLayout
          className="layout"
          layout={layouts}
          width={1200}
          gridConfig={{
            cols: 12,
            rowHeight: 80,
            margin: [10, 10],
            containerPadding: [0, 0],
            maxRows: Number.POSITIVE_INFINITY,
          }}
          dragConfig={{
            handle: '.widget-drag-handle',
            enabled: true,
          }}
          onLayoutChange={(nextLayout) => updateLayout(nextLayout as LayoutItem[])}
        >
          {dashboard.widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetCard
                widget={widget}
                onEdit={() => {
                  setEditingWidget(widget)
                  setEditorOpen(true)
                }}
              />
            </div>
          ))}
        </GridLayout>
      ) : null}

      <WidgetEditor
        open={editorOpen}
        widget={editingWidget}
        defaultTableId={tableId}
        onClose={() => {
          setEditorOpen(false)
          setEditingWidget(null)
        }}
      />
    </div>
  )
}
