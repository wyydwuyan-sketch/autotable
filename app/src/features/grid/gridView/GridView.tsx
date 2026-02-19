import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, InputNumber, Pagination, Select, Space, Typography } from 'antd'
import { gridApiClient } from '../api'
import type { Field, RecordModel } from '../types/grid'
import { useGridStore } from '../store/gridStore'
import { GridHeader } from '../gridHeader/GridHeader'
import { GridRow } from '../gridRow/GridRow'
import { RecordDrawer } from '../recordDrawer/RecordDrawer'
import { useShallow } from 'zustand/react/shallow'

const ROW_HEIGHT = 40
const ROW_NUM_WIDTH = 108
const MAX_SERVER_PAGE_SIZE = 500
const FALLBACK_VIEW_CONFIG = {
  hiddenFieldIds: [],
  fieldOrderIds: [],
  frozenFieldIds: [],
  columnWidths: {},
  sorts: [],
  filters: [],
  isEnabled: true,
  order: 0,
  filterLogic: 'and',
  filterPresets: [],
  compactEmptyRows: false,
  components: {},
}

type GridRowDataProps = {
  fields: Field[]
  records: RecordModel[]
  totalWidth: number
  rowNumWidth: number
  frozenLeftMap: Record<string, number>
}

function RowRenderer(props: RowComponentProps<GridRowDataProps>) {
  return <GridRow {...props} />
}

export function GridView() {
  const navigate = useNavigate()
  const { baseId = 'base_1', tableId = 'tbl_1', viewId = 'viw_1' } = useParams()
  const {
    fields,
    views,
    records,
    totalRecords,
    activeViewId,
    viewConfig,
    setData,
    setRecordsPage,
    isLoading,
    setLoading,
      setToast,
      setColumnWidth,
      updateViewConfig,
      selectedRecordIds,
      isAllRecordsSelected,
      setRecordSelection,
  } = useGridStore(
    useShallow((state) => ({
      fields: state.fields,
      views: state.views,
      records: state.records,
      totalRecords: state.totalRecords,
      activeViewId: state.activeViewId,
      viewConfig: state.viewConfig,
      setData: state.setData,
      setRecordsPage: state.setRecordsPage,
      isLoading: state.isLoading,
      setLoading: state.setLoading,
      setToast: state.setToast,
      setColumnWidth: state.setColumnWidth,
      updateViewConfig: state.updateViewConfig,
      selectedRecordIds: state.selectedRecordIds,
      isAllRecordsSelected: state.isAllRecordsSelected,
      setRecordSelection: state.setRecordSelection,
    })),
  )

  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<ListImperativeAPI | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [jumpPageInput, setJumpPageInput] = useState('')
  const [metaReady, setMetaReady] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setMetaReady(false)
    const load = async () => {
      try {
        const [nextFields, nextViews, referenceMembers, nextButtonPermissions] = await Promise.all([
          gridApiClient.getFields(tableId),
          gridApiClient.getViews(tableId),
          gridApiClient.getTableReferenceMembers(tableId),
          gridApiClient.getMyTableButtonPermissions(tableId),
        ])
        const activeView = nextViews.find((view) => view.id === viewId) ?? nextViews[0]
        const resolvedViewId = activeView?.id ?? viewId
        if (!active) {
          return
        }
        setData(
          tableId,
          resolvedViewId,
          nextFields,
          referenceMembers,
          [],
          nextViews,
          activeView?.config ?? FALLBACK_VIEW_CONFIG,
          0,
          nextButtonPermissions,
        )
        setPage(1)
        setJumpPageInput('')
        setMetaReady(true)
        if (resolvedViewId !== viewId) {
          navigate(`/b/${baseId}/t/${tableId}/v/${resolvedViewId}`, { replace: true })
        }
      } catch (error) {
        if (!active) {
          return
        }
        const message = error instanceof Error ? error.message : '加载表格失败，请重试。'
        setToast(message)
        setLoading(false)
        setMetaReady(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [baseId, navigate, setData, setLoading, setToast, tableId, viewId])

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        filters: viewConfig.filters,
        sorts: viewConfig.sorts,
        filterLogic: viewConfig.filterLogic ?? 'and',
      }),
    [viewConfig.filterLogic, viewConfig.filters, viewConfig.sorts],
  )

  useEffect(() => {
    setPage(1)
    setJumpPageInput('')
  }, [queryKey, tableId, viewId])

  useEffect(() => {
    if (!metaReady) {
      return
    }
    let active = true
    setLoading(true)
    const loadPage = async () => {
      try {
        const safePageSize = Math.max(1, Math.min(pageSize, MAX_SERVER_PAGE_SIZE))
        const cursor = String(Math.max(0, (page - 1) * safePageSize))
        const pageData = await gridApiClient.getRecords(tableId, activeViewId ?? viewId, cursor, safePageSize, {
          filters: viewConfig.filters,
          sorts: viewConfig.sorts,
          filterLogic: viewConfig.filterLogic ?? 'and',
        })
        if (!active) {
          return
        }
        setRecordsPage(pageData.items, pageData.totalCount)
      } catch (error) {
        if (!active) {
          return
        }
        const message = error instanceof Error ? error.message : '加载分页数据失败，请重试。'
        setToast(message)
        setLoading(false)
      }
    }
    void loadPage()
    return () => {
      active = false
    }
  }, [
    activeViewId,
    metaReady,
    page,
    pageSize,
    queryKey,
    setLoading,
    setRecordsPage,
    setToast,
    tableId,
    viewConfig.filterLogic,
    viewConfig.filters,
    viewConfig.sorts,
    viewId,
  ])

  const visibleFields = useMemo(() => {
    const fieldOrderIds = viewConfig.fieldOrderIds ?? fields.map((field) => field.id)
    const orderMap = new Map(fieldOrderIds.map((id, index) => [id, index]))
    const baseFields = fields
      .filter((field) => !viewConfig.hiddenFieldIds.includes(field.id))
      .sort((a, b) => {
        const ai = orderMap.get(a.id)
        const bi = orderMap.get(b.id)
        const aOrder = ai === undefined ? Number.MAX_SAFE_INTEGER : ai
        const bOrder = bi === undefined ? Number.MAX_SAFE_INTEGER : bi
        return aOrder - bOrder
      })
      .map((field) => ({
        ...field,
        width: viewConfig.columnWidths[field.id] ?? field.width ?? 180,
      }))

    return baseFields
  }, [fields, viewConfig.columnWidths, viewConfig.hiddenFieldIds, viewConfig.fieldOrderIds])

  const totalWidth = useMemo(() => {
    const cols = visibleFields.reduce((sum, field) => sum + (field.width ?? 180), 0)
    return ROW_NUM_WIDTH + cols
  }, [visibleFields])
  const frozenFieldIds = useMemo(() => {
    const visibleIds = new Set(visibleFields.map((field) => field.id))
    return (viewConfig.frozenFieldIds ?? []).filter((id) => visibleIds.has(id))
  }, [viewConfig.frozenFieldIds, visibleFields])
  const frozenLeftMap = useMemo(() => {
    const frozenSet = new Set(frozenFieldIds)
    let left = ROW_NUM_WIDTH
    const offsets: Record<string, number> = {}
    for (const field of visibleFields) {
      if (!frozenSet.has(field.id)) {
        continue
      }
      offsets[field.id] = left
      left += field.width ?? 180
    }
    return offsets
  }, [frozenFieldIds, visibleFields])

  const displayedRecords = useMemo(() => {
    if (!viewConfig.compactEmptyRows || records.length <= 1 || visibleFields.length === 0) {
      return records
    }
    const visibleFieldIds = visibleFields.map((field) => field.id)
    const nonEmptyRows = records.filter((record) =>
      visibleFieldIds.some((fieldId) => !isEmptyValue(record.values[fieldId])),
    )
    if (nonEmptyRows.length === 0) {
      return records.slice(0, 1)
    }
    return nonEmptyRows
  }, [records, viewConfig.compactEmptyRows, visibleFields])
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))
  const currentPage = Math.min(page, totalPages)
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])
  const pageRecordIds = useMemo(() => displayedRecords.map((record) => record.id), [displayedRecords])
  const rowData = useMemo(
    () => ({
      fields: visibleFields,
      records: displayedRecords,
      totalWidth,
      rowNumWidth: ROW_NUM_WIDTH,
      frozenLeftMap,
    }),
    [displayedRecords, frozenLeftMap, totalWidth, visibleFields],
  )
  const selectedCountOnPage = useMemo(
    () => (isAllRecordsSelected ? pageRecordIds.length : pageRecordIds.filter((id) => selectedRecordIds.includes(id)).length),
    [isAllRecordsSelected, pageRecordIds, selectedRecordIds],
  )
  const allPageSelected = pageRecordIds.length > 0 && selectedCountOnPage === pageRecordIds.length
  const partiallyPageSelected = selectedCountOnPage > 0 && selectedCountOnPage < pageRecordIds.length
  const currentViewName = useMemo(() => {
    const targetViewId = activeViewId ?? viewId
    return views.find((view) => view.id === targetViewId)?.name ?? '未命名视图'
  }, [activeViewId, viewId, views])
  const handleSortField = useCallback(
    (fieldId: string, direction: 'asc' | 'desc') => {
      updateViewConfig({
        sorts: [{ fieldId, direction }],
      })
    },
    [updateViewConfig],
  )
  const handleToggleFreezeField = useCallback(
    (fieldId: string) => {
      const currentSet = new Set(viewConfig.frozenFieldIds ?? [])
      if (currentSet.has(fieldId)) {
        currentSet.delete(fieldId)
      } else {
        currentSet.add(fieldId)
      }
      const ordered = visibleFields.map((field) => field.id).filter((id) => currentSet.has(id))
      updateViewConfig({ frozenFieldIds: ordered })
    },
    [updateViewConfig, viewConfig.frozenFieldIds, visibleFields],
  )
  const handleHideField = useCallback(
    (fieldId: string) => {
      const hiddenSet = new Set(viewConfig.hiddenFieldIds)
      hiddenSet.add(fieldId)
      if (hiddenSet.size >= fields.length) {
        setToast('至少保留一个字段可见。')
        window.setTimeout(() => setToast(null), 1500)
        return
      }
      const nextHidden = fields.filter((field) => hiddenSet.has(field.id)).map((field) => field.id)
      updateViewConfig({ hiddenFieldIds: nextHidden })
    },
    [fields, setToast, updateViewConfig, viewConfig.hiddenFieldIds],
  )

  if (isLoading) {
    return <div className="grid-loading">正在加载表格...</div>
  }

  if (visibleFields.length === 0) {
    return (
      <div className="grid-root" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 64, marginBottom: 16, opacity: 0.2 }}>🗄️</div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>当前视图暂无可见字段</h3>
          <Typography.Text style={{ marginBottom: 24 }}>请前往视图管理，为当前视图添加或恢复字段</Typography.Text>
          <Button type="primary" onClick={() => navigate(`/b/${baseId}/t/${tableId}/v/${viewId}/config/views`)}>
            打开视图管理
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid-root">
      <div className="grid-scroll-host" ref={scrollHostRef}>
        <div className="grid-scroll-inner" style={{ width: totalWidth }}>
          <GridHeader
            fields={visibleFields}
            rowNumWidth={ROW_NUM_WIDTH}
            totalWidth={totalWidth}
            cornerTitle={currentViewName}
            frozenFieldIds={frozenFieldIds}
            frozenLeftMap={frozenLeftMap}
            onResizeColumn={(fieldId, width) => setColumnWidth(fieldId, width)}
            onSortField={handleSortField}
            onToggleFreezeField={handleToggleFreezeField}
            onHideField={handleHideField}
            allSelected={allPageSelected}
            partiallySelected={partiallyPageSelected}
            onToggleSelectAll={(checked) => setRecordSelection(pageRecordIds, checked)}
          />
          <div className="grid-body-host">
            <List
              key={viewId}
              listRef={listRef}
              className="grid-list"
              rowComponent={RowRenderer}
              rowCount={displayedRecords.length}
              rowHeight={ROW_HEIGHT}
              overscanCount={10}
              rowProps={rowData}
              style={{
                height: '100%',
                width: totalWidth,
              }}
            />
          </div>
        </div>
      </div>
      <div className="grid-pagination">
        <div className="grid-pagination-meta">
          共 {totalRecords} 条，当前第 {currentPage}/{totalPages} 页
        </div>
        <div className="grid-pagination-actions">
          <Space>
            <Pagination
              size="small"
              current={currentPage}
              total={totalRecords}
              pageSize={pageSize}
              showSizeChanger={false}
              onChange={(nextPage) => setPage(nextPage)}
            />
            <Select
              style={{ width: 102 }}
              value={String(pageSize)}
              onChange={(value) => {
                const next = Number(value)
                setPageSize(next)
                setPage(1)
              }}
              options={[
                { value: '25', label: '25 / 页' },
                { value: '50', label: '50 / 页' },
                { value: '100', label: '100 / 页' },
              ]}
            />
            <InputNumber
              style={{ width: 90 }}
              min={1}
              max={totalPages}
              placeholder="页码"
              value={jumpPageInput === '' ? null : Number(jumpPageInput)}
              onChange={(value) => setJumpPageInput(value == null ? '' : String(value))}
              onPressEnter={() => {
                const next = Number(jumpPageInput)
                if (!Number.isFinite(next)) return
                setPage(Math.min(totalPages, Math.max(1, Math.floor(next))))
                setJumpPageInput('')
              }}
            />
            <Button
              onClick={() => {
                const next = Number(jumpPageInput)
                if (!Number.isFinite(next)) return
                setPage(Math.min(totalPages, Math.max(1, Math.floor(next))))
                setJumpPageInput('')
              }}
            >
              跳转
            </Button>
          </Space>
        </div>
      </div>
      <RecordDrawer />
    </div>
  )
}
  const isEmptyValue = (value: unknown) =>
    value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
