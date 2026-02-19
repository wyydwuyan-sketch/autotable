import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Avatar, Button, Checkbox, Input, Layout, Menu, Popover, Select, Space, Tag, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  BarsOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  FormOutlined,
  FundProjectionScreenOutlined,
  ImportOutlined,
  EyeOutlined,
  PlusOutlined,
  SettingOutlined,
  SortAscendingOutlined,
  TableOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useGridStore } from '../features/grid/store/gridStore'
import { gridApiClient } from '../features/grid/api'
import type { FilterCondition, FilterLogic, SortCondition, View } from '../features/grid/types/grid'
import { buildViewPath } from '../features/grid/utils/viewRouting'
import { useAuthStore } from '../features/auth/authStore'
import { useShallow } from 'zustand/react/shallow'
import { FilterModal } from '../features/grid/components/modals/FilterModal'
import { SortModal } from '../features/grid/components/modals/SortModal'
import { CreateRecordModal } from '../features/grid/components/modals/CreateRecordModal'
import { confirmAction } from '../utils/confirmAction'

const tableItems = [
  { id: 'tbl_1', name: '项目任务' },
]
const configRouteMap: Record<string, string> = {
  'config:views': 'config/views',
  'config:components': 'config/components',
  'config:dashboard': 'config/dashboard',
  'config:ai-models': 'config/ai-models',
  'config:members': 'config/members',
}
const { Header, Sider, Content } = Layout

type ShareQuery = {
  filterLogic: FilterLogic
  filters: FilterCondition[]
  sorts: SortCondition[]
}

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { baseId = 'base_1', tableId = 'tbl_1', viewId = 'viw_1' } = useParams()
  const {
    fields,
    pageRecordCount,
    totalRecords,
    views,
    selectedRecordIds,
    isAllRecordsSelected,
    toast,
    createRecord,
    deleteSelectedRecords,
    clearSelectedRecords,
    selectAllRecords,
    updateViewConfig,
    importRecords,
    viewConfig,
    tableButtonPermissions,
    cascadeRules,
    tableReferenceMembers,
  } = useGridStore(
    useShallow((state) => ({
      fields: state.fields,
      pageRecordCount: state.records.length,
      totalRecords: state.totalRecords,
      views: state.views,
      selectedRecordIds: state.selectedRecordIds,
      isAllRecordsSelected: state.isAllRecordsSelected,
      toast: state.toast,
      createRecord: state.createRecord,
      deleteSelectedRecords: state.deleteSelectedRecords,
      clearSelectedRecords: state.clearSelectedRecords,
      selectAllRecords: state.selectAllRecords,
      updateViewConfig: state.updateViewConfig,
      importRecords: state.importRecords,
      viewConfig: state.viewConfig,
      tableButtonPermissions: state.tableButtonPermissions,
      cascadeRules: state.cascadeRules,
      tableReferenceMembers: state.tableReferenceMembers,
    })),
  )
  const {
    user,
    currentTenant,
    tenants,
    switchTenant,
    logout,
    role,
    roleKey,
  } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      currentTenant: state.currentTenant,
      tenants: state.tenants,
      switchTenant: state.switchTenant,
      logout: state.logout,
      role: state.role,
      roleKey: state.roleKey,
    })),
  )

  const isViewManageRoute = location.pathname.includes('/config/views')
  const isComponentsRoute = location.pathname.includes('/config/components')
  const isMembersRoute = location.pathname.includes('/config/members')
  const isDashboardConfigRoute = location.pathname.includes('/config/dashboard')
  const isAiModelsRoute = location.pathname.includes('/config/ai-models')
  const isFormSetupRoute = location.pathname.includes('/form-setup')
  const isFormRoute = location.pathname.endsWith('/form')
  const isConfigLikeRoute =
    isViewManageRoute || isComponentsRoute || isMembersRoute || isDashboardConfigRoute || isAiModelsRoute || isFormSetupRoute
  const showGridToolbar = !isConfigLikeRoute && !isFormRoute
  const canViewBusinessConfig = role === 'owner' || roleKey === 'admin'
  const [menuViews, setMenuViews] = useState<View[]>([])
  const tableViewsFromStore = useMemo(
    () => views.filter((view) => view.tableId === tableId),
    [tableId, views],
  )
  useEffect(() => {
    if (tableViewsFromStore.length > 0) {
      setMenuViews(tableViewsFromStore)
      return
    }
    let active = true
    void (async () => {
      try {
        const fetched = await gridApiClient.getViews(tableId)
        if (!active) return
        setMenuViews(fetched.filter((view) => view.tableId === tableId))
      } catch {
        if (!active) return
        setMenuViews([])
      }
    })()
    return () => {
      active = false
    }
  }, [tableId, tableViewsFromStore])
  const menuViewSource = tableViewsFromStore.length > 0 ? tableViewsFromStore : menuViews
  const visibleViews = useMemo(
    () =>
      menuViewSource
        .filter((view) => view.tableId === tableId && view.config.isEnabled !== false)
        .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0)),
    [menuViewSource, tableId]
  )
  const currentView = useMemo(
    () => menuViewSource.find((view) => view.id === viewId) ?? views.find((view) => view.id === viewId) ?? null,
    [menuViewSource, viewId, views],
  )
  const navigateToView = useCallback(
    (targetView: View, replace = false) => {
      navigate(buildViewPath(baseId, tableId, targetView), { replace })
    },
    [baseId, navigate, tableId],
  )

  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [isCreateRecordOpen, setIsCreateRecordOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [fieldDisplayOpen, setFieldDisplayOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const appliedShareQueryRef = useRef(false)
  const sortedPresets = useMemo(() => {
    const presets = viewConfig.filterPresets ?? []
    return [...presets].sort((a, b) => {
      const ap = a.pinned ? 1 : 0
      const bp = b.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [viewConfig.filterPresets])
  
  const canCreateRecord = tableButtonPermissions.canCreateRecord
  const canDeleteRecord = tableButtonPermissions.canDeleteRecord
  const canImportRecords = tableButtonPermissions.canImportRecords
  const canExportRecords = tableButtonPermissions.canExportRecords
  const canManageFilters = tableButtonPermissions.canManageFilters
  const canManageSorts = tableButtonPermissions.canManageSorts
  const hasSelectedRecords = selectedRecordIds.length > 0 || isAllRecordsSelected
  const hasFilterSummary = viewConfig.filters.length > 0
  const hasSortSummary = viewConfig.sorts.length > 0
  const canDeleteSelectionNow = canDeleteRecord && hasSelectedRecords
  const deleteButtonLabel = isAllRecordsSelected ? `删除本页（${pageRecordCount}）` : `删除已选（${selectedRecordIds.length}）`
  const orderedFields = useMemo(() => {
    const fieldOrderIds = viewConfig.fieldOrderIds ?? fields.map((field) => field.id)
    const indexMap = new Map(fieldOrderIds.map((id, index) => [id, index]))
    return [...fields].sort((a, b) => {
      const ai = indexMap.get(a.id)
      const bi = indexMap.get(b.id)
      const ao = ai === undefined ? Number.MAX_SAFE_INTEGER : ai
      const bo = bi === undefined ? Number.MAX_SAFE_INTEGER : bi
      return ao - bo
    })
  }, [fields, viewConfig.fieldOrderIds])
  const hiddenFieldSet = useMemo(() => new Set(viewConfig.hiddenFieldIds ?? []), [viewConfig.hiddenFieldIds])
  const visibleFieldCount = useMemo(
    () => orderedFields.filter((field) => !hiddenFieldSet.has(field.id)).length,
    [hiddenFieldSet, orderedFields],
  )
  const currentTableName = useMemo(
    () => tableItems.find((item) => item.id === tableId)?.name ?? '项目任务',
    [tableId],
  )
  const breadcrumbText = `数据表 / ${currentTableName} / ${currentView?.name ?? '未命名视图'}`

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = (viewConfig.filterPresets ?? []).find((item) => item.id === presetId)
    if (!preset) {
      return
    }
    updateViewConfig({
      filters: preset.filters,
      sorts: preset.sorts,
      filterLogic: preset.filterLogic,
    })
  }

  const toggleFieldVisibility = (fieldId: string, visible: boolean) => {
    const hidden = new Set(viewConfig.hiddenFieldIds ?? [])
    if (visible) {
      hidden.delete(fieldId)
    } else {
      if (visibleFieldCount <= 1 && !hidden.has(fieldId)) {
        message.warning('至少保留一个字段可见。')
        return
      }
      hidden.add(fieldId)
    }
    const nextHidden = orderedFields.filter((field) => hidden.has(field.id)).map((field) => field.id)
    updateViewConfig({ hiddenFieldIds: nextHidden })
  }

  const handleExport = async () => {
    if (isExporting) return
    const confirmed = await confirmAction({
      title: '确认导出当前数据？',
      content: '将按当前可见字段与记录导出 Excel 文件。',
      okText: '确认导出',
    })
    if (!confirmed) return
    setIsExporting(true)
    try {
      const records = useGridStore.getState().records
      const formSettings = viewConfig.formSettings || {}
      const visibleFieldIds = formSettings.visibleFieldIds
      const fieldsToExport = visibleFieldIds ? fields.filter((f) => visibleFieldIds.includes(f.id)) : fields

      const data = records.map((record) => {
        const row: Record<string, unknown> = { ID: record.id }
        fieldsToExport.forEach((field) => {
          const label = formSettings.fieldConfig?.[field.id]?.label || field.name
          row[label] = record.values[field.id]
        })
        return row
      })

      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Records')
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      saveAs(blob, `export_${tableId}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally {
      window.setTimeout(() => setIsExporting(false), 180)
    }
  }

  const handleImportClick = async () => {
    if (isImporting) return
    const confirmed = await confirmAction({
      title: '确认导入记录？',
      content: '请选择 Excel 文件继续导入。',
      okText: '继续导入',
    })
    if (!confirmed) return
    fileInputRef.current?.click()
  }

  const handleDeleteSelection = async () => {
    const currentRecords = useGridStore.getState().records
    const targetIds = isAllRecordsSelected ? currentRecords.map((item) => item.id) : selectedRecordIds
    const sample = targetIds.slice(0, 3).join(', ')
    const suffix = targetIds.length > 3 ? ' ...' : ''
    const confirmed = await confirmAction({
      title: isAllRecordsSelected ? '确认删除本页数据？' : '确认删除本页已勾选数据？',
      content: `将删除本页 ${targetIds.length} 条记录。样本ID: ${sample}${suffix}`,
      okText: '确认删除',
      danger: true,
    })
    if (!confirmed) return
    await deleteSelectedRecords()
  }

  const handleClearFilters = async () => {
    if (viewConfig.filters.length === 0) return
    const confirmed = await confirmAction({
      title: '确认清空当前筛选条件？',
      content: '清空后将展示当前视图全部记录。',
      okText: '确认清空',
      danger: true,
    })
    if (!confirmed) return
    updateViewConfig({ filters: [], filterLogic: 'and' })
    setSelectedPresetId('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsImporting(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[]
        const formSettings = viewConfig.formSettings || {}
        const mappedData = data.map((row) => {
          const values: Record<string, unknown> = {}
          Object.keys(row).forEach((key) => {
            const field = fields.find((f) => {
              const customLabel = formSettings.fieldConfig?.[f.id]?.label
              return f.id === key || f.name === key || customLabel === key
            })
            if (field) values[field.id] = row[key]
          })
          return values
        })
        await importRecords(tableId, mappedData)
      } catch {
        message.error('导入失败，请检查文件格式。')
      } finally {
        setIsImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.onerror = () => {
      setIsImporting(false)
      message.error('读取导入文件失败。')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.readAsBinaryString(file)
  }

  useEffect(() => {
    const routeView = views.find((view) => view.id === viewId)
    if (!routeView || routeView.type !== 'form') {
      return
    }
    const viewBasePath = `/b/${baseId}/t/${tableId}/v/${viewId}`
    const isBareViewPath = location.pathname === viewBasePath || location.pathname === `${viewBasePath}/`
    if (!isBareViewPath) {
      return
    }
    navigateToView(routeView, true)
  }, [baseId, location.pathname, navigateToView, tableId, viewId, views])

  useEffect(() => {
    if (appliedShareQueryRef.current) return
    const params = new URLSearchParams(location.search)
    const q = params.get('q')
    if (!q) return
    try {
      const parsed = JSON.parse(decodeURIComponent(q)) as Partial<ShareQuery>
      const logic = parsed.filterLogic === 'or' ? 'or' : 'and'
      updateViewConfig({
        filterLogic: logic,
        filters: Array.isArray(parsed.filters) ? parsed.filters : [],
        sorts: Array.isArray(parsed.sorts) ? parsed.sorts : [],
      })
      appliedShareQueryRef.current = true
    } catch {
      // ignore malformed share query
      appliedShareQueryRef.current = true
    }
  }, [location.search, updateViewConfig])

  const openView = useCallback(
    (targetViewId: string) => {
      const target = visibleViews.find((view) => view.id === targetViewId)
      if (!target) return
      navigateToView(target)
    },
    [navigateToView, visibleViews],
  )

  useEffect(() => {
    if (visibleViews.length === 0) return
    if (visibleViews.some((item) => item.id === viewId)) return
    openView(visibleViews[0].id)
  }, [openView, viewId, visibleViews])

  const tableMenuItems: MenuProps['items'] = tableItems.map((item) => ({
    key: `table:${item.id}`,
    icon: <TableOutlined />,
    label: item.name,
  }))

  const viewMenuItems: MenuProps['items'] =
    visibleViews.length > 0
      ? visibleViews.map((view) => ({
          key: `view:${view.id}`,
          icon: view.type === 'form' ? <FormOutlined /> : <BarsOutlined />,
          label: view.name,
        }))
      : [{ key: 'view:empty', disabled: true, label: '暂无可用视图' }]

  const configMenuItems: MenuProps['items'] = canViewBusinessConfig
    ? [
        { key: 'config:views', icon: <SettingOutlined />, label: '视图管理' },
        { key: 'config:components', icon: <AppstoreOutlined />, label: '表格组件' },
        { key: 'config:dashboard', icon: <FundProjectionScreenOutlined />, label: '首页大屏' },
        { key: 'config:ai-models', icon: <SettingOutlined />, label: '模型管理' },
        ...(role === 'owner' ? [{ key: 'config:members', icon: <TeamOutlined />, label: '成员管理' }] : []),
      ]
    : []
  const openConfigRoute = useCallback(
    (key: string) => {
      const suffix = configRouteMap[key]
      if (!suffix) return
      navigate(`/b/${baseId}/t/${tableId}/v/${viewId}/${suffix}`)
    },
    [baseId, navigate, tableId, viewId],
  )

  useEffect(() => {
    if (canViewBusinessConfig) return
    if (!isViewManageRoute && !isComponentsRoute && !isMembersRoute && !isDashboardConfigRoute && !isAiModelsRoute) return
    navigate(`/b/${baseId}/t/${tableId}/v/${viewId}`, { replace: true })
  }, [baseId, canViewBusinessConfig, isAiModelsRoute, isComponentsRoute, isDashboardConfigRoute, isMembersRoute, isViewManageRoute, navigate, tableId, viewId])

  const fieldDisplayPanel = (
    <div style={{ width: 260, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>字段显示</strong>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {visibleFieldCount}/{orderedFields.length}
        </span>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 6 }}>
        {orderedFields.map((field) => (
          <Checkbox
            key={field.id}
            checked={!hiddenFieldSet.has(field.id)}
            onChange={(event) => toggleFieldVisibility(field.id, event.target.checked)}
          >
            {field.name}
          </Checkbox>
        ))}
      </div>
      <Button
        size="small"
        onClick={() => {
          updateViewConfig({ hiddenFieldIds: [] })
        }}
        disabled={visibleFieldCount === orderedFields.length}
      >
        显示全部字段
      </Button>
    </div>
  )

  return (
    <div className="app-shell">
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
      />
      <Layout style={{ height: '100vh', background: 'var(--bg-app)' }}>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid var(--border-color)',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Space>
            <Typography.Title level={5} style={{ margin: 0 }}>
              我的多维表格
            </Typography.Title>
            <Typography.Text type="secondary">/ {currentTenant?.name ?? '工作区'}</Typography.Text>
          </Space>
          <Space>
            <Input.Search placeholder="搜索（开发中）" style={{ width: 240 }} />
            <Button icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/dashboard')}>
              大屏
            </Button>
            <Select
              style={{ width: 180 }}
              value={currentTenant?.id}
              placeholder="选择租户"
              options={tenants.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(nextTenantId) => {
                void (async () => {
                  await switchTenant(nextTenantId)
                  navigate('/b/base_1/t/tbl_1/v/viw_1')
                })()
              }}
            />
            <Typography.Text type="secondary">{user?.username ?? '未登录'}</Typography.Text>
            <Avatar size="small">{(user?.username ?? 'U').slice(0, 1).toUpperCase()}</Avatar>
            <Button onClick={() => void logout()}>退出</Button>
          </Space>
        </Header>

        <Layout>
          <Sider width={252} theme="light" style={{ borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
            <div style={{ padding: 12 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                数据表
              </Typography.Text>
              <Menu
                mode="inline"
                selectedKeys={[`table:${tableId}`]}
                items={tableMenuItems}
                onClick={({ key }) => {
                  const id = String(key).replace('table:', '')
                  const targetViews = menuViewSource
                    .filter((item) => item.tableId === id && item.config.isEnabled !== false)
                    .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0))
                  const target = targetViews.find((item) => item.id === viewId) ?? targetViews[0]
                  if (!target) {
                    navigate(`/b/${baseId}/t/${id}/v/viw_1`)
                    return
                  }
                  navigate(buildViewPath(baseId, id, target))
                }}
              />
            </div>

            <div style={{ padding: 12, paddingTop: 0 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                视图
              </Typography.Text>
              <Menu
                mode="inline"
                selectedKeys={[`view:${viewId}`]}
                items={viewMenuItems}
                onClick={({ key }) => openView(String(key).replace('view:', ''))}
              />
            </div>

            {canViewBusinessConfig ? (
              <div style={{ padding: 12, paddingTop: 0 }}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                  业务配置
                </Typography.Text>
                <Menu
                  mode="inline"
                  selectedKeys={[isViewManageRoute ? 'config:views' : isComponentsRoute ? 'config:components' : isDashboardConfigRoute ? 'config:dashboard' : isAiModelsRoute ? 'config:ai-models' : isMembersRoute ? 'config:members' : '']}
                  items={configMenuItems}
                  onClick={({ key }) => openConfigRoute(String(key))}
                />
              </div>
            ) : null}
          </Sider>

          <Content style={{ padding: 0, overflow: 'hidden', display: 'flex' }}>
            <div className="main-panel" style={{ height: '100%', padding: isConfigLikeRoute ? 16 : 20 }}>
          {showGridToolbar ? (
            <div className="view-meta-top-left">
              <div className="view-breadcrumb">{breadcrumbText}</div>
              <span className="record-count">{totalRecords} 条记录</span>
            </div>
          ) : null}
          {showGridToolbar ? (
            <div className="view-toolbar">
              <div className="toolbar-actions toolbar-actions-left">
                  {canManageFilters ? <Button icon={<FilterOutlined />} onClick={() => setIsFilterOpen(true)}>筛选</Button> : null}
                  {canManageSorts ? <Button icon={<SortAscendingOutlined />} onClick={() => setIsSortOpen(true)}>排序</Button> : null}
                  <Popover
                    trigger="click"
                    placement="bottomLeft"
                    open={fieldDisplayOpen}
                    onOpenChange={(open) => setFieldDisplayOpen(open)}
                    content={fieldDisplayPanel}
                  >
                    <Button icon={<EyeOutlined />}>字段显示</Button>
                  </Popover>
                  {canCreateRecord ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateRecordOpen(true)}>新增记录</Button> : null}
                  {canDeleteSelectionNow ? (
                    <Button
                      className="toolbar-delete-btn"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => void handleDeleteSelection()}
                    >
                      {deleteButtonLabel}
                    </Button>
                  ) : null}
                  {canManageFilters && (sortedPresets.length ?? 0) > 0 ? (
                    <Select
                      value={selectedPresetId || undefined}
                      placeholder="选择筛选方案"
                      onChange={(value) => applyPreset(value)}
                      style={{ minWidth: 190 }}
                      options={sortedPresets.map((preset) => ({
                        label: `${preset.pinned ? '★ ' : ''}${preset.name}`,
                        value: preset.id,
                      }))}
                    />
                  ) : null}
                  {canManageFilters && viewConfig.filters.length > 0 ? (
                    <Button onClick={() => void handleClearFilters()}>清空筛选</Button>
                  ) : null}
                  {hasSelectedRecords ? (
                    <div className="toolbar-selection-chip">
                      <span>
                        {isAllRecordsSelected
                          ? `已选择本页全部 ${pageRecordCount}/${pageRecordCount}`
                          : `已选择 ${selectedRecordIds.length}/${pageRecordCount}`}
                      </span>
                      {!isAllRecordsSelected && selectedRecordIds.length > 0 && selectedRecordIds.length < pageRecordCount ? (
                        <Button
                          type="link"
                          size="small"
                          onClick={selectAllRecords}
                          style={{ paddingInline: 6 }}
                        >
                          选择本页全部
                        </Button>
                      ) : null}
                      <Button size="small" onClick={clearSelectedRecords}>取消</Button>
                    </div>
                  ) : null}
                </div>
              <div className="toolbar-actions toolbar-actions-end">
                {canExportRecords ? (
                  <Button icon={<DownloadOutlined />} onClick={() => void handleExport()} loading={isExporting} disabled={isImporting}>
                    导出
                  </Button>
                ) : null}
                {canImportRecords ? (
                  <Button icon={<ImportOutlined />} onClick={() => void handleImportClick()} loading={isImporting} disabled={isExporting}>
                    导入
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {showGridToolbar && (hasFilterSummary || hasSortSummary) ? (
            <div className="toolbar-status-slot">
              <div className="filter-bar">
                <Space>
                  {hasFilterSummary ? (
                    <>
                      <Tag color="blue">筛选</Tag>
                      当前筛选：{viewConfig.filters.length} 条规则（{(viewConfig.filterLogic ?? 'and').toUpperCase()}）
                    </>
                  ) : null}
                  {hasSortSummary ? (
                    <>
                      <Tag color="purple">排序</Tag>
                      当前排序：{viewConfig.sorts.length} 条规则
                    </>
                  ) : null}
                </Space>
              </div>
            </div>
          ) : null}
          <Outlet />
            </div>
          </Content>
        </Layout>
      </Layout>

      <FilterModal
        open={isFilterOpen}
        onCancel={() => setIsFilterOpen(false)}
        fields={fields}
        viewConfig={viewConfig}
        onUpdateViewConfig={updateViewConfig}
      />

      <SortModal
        open={isSortOpen}
        onCancel={() => setIsSortOpen(false)}
        fields={fields}
        viewConfig={viewConfig}
        onUpdateViewConfig={updateViewConfig}
      />

      <CreateRecordModal
        open={isCreateRecordOpen}
        onCancel={() => setIsCreateRecordOpen(false)}
        tableId={tableId}
        fields={fields}
        viewConfig={viewConfig}
        cascadeRules={cascadeRules}
        tableReferenceMembers={tableReferenceMembers}
        onCreateRecord={createRecord}
      />

      {toast ? <div className="grid-toast">{toast}</div> : null}
    </div>
  )
}
