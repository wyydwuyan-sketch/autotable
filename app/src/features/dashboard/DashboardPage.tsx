import { useEffect, useMemo } from 'react'
import GridLayout from 'react-grid-layout'
import { Empty, Spin, Typography } from 'antd'
import { useDashboardStore } from './dashboardStore'
import { WidgetCard } from './components/WidgetCard'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

export function DashboardPage() {
  const dashboard = useDashboardStore((state) => state.dashboard)
  const isLoading = useDashboardStore((state) => state.isLoading)
  const loadDashboard = useDashboardStore((state) => state.loadDashboard)

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const layouts = useMemo(
    () =>
      (dashboard?.widgets ?? []).map((widget) => ({
        i: widget.id,
        ...widget.layout,
        static: true,
      })),
    [dashboard?.widgets],
  )

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>
        {dashboard?.name ?? '首页大屏'}
      </Typography.Title>

      {isLoading ? <Spin /> : null}

      {!isLoading && dashboard && dashboard.widgets.length === 0 ? (
        <Empty description="大屏暂未配置，请联系管理员" style={{ marginTop: 80 }} />
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
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
        >
          {dashboard.widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetCard widget={widget} readOnly />
            </div>
          ))}
        </GridLayout>
      ) : null}
    </div>
  )
}
