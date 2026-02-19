import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Button, Checkbox, Dropdown, Input, Modal, Select, Space, Switch, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import { MoreOutlined, SettingOutlined } from '@ant-design/icons'
import { useGridStore } from '../store/gridStore'
import type { Field, TableButtonPermissionItem, TableButtonPermissions, View } from '../types/grid'
import { gridApiClient } from '../api'
import { buildViewPath } from '../utils/viewRouting'
import { confirmAction } from '../../../utils/confirmAction'

const getOrderedFields = (view: View | undefined, tableFields: Field[]) => {
  if (!view) return tableFields
  const fieldOrderIds = view.config.fieldOrderIds ?? tableFields.map((field) => field.id)
  const indexMap = new Map(fieldOrderIds.map((id, index) => [id, index]))
  return [...tableFields].sort((a, b) => {
    const ai = indexMap.get(a.id)
    const bi = indexMap.get(b.id)
    const ao = ai === undefined ? Number.MAX_SAFE_INTEGER : ai
    const bo = bi === undefined ? Number.MAX_SAFE_INTEGER : bi
    return ao - bo
  })
}

const defaultTableButtonPermissions: TableButtonPermissions = {
  canCreateRecord: true,
  canDeleteRecord: true,
  canImportRecords: true,
  canExportRecords: true,
  canManageFilters: true,
  canManageSorts: true,
}

const tableButtonPermissionItems: Array<{ key: keyof TableButtonPermissions; label: string }> = [
  { key: 'canCreateRecord', label: '新增记录' },
  { key: 'canDeleteRecord', label: '删除记录' },
  { key: 'canImportRecords', label: '导入记录' },
  { key: 'canExportRecords', label: '导出数据' },
  { key: 'canManageFilters', label: '筛选配置' },
  { key: 'canManageSorts', label: '排序配置' },
]

const serializeButtonPermissionRows = (rows: TableButtonPermissionItem[]) =>
  JSON.stringify(
    [...rows]
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((row) => ({
        userId: row.userId,
        buttons: {
          canCreateRecord: !!row.buttons.canCreateRecord,
          canDeleteRecord: !!row.buttons.canDeleteRecord,
          canImportRecords: !!row.buttons.canImportRecords,
          canExportRecords: !!row.buttons.canExportRecords,
          canManageFilters: !!row.buttons.canManageFilters,
          canManageSorts: !!row.buttons.canManageSorts,
        },
      })),
  )

export function ViewManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  const { baseId = 'base_1', tableId = 'tbl_1', viewId = 'viw_1' } = useParams()

  const views = useGridStore((state) => state.views)
  const fields = useGridStore((state) => state.fields)
  const createView = useGridStore((state) => state.createView)
  const deleteView = useGridStore((state) => state.deleteView)
  const setViewEnabled = useGridStore((state) => state.setViewEnabled)
  const renameView = useGridStore((state) => state.renameView)
  const moveView = useGridStore((state) => state.moveView)
  const removeFieldFromView = useGridStore((state) => state.removeFieldFromView)
  const moveFieldInView = useGridStore((state) => state.moveFieldInView)
  const setFieldOrderInView = useGridStore((state) => state.setFieldOrderInView)

  const [newViewName, setNewViewName] = useState('')
  const [newViewType, setNewViewType] = useState<'grid' | 'form'>('grid')
  const [newFormMode, setNewFormMode] = useState<'setup' | 'quick'>('setup')
  const [isCreateViewOpen, setIsCreateViewOpen] = useState(false)
  const [isCreatingView, setIsCreatingView] = useState(false)
  const [isImportingView, setIsImportingView] = useState(false)
  const [editingViewId, setEditingViewId] = useState<string | null>(null)
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null)
  const [buttonPermissionRows, setButtonPermissionRows] = useState<TableButtonPermissionItem[]>([])
  const [buttonPermissionBaseline, setButtonPermissionBaseline] = useState('[]')
  const [buttonPermissionLoading, setButtonPermissionLoading] = useState(false)
  const [buttonPermissionSaving, setButtonPermissionSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const tableViews = useMemo(
    () =>
      views
        .filter((view) => view.tableId === tableId)
        .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0)),
    [tableId, views]
  )
  const enabledCount = tableViews.filter((view) => view.config.isEnabled !== false).length
  const tableFields = useMemo(() => fields.filter((field) => field.tableId === tableId), [fields, tableId])
  const editView = tableViews.find((item) => item.id === editingViewId) ?? undefined
  const orderedFields = useMemo(() => getOrderedFields(editView, tableFields), [editView, tableFields])
  const hiddenSet = useMemo(() => new Set(editView?.config.hiddenFieldIds ?? []), [editView?.config.hiddenFieldIds])
  const visibleFields = useMemo(() => orderedFields.filter((field) => !hiddenSet.has(field.id)), [hiddenSet, orderedFields])
  const hasCreateViewDraft = newViewName.trim().length > 0 || newViewType !== 'grid' || newFormMode !== 'setup'
  const hasButtonPermissionDraft =
    editView?.type === 'grid' && serializeButtonPermissionRows(buttonPermissionRows) !== buttonPermissionBaseline
  const hasViewSettingDraft = !!hasButtonPermissionDraft

  useEffect(() => {
    if (!editView || editView.type !== 'grid') {
      setButtonPermissionRows([])
      setButtonPermissionBaseline('[]')
      return
    }
    let active = true
    setButtonPermissionLoading(true)
    void (async () => {
      try {
        const rows = await gridApiClient.getTableButtonPermissions(tableId)
        if (!active) return
        setButtonPermissionRows(rows)
        setButtonPermissionBaseline(serializeButtonPermissionRows(rows))
      } catch {
        if (!active) return
        setButtonPermissionRows([])
        setButtonPermissionBaseline('[]')
        message.error('加载表格按钮权限失败。')
      } finally {
        if (!active) return
        setButtonPermissionLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [editView?.id, editView?.type, tableId])

  const promptForText = (title: string, initialValue = '', placeholder = '请输入内容') =>
    new Promise<string | null>((resolve) => {
      let draft = initialValue
      Modal.confirm({
        title,
        content: (
          <Input
            defaultValue={initialValue}
            placeholder={placeholder}
            onChange={(e) => {
              draft = e.target.value
            }}
          />
        ),
        okText: '确定',
        cancelText: '取消',
        onOk: () => {
          const next = draft.trim()
          if (!next) {
            message.warning('内容不能为空。')
            return Promise.reject()
          }
          resolve(next)
        },
        onCancel: () => resolve(null),
      })
    })

  const goToView = (targetView: View) => {
    navigate(buildViewPath(baseId, tableId, targetView))
  }

  const resetCreateViewDraft = () => {
    setNewViewName('')
    setNewViewType('grid')
    setNewFormMode('setup')
  }

  const handleCreate = async () => {
    if (isCreatingView) {
      return
    }
    const name = newViewName.trim()
    if (!name) {
      message.warning('请先输入视图名称。')
      return
    }
    const confirmed = await confirmAction({
      title: `确认创建视图「${name}」？`,
      okText: '确认创建',
    })
    if (!confirmed) return
    setIsCreatingView(true)
    try {
      let created = await createView(tableId, name, newViewType)
      if (!created) return
      if (newViewType === 'form') {
        const visibleFieldIds = newFormMode === 'quick' ? tableFields.map((field) => field.id) : []
        created = await gridApiClient.updateView(created.id, {
          config: {
            ...created.config,
            formSettings: {
              visibleFieldIds,
              fieldConfig: {},
              cascadeRules: [],
            },
          },
        })
        navigate(`/b/${baseId}/t/${tableId}/v/${created.id}/form-setup`)
      } else {
        navigate(`/b/${baseId}/t/${tableId}/v/${created.id}/config/components`)
      }
      resetCreateViewDraft()
      setIsCreateViewOpen(false)
    } finally {
      setIsCreatingView(false)
    }
  }

  const closeCreateViewModal = async () => {
    if (isCreatingView) return
    if (!hasCreateViewDraft) {
      setIsCreateViewOpen(false)
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的视图创建信息？',
      content: '关闭后当前视图名称与类型选择将丢失。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    resetCreateViewDraft()
    setIsCreateViewOpen(false)
  }

  const handleDelete = async (targetId: string, name: string) => {
    Modal.confirm({
      title: `确认删除视图「${name}」吗？`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const nextViewId = await deleteView(targetId)
        if (!nextViewId) return
        const next = tableViews.find((v) => v.id === nextViewId)
        const isConfigViewsRoute = location.pathname.endsWith('/config/views')
        if (!next) {
          navigate(`/b/${baseId}/t/${tableId}/v/${nextViewId}${isConfigViewsRoute ? '/config/views' : ''}`)
          return
        }
        if (isConfigViewsRoute) {
          navigate(`/b/${baseId}/t/${tableId}/v/${next.id}/config/views`)
          return
        }
        goToView(next)
      },
    })
  }

  const handleRename = async (targetId: string, currentName: string) => {
    const nextName = await promptForText('请输入新的视图名称', currentName, '视图名称')
    if (!nextName) return
    await renameView(targetId, nextName)
  }

  const handleToggleEnabled = async (targetId: string, enabled: boolean) => {
    const target = tableViews.find((view) => view.id === targetId)
    if (!target) return
    if (!enabled && target.config.isEnabled !== false && enabledCount <= 1) {
      message.warning('至少保留一个启用中的视图。')
      return
    }
    const updated = await setViewEnabled(targetId, enabled)
    if (!updated) return
    if (viewId === targetId && !enabled) {
      const available = tableViews.find((view) => view.id !== targetId && view.config.isEnabled !== false)
      if (available) {
        goToView(available)
      }
    }
  }

  const handlePinViewToTop = async (targetId: string) => {
    const index = tableViews.findIndex((item) => item.id === targetId)
    if (index <= 0) {
      return
    }
    for (let step = 0; step < index; step += 1) {
      const moved = await moveView(targetId, 'up')
      if (!moved) {
        break
      }
    }
  }

  const handleDropVisibleField = async (targetFieldId: string) => {
    if (!editView || !draggingFieldId || draggingFieldId === targetFieldId) {
      setDraggingFieldId(null)
      return
    }
    const currentVisibleIds = visibleFields.map((field) => field.id)
    const sourceIndex = currentVisibleIds.findIndex((id) => id === draggingFieldId)
    const targetIndex = currentVisibleIds.findIndex((id) => id === targetFieldId)
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggingFieldId(null)
      return
    }
    const nextVisibleIds = [...currentVisibleIds]
    const [moved] = nextVisibleIds.splice(sourceIndex, 1)
    nextVisibleIds.splice(targetIndex, 0, moved)
    const hiddenIds = orderedFields.filter((field) => hiddenSet.has(field.id)).map((field) => field.id)
    await setFieldOrderInView(editView.id, [...nextVisibleIds, ...hiddenIds])
    setDraggingFieldId(null)
  }

  const handleImportViewClick = async () => {
    if (isImportingView) return
    const confirmed = await confirmAction({
      title: '确认导入视图？',
      content: '将选择 Excel 文件并创建新视图。',
      okText: '继续导入',
    })
    if (!confirmed) return
    importInputRef.current?.click()
  }

  const handleImportViewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsImportingView(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const result = evt.target?.result
        const wb = XLSX.read(result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[]
        if (rows.length === 0) {
          message.error('导入失败：Excel 没有数据行。')
          return
        }
        const headers = Object.keys(rows[0] ?? {}).map((key) => key.trim()).filter(Boolean)
        if (headers.length === 0) {
          message.error('导入失败：未读取到表头。')
          return
        }
        const defaultName = file.name.replace(/\.[^.]+$/, '') || '导入视图'
        const viewName = await promptForText('请输入导入后视图名称', defaultName, '导入视图名称')
        if (!viewName) return

        const resultPayload = rows.map((row) => {
          const values: Record<string, unknown> = {}
          headers.forEach((header) => {
            values[header] = row[header] ?? null
          })
          return values
        })
        const created = await gridApiClient.importViewBundle(tableId, {
          viewName,
          viewType: 'grid',
          fields: headers.map((header) => ({ name: header, type: 'text', width: 180 })),
          records: resultPayload,
        })
        navigate(`/b/${baseId}/t/${tableId}/v/${created.viewId}`)
      } catch {
        message.error('导入视图失败，请检查文件格式。')
      } finally {
        setIsImportingView(false)
        if (importInputRef.current) {
          importInputRef.current.value = ''
        }
      }
    }
    reader.onerror = () => {
      setIsImportingView(false)
      message.error('读取导入文件失败。')
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
    reader.readAsBinaryString(file)
  }

  const handleToggleButtonPermission = (
    userId: string,
    key: keyof TableButtonPermissions,
    checked: boolean,
  ) => {
    setButtonPermissionRows((prev) =>
      prev.map((row) =>
        row.userId === userId
          ? {
              ...row,
              buttons: {
                ...row.buttons,
                [key]: checked,
              },
            }
          : row,
      ),
    )
  }

  const resetTableViewButtonsToDefault = async () => {
    if (buttonPermissionRows.length === 0) {
      return
    }
    const confirmed = await confirmAction({
      title: '确认恢复默认按钮权限（全开）？',
      content: '未保存的权限勾选将被重置。',
      okText: '确认恢复',
      danger: true,
    })
    if (!confirmed) return
    setButtonPermissionRows((prev) =>
      prev.map((row) => ({
        ...row,
        buttons: { ...defaultTableButtonPermissions },
      })),
    )
  }

  const handleRemoveFieldFromCurrentView = async (field: Field) => {
    if (!editView) return
    const confirmed = await confirmAction({
      title: `确认从视图移除字段「${field.name}」？`,
      content: '仅移出当前视图，不会删除字段本身。',
      okText: '确认移除',
      danger: true,
    })
    if (!confirmed) return
    await removeFieldFromView(editView.id, field.id)
  }

  const saveTableViewButtons = async () => {
    if (buttonPermissionRows.length === 0) {
      return
    }
    const confirmed = await confirmAction({
      title: '确认保存当前按钮权限配置？',
      okText: '确认保存',
    })
    if (!confirmed) return
    setButtonPermissionSaving(true)
    try {
      const updated = await gridApiClient.updateTableButtonPermissions(
        tableId,
        buttonPermissionRows.map((row) => ({ userId: row.userId, buttons: row.buttons })),
      )
      setButtonPermissionRows(updated)
      setButtonPermissionBaseline(serializeButtonPermissionRows(updated))
      message.success('表格视图按钮权限已保存。')
    } catch {
      message.error('保存表格视图按钮权限失败。')
    } finally {
      setButtonPermissionSaving(false)
    }
  }
  const closeFieldConfigModal = async () => {
    if (buttonPermissionSaving) return
    if (hasViewSettingDraft) {
      const confirmed = await confirmAction({
        title: '放弃未保存的视图设置更改？',
        content: '关闭后当前按钮权限草稿将丢失。',
        okText: '放弃并关闭',
        danger: true,
      })
      if (!confirmed) return
    }
    setEditingViewId(null)
    setDraggingFieldId(null)
  }

  return (
    <div className="grid-root" style={{ padding: 16, overflowY: 'auto' }}>
      <input
        type="file"
        ref={importInputRef}
        style={{ display: 'none' }}
        accept=".xlsx,.xls,.csv"
        onChange={handleImportViewFileChange}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>业务配置 / 视图管理</Typography.Title>
          <Typography.Text type="secondary">
            在这里统一维护视图：新增、删除、启用/停用。字段结构与组件样式请进入“字段配置”页面处理。
          </Typography.Text>
        </div>
        <Space>
          <Button onClick={() => void handleImportViewClick()} loading={isImportingView} disabled={isCreatingView}>
            导入视图
          </Button>
          <Button
            type="primary"
            onClick={() => {
              setNewViewName('')
              setNewViewType('grid')
              setNewFormMode('setup')
              setIsCreateViewOpen(true)
            }}
          >
            新增视图
          </Button>
        </Space>
      </div>

      <section style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 16 }}>
        <h4 style={{ marginTop: 0, marginBottom: 12 }}>视图列表</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tableViews.map((view, index) => {
            const isCurrent = view.id === viewId
            const isEnabled = view.config.isEnabled !== false
            return (
              <div
                key={view.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: isCurrent ? 'var(--surface-subtle)' : 'white',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {view.name}
                    {isCurrent ? '（当前）' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ID: {view.id} · 类型: {view.type}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Space size={4}>
                    <Switch size="small" checked={isEnabled} onChange={(checked) => void handleToggleEnabled(view.id, checked)} />
                    <span style={{ fontSize: 13 }}>启用</span>
                  </Space>
                  <Button onClick={() => goToView(view)}>打开</Button>
                  <Button
                    icon={<SettingOutlined />}
                    onClick={() =>
                      navigate(
                        view.type === 'form'
                          ? `/b/${baseId}/t/${tableId}/v/${view.id}/form-setup`
                          : `/b/${baseId}/t/${tableId}/v/${view.id}/config/components`,
                      )
                    }
                    style={{ color: 'var(--primary)', borderColor: '#bfdbfe', background: '#eff6ff' }}
                  >
                    字段配置
                  </Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'viewSettings', label: '视图设置' },
                        { key: 'rename', label: '重命名' },
                        { key: 'pinTop', label: '置顶', disabled: index === 0 },
                        { key: 'moveUp', label: '上移', disabled: index === 0 },
                        { key: 'moveDown', label: '下移', disabled: index === tableViews.length - 1 },
                      ] satisfies MenuProps['items'],
                      onClick: ({ key }) => {
                        if (key === 'viewSettings') {
                          setEditingViewId(view.id)
                          return
                        }
                        if (key === 'rename') {
                          void handleRename(view.id, view.name)
                          return
                        }
                        if (key === 'pinTop') {
                          void handlePinViewToTop(view.id)
                          return
                        }
                        if (key === 'moveUp') {
                          void moveView(view.id, 'up')
                          return
                        }
                        if (key === 'moveDown') {
                          void moveView(view.id, 'down')
                        }
                      },
                    }}
                  >
                    <Button icon={<MoreOutlined />} />
                  </Dropdown>
                  <Button danger onClick={() => void handleDelete(view.id, view.name)}>删除</Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <Modal
        open={isCreateViewOpen}
        title="新增视图"
        onCancel={() => void closeCreateViewModal()}
        onOk={() => void handleCreate()}
        confirmLoading={isCreatingView}
        okButtonProps={{ disabled: isImportingView }}
        cancelButtonProps={{ disabled: isCreatingView }}
        okText="保存"
        cancelText="取消"
      >
        <div className="form-group">
          <label className="form-label">视图名称</label>
          <Input
            placeholder="输入视图名称"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">视图类型</label>
          <Select
            value={newViewType}
            onChange={(value) => setNewViewType(value as 'grid' | 'form')}
            options={[
              { value: 'grid', label: '表格视图' },
              { value: 'form', label: '表单视图' },
            ]}
          />
        </div>
        {newViewType === 'form' ? (
          <div className="form-group">
            <label className="form-label">创建方式</label>
            <Select
              value={newFormMode}
              onChange={(value) => setNewFormMode(value as 'setup' | 'quick')}
              options={[
                { value: 'setup', label: '空白设计（推荐）' },
                { value: 'quick', label: '快速生成（默认展示全部字段，进入表单设计）' },
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!editView}
        title={editView ? `视图设置 · ${editView.name}` : '视图设置'}
        onCancel={() => void closeFieldConfigModal()}
        width={1080}
        destroyOnClose
        maskClosable={!buttonPermissionSaving}
        footer={
          <Space>
            <Button onClick={() => void closeFieldConfigModal()} disabled={buttonPermissionSaving}>关闭</Button>
          </Space>
        }
      >
        {editView ? (
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              当前页面仅维护该视图的显示顺序与按钮权限。字段类型与组件样式已统一到“表格组件”页面。
            </div>

            <div
              style={{
                border: '1px solid #bfdbfe',
                borderRadius: 8,
                padding: 12,
                background: '#eff6ff',
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <Typography.Text style={{ color: '#1e3a8a' }}>
                {editView.type === 'form'
                  ? '需要调整表单字段显示、顺序、必填与提示，请前往“表单设计”。'
                  : '需要新增字段、修改字段类型、配置下拉/成员等组件时，请前往“表格组件”。'}
              </Typography.Text>
              <Button
                type="primary"
                onClick={() => {
                  navigate(
                    editView.type === 'form'
                      ? `/b/${baseId}/t/${tableId}/v/${editView.id}/form-setup`
                      : `/b/${baseId}/t/${tableId}/v/${editView.id}/config/components`,
                  )
                  setEditingViewId(null)
                }}
              >
                {editView.type === 'form' ? '前往表单设计' : '前往表格组件'}
              </Button>
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>当前显示字段（支持排序）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {visibleFields.map((field, index) => (
                  <div
                    key={field.id}
                    draggable
                    onDragStart={() => setDraggingFieldId(field.id)}
                    onDragEnd={() => setDraggingFieldId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => void handleDropVisibleField(field.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      cursor: 'grab',
                      background: draggingFieldId === field.id ? 'var(--surface-subtle)' : 'white',
                    }}
                  >
                    <span>{field.name}</span>
                    <Button onClick={() => void moveFieldInView(editView.id, field.id, 'up')} disabled={index === 0}>
                      上移
                    </Button>
                    <Button onClick={() => void moveFieldInView(editView.id, field.id, 'down')} disabled={index === visibleFields.length - 1}>
                      下移
                    </Button>
                    <Button onClick={() => void handleRemoveFieldFromCurrentView(field)}>移除</Button>
                  </div>
                ))}
                {visibleFields.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>当前无显示字段。</div> : null}
              </div>
            </div>

            {editView.type === 'grid' ? (
              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>表格视图按钮权限</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      仅控制表格视图入口，默认全开。
                    </div>
                  </div>
                  <Space>
                    <Button
                      size="small"
                      onClick={() => void resetTableViewButtonsToDefault()}
                      disabled={buttonPermissionLoading || buttonPermissionRows.length === 0}
                    >
                      恢复全开
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      loading={buttonPermissionSaving}
                      onClick={() => void saveTableViewButtons()}
                      disabled={buttonPermissionLoading || buttonPermissionRows.length === 0}
                    >
                      保存权限
                    </Button>
                  </Space>
                </div>

                {buttonPermissionLoading ? (
                  <Typography.Text type="secondary">正在加载按钮权限...</Typography.Text>
                ) : buttonPermissionRows.length === 0 ? (
                  <Typography.Text type="secondary">当前没有可配置的成员权限。</Typography.Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {buttonPermissionRows.map((row) => (
                      <div
                        key={row.userId}
                        style={{
                          border: '1px solid var(--border-color)',
                          borderRadius: 8,
                          padding: 10,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                        }}
                      >
                        <div style={{ minWidth: 120, fontWeight: 500, paddingTop: 2 }}>{row.username}</div>
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: 8 }}>
                          {tableButtonPermissionItems.map((item) => (
                            <Checkbox
                              key={item.key}
                              checked={row.buttons[item.key]}
                              onChange={(event) =>
                                handleToggleButtonPermission(row.userId, item.key, event.target.checked)
                              }
                            >
                              {item.label}
                            </Checkbox>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

    </div>
  )
}
