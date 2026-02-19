import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Drawer, Dropdown, Input, Modal, Select, Space, Tag, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import { DeleteOutlined, EditOutlined, MoreOutlined } from '@ant-design/icons'
import { useGridStore } from '../store/gridStore'
import type { Field, FieldComponentType, FieldOption, FieldType } from '../types/grid'
import { confirmAction } from '../../../utils/confirmAction'

const componentTypeOptions: Array<{ value: FieldComponentType; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'input', label: '文本输入' },
  { value: 'textarea', label: '文本域' },
  { value: 'date', label: '日期选择' },
  { value: 'select', label: '下拉选择' },
  { value: 'member', label: '成员选择' },
  { value: 'cascader', label: '级联下拉' },
  { value: 'upload', label: '附件上传' },
  { value: 'image', label: '图片上传' },
]

const componentOptionsByFieldType: Partial<Record<string, FieldComponentType[]>> = {
  text: ['default', 'input', 'textarea', 'date', 'select', 'member', 'cascader'],
  number: ['default', 'input'],
  date: ['default', 'date', 'input'],
  singleSelect: ['default', 'select', 'member', 'cascader'],
  multiSelect: ['default', 'textarea'],
  checkbox: ['default'],
  attachment: ['default', 'upload'],
  image: ['default', 'image', 'upload'],
  member: ['default', 'member'],
}

const fieldTypeOptions: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'singleSelect', label: '单选' },
  { value: 'multiSelect', label: '多选' },
  { value: 'member', label: '成员' },
  { value: 'checkbox', label: '复选框' },
  { value: 'attachment', label: '附件' },
  { value: 'image', label: '图片' },
]

const colorPresets: Array<{ label: string; value: string }> = [
  { label: '红色', value: '#ef4444' },
  { label: '橙色', value: '#f97316' },
  { label: '琥珀', value: '#f59e0b' },
  { label: '黄色', value: '#eab308' },
  { label: '绿色', value: '#22c55e' },
  { label: '青色', value: '#06b6d4' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '紫色', value: '#8b5cf6' },
  { label: '粉色', value: '#ec4899' },
  { label: '灰色', value: '#64748b' },
]

const toOptionRows = (options?: FieldOption[]) =>
  (options ?? []).map((item) => ({ name: item.name, color: item.color ?? '' }))

const toFieldOptions = (rows: Array<{ name: string; color: string }>): FieldOption[] =>
  rows
    .map((row) => ({ name: row.name.trim(), color: row.color.trim() }))
    .filter((row) => row.name.length > 0)
    .map((row) => ({ id: row.name, name: row.name, color: row.color || undefined }))

const parseMappings = (raw: string): Record<string, string[]> => {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const mappings: Record<string, string[]> = {}
  for (const line of lines) {
    const [parentRaw, childrenRaw = ''] = line.split(':')
    const parent = parentRaw?.trim()
    if (!parent) continue
    const children = childrenRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    mappings[parent] = children
  }
  return mappings
}

const stringifyMappings = (mappings: Record<string, string[]>) =>
  Object.entries(mappings)
    .map(([parent, children]) => `${parent}: ${children.join(', ')}`)
    .join('\n')

const parseBatchOptionText = (raw: string): Array<{ name: string; color: string }> =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [nameRaw, colorRaw = ''] = line.split(/[，,]/)
      return {
        name: (nameRaw ?? '').trim(),
        color: (colorRaw ?? '').trim(),
      }
    })
    .filter((item) => item.name.length > 0)

const toBatchOptionText = (rows: Array<{ name: string; color: string }>) =>
  rows
    .map((row) => (row.color.trim() ? `${row.name},${row.color}` : row.name))
    .join('\n')

const toComparableComponentConfig = (config?: {
  componentType?: FieldComponentType
  options?: FieldOption[]
  cascader?: { parentFieldId: string; mappings: Record<string, string[]> }
}) => {
  if (!config || config.componentType === 'default') {
    return {
      componentType: 'default' as const,
      options: [] as Array<{ name: string; color: string }>,
      cascader: { parentFieldId: '', mappings: [] as Array<{ parent: string; children: string[] }> },
    }
  }
  const normalizedMappings = Object.entries(config.cascader?.mappings ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([parent, children]) => ({ parent, children: [...children] }))
  return {
    componentType: config.componentType,
    options: (config.options ?? []).map((item) => ({ name: item.name, color: item.color ?? '' })),
    cascader: {
      parentFieldId: config.cascader?.parentFieldId ?? '',
      mappings: normalizedMappings,
    },
  }
}

const toOrderedFields = (fields: Field[], fieldOrderIds?: string[]): Field[] => {
  const allIds = fields.map((field) => field.id)
  const configured = (fieldOrderIds ?? []).filter((id) => allIds.includes(id))
  const mergedIds = [...configured, ...allIds.filter((id) => !configured.includes(id))]
  const fieldMap = new Map(fields.map((field) => [field.id, field]))
  return mergedIds.map((id) => fieldMap.get(id)).filter((field): field is Field => !!field)
}

type FieldListFilter = 'all' | 'configured' | 'removed' | 'visible'

export function TableComponents() {
  const { tableId = 'tbl_1', viewId = 'viw_1' } = useParams()
  const allFields = useGridStore((state) => state.fields)
  const viewConfig = useGridStore((state) => state.viewConfig)
  const updateViewConfig = useGridStore((state) => state.updateViewConfig)
  const activeViewId = useGridStore((state) => state.activeViewId)
  const createFieldForView = useGridStore((state) => state.createFieldForView)
  const addFieldToView = useGridStore((state) => state.addFieldToView)
  const removeFieldFromView = useGridStore((state) => state.removeFieldFromView)
  const tableReferenceMembers = useGridStore((state) => state.tableReferenceMembers)

  const fields = useMemo(
    () => allFields.filter((field) => field.tableId === tableId),
    [allFields, tableId],
  )
  const bindings = useMemo(() => viewConfig.components ?? {}, [viewConfig.components])
  const hiddenFieldSet = useMemo(
    () => new Set(viewConfig.hiddenFieldIds ?? []),
    [viewConfig.hiddenFieldIds],
  )
  const orderedFields = useMemo(
    () => toOrderedFields(fields, viewConfig.fieldOrderIds),
    [fields, viewConfig.fieldOrderIds],
  )

  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [componentType, setComponentType] = useState<FieldComponentType>('default')
  const [optionRows, setOptionRows] = useState<Array<{ name: string; color: string }>>([])
  const [parentFieldId, setParentFieldId] = useState('')
  const [mappingsText, setMappingsText] = useState('')
  const [previewValue, setPreviewValue] = useState('')
  const [previewParentValue, setPreviewParentValue] = useState('')
  const [previewChecked, setPreviewChecked] = useState(false)
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false)
  const [batchEditText, setBatchEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [listFilter, setListFilter] = useState<FieldListFilter>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null)
  const [isGuideCollapsed, setIsGuideCollapsed] = useState(true)
  const [isCreateFieldOpen, setIsCreateFieldOpen] = useState(false)
  const [isCreatingField, setIsCreatingField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState<FieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')

  const selectedField = useMemo(
    () => fields.find((field) => field.id === editingFieldId) ?? null,
    [editingFieldId, fields],
  )
  const selectedConfig = editingFieldId ? bindings[editingFieldId] : undefined
  const baselineComponentSignature = useMemo(
    () => JSON.stringify(toComparableComponentConfig(selectedConfig)),
    [selectedConfig],
  )
  const draftComponentSignature = useMemo(
    () =>
      JSON.stringify(
        toComparableComponentConfig(
          componentType === 'default'
            ? undefined
            : {
                componentType,
                options: componentType === 'select' ? toFieldOptions(optionRows) : undefined,
                cascader:
                  componentType === 'cascader' && parentFieldId
                    ? {
                        parentFieldId,
                        mappings: parseMappings(mappingsText),
                      }
                    : undefined,
              },
        ),
      ),
    [componentType, mappingsText, optionRows, parentFieldId],
  )
  const hasEditorChanges = useMemo(
    () => !!editingFieldId && baselineComponentSignature !== draftComponentSignature,
    [baselineComponentSignature, draftComponentSignature, editingFieldId],
  )
  const initialBatchEditText = useMemo(() => toBatchOptionText(optionRows), [optionRows])
  const hasBatchEditChanges = useMemo(
    () => batchEditText !== initialBatchEditText,
    [batchEditText, initialBatchEditText],
  )
  const configuredCount = useMemo(
    () => orderedFields.filter((field) => !!bindings[field.id]).length,
    [bindings, orderedFields],
  )
  const removedCount = useMemo(
    () => orderedFields.filter((field) => hiddenFieldSet.has(field.id)).length,
    [hiddenFieldSet, orderedFields],
  )
  const visibleCount = useMemo(
    () => orderedFields.filter((field) => !hiddenFieldSet.has(field.id)).length,
    [hiddenFieldSet, orderedFields],
  )
  const normalizedKeyword = searchKeyword.trim().toLowerCase()
  const filteredFields = useMemo(() => {
    const byFilter = orderedFields.filter((field) => {
      if (listFilter === 'configured') return !!bindings[field.id]
      if (listFilter === 'removed') return hiddenFieldSet.has(field.id)
      if (listFilter === 'visible') return !hiddenFieldSet.has(field.id)
      return true
    })
    if (!normalizedKeyword) {
      return byFilter
    }
    return byFilter.filter((field) => {
      const binding = bindings[field.id]
      return (
        field.name.toLowerCase().includes(normalizedKeyword) ||
        field.id.toLowerCase().includes(normalizedKeyword) ||
        field.type.toLowerCase().includes(normalizedKeyword) ||
        (binding?.componentType ?? 'default').toLowerCase().includes(normalizedKeyword)
      )
    })
  }, [bindings, hiddenFieldSet, listFilter, normalizedKeyword, orderedFields])
  const canDragSort = listFilter === 'all' && normalizedKeyword.length === 0
  const filterItems: Array<{ key: FieldListFilter; label: string; count: number }> = [
    { key: 'all', label: '全部', count: orderedFields.length },
    { key: 'configured', label: '已配置', count: configuredCount },
    { key: 'visible', label: '可见字段', count: visibleCount },
    { key: 'removed', label: '已移除', count: removedCount },
  ]
  const currentViewId = activeViewId ?? viewId
  const hasCreateFieldDraft =
    newFieldName.trim().length > 0 ||
    newFieldType !== 'text' ||
    newFieldOptions.trim().length > 0

  const parentCandidates = useMemo(
    () => fields.filter((field) => field.id !== editingFieldId && field.type === 'singleSelect'),
    [editingFieldId, fields],
  )
  const parsedMappings = useMemo(() => parseMappings(mappingsText), [mappingsText])
  const previewParentField = useMemo(
    () => fields.find((field) => field.id === parentFieldId),
    [fields, parentFieldId],
  )

  const componentTypeChoices = useMemo(() => {
    const allowed = componentOptionsByFieldType[selectedField?.type ?? ''] ?? ['default', 'input']
    return componentTypeOptions.filter((item) => allowed.includes(item.value))
  }, [selectedField?.type])

  const previewMode = useMemo(() => {
    if (componentType !== 'default') {
      return componentType
    }
    if (selectedField?.type === 'member') return 'select'
    if (selectedField?.type === 'singleSelect') return 'select'
    if (selectedField?.type === 'date') return 'date'
    if (selectedField?.type === 'checkbox') return 'checkbox'
    if (selectedField?.type === 'attachment') return 'upload'
    if (selectedField?.type === 'image') return 'image'
    if (selectedField?.type === 'multiSelect') return 'textarea'
    return 'input'
  }, [componentType, selectedField?.type])

  const previewParentOptions: FieldOption[] = useMemo(() => {
    if (previewParentField?.options && previewParentField.options.length > 0) {
      return previewParentField.options
    }
    return Object.keys(parsedMappings).map((item) => ({ id: item, name: item }))
  }, [parsedMappings, previewParentField?.options])

  const previewSelectOptions: FieldOption[] = useMemo(() => {
    if (previewMode === 'member') {
      return tableReferenceMembers.map((item) => ({ id: item.userId, name: item.username }))
    }
    if (previewMode === 'select') {
      if (selectedField?.type === 'member') {
        return tableReferenceMembers.map((item) => ({ id: item.userId, name: item.username }))
      }
      if (componentType === 'select') {
        return toFieldOptions(optionRows)
      }
      if (selectedField?.type === 'singleSelect') {
        return selectedField.options ?? []
      }
      return []
    }
    if (previewMode === 'cascader') {
      const children = parsedMappings[previewParentValue] ?? []
      return children.map((name) => ({ id: name, name, parentId: previewParentValue }))
    }
    return []
  }, [
    componentType,
    optionRows,
    parsedMappings,
    previewMode,
    previewParentValue,
    selectedField?.options,
    selectedField?.type,
    tableReferenceMembers,
  ])

  const previewSelectedOption = useMemo(
    () => previewSelectOptions.find((item) => item.id === previewValue),
    [previewSelectOptions, previewValue],
  )

  useEffect(() => {
    if (!editingFieldId) {
      return
    }
    setComponentType(selectedConfig?.componentType ?? 'default')
    setOptionRows(toOptionRows(selectedConfig?.options))
    setParentFieldId(selectedConfig?.cascader?.parentFieldId ?? '')
    setMappingsText(selectedConfig?.cascader ? stringifyMappings(selectedConfig.cascader.mappings) : '')
    setPreviewValue('')
    setPreviewParentValue('')
    setPreviewChecked(false)
  }, [editingFieldId, selectedConfig?.cascader, selectedConfig?.componentType, selectedConfig?.options])

  useEffect(() => {
    const allowed = componentOptionsByFieldType[selectedField?.type ?? ''] ?? ['default', 'input']
    if (!allowed.includes(componentType)) {
      setComponentType('default')
    }
  }, [componentType, selectedField?.type])

  useEffect(() => {
    if (previewMode !== 'cascader') return
    const firstParent = previewParentOptions[0]?.id ?? ''
    if (!previewParentValue || !previewParentOptions.some((item) => item.id === previewParentValue)) {
      setPreviewParentValue(firstParent)
    }
  }, [previewMode, previewParentOptions, previewParentValue])

  useEffect(() => {
    if (previewMode !== 'select' && previewMode !== 'cascader') return
    if (previewValue && !previewSelectOptions.some((item) => item.id === previewValue)) {
      setPreviewValue('')
    }
  }, [previewMode, previewSelectOptions, previewValue])

  const openEditor = (fieldId: string) => {
    setEditingFieldId(fieldId)
  }

  const closeEditor = () => {
    setEditingFieldId(null)
  }

  const handleRequestCloseEditor = async () => {
    if (isSaving || isClearing) return
    if (!hasEditorChanges) {
      closeEditor()
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的字段配置更改？',
      content: '关闭后当前字段配置草稿将丢失。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    closeEditor()
  }

  const clearFieldBinding = (fieldId: string) => {
    const next = { ...bindings }
    delete next[fieldId]
    updateViewConfig({ components: next })
  }

  const handleClearFieldBinding = async (field: Field) => {
    const confirmed = await confirmAction({
      title: `确认删除字段「${field.name}」的组件配置？`,
      content: '删除后将恢复为默认组件。',
      okText: '确认删除',
      danger: true,
    })
    if (!confirmed) return
    clearFieldBinding(field.id)
  }

  const handleSave = async () => {
    if (!editingFieldId || !selectedField) return
    const confirmed = await confirmAction({
      title: `确认保存字段「${selectedField.name}」配置？`,
      okText: '确认保存',
    })
    if (!confirmed) return
    setIsSaving(true)
    const next = { ...bindings }
    if (componentType === 'default') {
      delete next[editingFieldId]
      updateViewConfig({ components: next })
      window.setTimeout(() => setIsSaving(false), 220)
      return
    }
    next[editingFieldId] = {
      componentType,
      options: componentType === 'select' ? toFieldOptions(optionRows) : undefined,
      cascader:
        componentType === 'cascader' && parentFieldId
          ? {
              parentFieldId,
              mappings: parseMappings(mappingsText),
            }
          : undefined,
    }
    updateViewConfig({ components: next })
    window.setTimeout(() => setIsSaving(false), 220)
  }

  const handleClearCurrent = async () => {
    if (!editingFieldId) return
    const confirmed = await confirmAction({
      title: '确认清除当前字段配置？',
      content: '清除后将恢复为默认组件。',
      okText: '确认清除',
      danger: true,
    })
    if (!confirmed) return
    setIsClearing(true)
    clearFieldBinding(editingFieldId)
    window.setTimeout(() => setIsClearing(false), 220)
  }

  const assignColorsForUncoloredOptions = () => {
    const palette = colorPresets.map((item) => item.value)
    if (palette.length === 0) return
    setOptionRows((prev) => {
      const start = Math.floor(Math.random() * palette.length)
      let cursor = 0
      return prev.map((item) => {
        if (item.color.trim() || !item.name.trim()) {
          return item
        }
        const nextColor = palette[(start + cursor) % palette.length]
        cursor += 1
        return { ...item, color: nextColor }
      })
    })
  }

  const openBatchEditor = () => {
    setBatchEditText(toBatchOptionText(optionRows))
    setIsBatchEditOpen(true)
  }

  const applyBatchEditor = () => {
    setOptionRows(parseBatchOptionText(batchEditText))
    setIsBatchEditOpen(false)
  }

  const handleCloseBatchEditor = async () => {
    if (!hasBatchEditChanges) {
      setIsBatchEditOpen(false)
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未应用的批量编辑内容？',
      content: '关闭后本次批量编辑输入不会生效。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    setBatchEditText(initialBatchEditText)
    setIsBatchEditOpen(false)
  }

  const resetCreateFieldDraft = () => {
    setNewFieldName('')
    setNewFieldType('text')
    setNewFieldOptions('')
  }

  const closeCreateFieldModal = async () => {
    if (isCreatingField) return
    if (!hasCreateFieldDraft) {
      setIsCreateFieldOpen(false)
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的字段信息？',
      content: '关闭后当前字段名称与类型输入将丢失。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    resetCreateFieldDraft()
    setIsCreateFieldOpen(false)
  }

  const handleCreateField = async () => {
    if (isCreatingField) return
    const name = newFieldName.trim()
    if (!name) {
      message.warning('请输入字段名称。')
      return
    }
    if (!currentViewId) {
      message.warning('当前视图未加载完成，请稍后重试。')
      return
    }
    const options =
      newFieldType === 'singleSelect' || newFieldType === 'multiSelect'
        ? newFieldOptions
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => ({ id: item, name: item }))
        : undefined
    const confirmed = await confirmAction({
      title: `确认新增字段「${name}」并绑定当前视图？`,
      okText: '确认新增',
    })
    if (!confirmed) return
    setIsCreatingField(true)
    try {
      const created = await createFieldForView(tableId, currentViewId, name, newFieldType, options)
      if (!created) return
      resetCreateFieldDraft()
      setIsCreateFieldOpen(false)
      openEditor(created.id)
    } finally {
      setIsCreatingField(false)
    }
  }

  const toggleFieldVisibilityInCurrentView = async (field: Field) => {
    if (!currentViewId) {
      message.warning('当前视图未加载完成，请稍后重试。')
      return
    }
    const isRemoved = hiddenFieldSet.has(field.id)
    const confirmed = await confirmAction({
      title: isRemoved ? `确认将字段「${field.name}」加入当前视图？` : `确认从当前视图移除字段「${field.name}」？`,
      content: isRemoved ? '字段将恢复显示。' : '仅影响当前视图展示，不会删除字段本身。',
      okText: isRemoved ? '确认加入' : '确认移除',
      danger: !isRemoved,
    })
    if (!confirmed) return
    if (isRemoved) {
      await addFieldToView(currentViewId, field.id)
      return
    }
    await removeFieldFromView(currentViewId, field.id)
  }

  const reorderFieldIds = (sourceFieldId: string, targetFieldId: string) => {
    if (sourceFieldId === targetFieldId) {
      return
    }
    const ids = orderedFields.map((field) => field.id)
    const sourceIndex = ids.indexOf(sourceFieldId)
    const targetIndex = ids.indexOf(targetFieldId)
    if (sourceIndex < 0 || targetIndex < 0) {
      return
    }
    const nextIds = [...ids]
    const [moved] = nextIds.splice(sourceIndex, 1)
    nextIds.splice(targetIndex, 0, moved)
    updateViewConfig({ fieldOrderIds: nextIds })
  }

  const handleDragEnterField = (targetFieldId: string) => {
    if (!draggingFieldId || draggingFieldId === targetFieldId) {
      return
    }
    reorderFieldIds(draggingFieldId, targetFieldId)
    setDraggingFieldId(targetFieldId)
  }

  if (fields.length === 0) {
    return (
      <div className="grid-root" style={{ padding: 24, overflowY: 'auto' }}>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
          业务配置 / 表格组件
        </Typography.Title>
        <Typography.Text type="secondary">当前数据表没有可配置字段。</Typography.Text>
      </div>
    )
  }

  return (
    <div className="grid-root" style={{ padding: 24, overflowY: 'auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
        业务配置 / 表格组件
      </Typography.Title>
      <Typography.Text type="secondary" style={{ marginTop: 0, marginBottom: 16, display: 'inline-block' }}>
        当前视图: {currentViewId ?? '-'}。字段结构（新增/移除）与组件样式（成员/下拉/级联）统一在本页配置。
      </Typography.Text>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isGuideCollapsed ? '220px 1fr' : 'minmax(260px, 320px) 1fr',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <section style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, background: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isGuideCollapsed ? 6 : 8 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              配置说明
            </Typography.Title>
            <Button type="link" size="small" onClick={() => setIsGuideCollapsed((prev) => !prev)} style={{ paddingInline: 0 }}>
              {isGuideCollapsed ? '展开' : '收起'}
            </Button>
          </div>
          {!isGuideCollapsed ? (
            <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>1. 支持搜索与筛选字段，先定位再配置。</div>
              <div>2. 仅在“全部”状态可拖拽排序。</div>
              <div>3. 悬停行后点「···」进行编辑与清除。</div>
            </div>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              说明已收起，点击展开查看操作提示。
            </Typography.Text>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>字段 {orderedFields.length}</Tag>
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>已配置 {configuredCount}</Tag>
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>已移除 {removedCount}</Tag>
          </div>
          {editingFieldId ? (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              正在配置：{fields.find((field) => field.id === editingFieldId)?.name ?? editingFieldId}
            </div>
          ) : null}
        </section>

        <section style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, background: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Space size={6} wrap>
              {filterItems.map((item) => (
                <Button
                  key={item.key}
                  size="small"
                  type={listFilter === item.key ? 'primary' : 'default'}
                  onClick={() => setListFilter(item.key)}
                >
                  {item.label} {item.count}
                </Button>
              ))}
            </Space>
            <Space size={8} wrap>
              <Input
                allowClear
                value={searchKeyword}
                placeholder="搜索字段名 / 类型 / 组件"
                onChange={(event) => setSearchKeyword(event.target.value)}
                style={{ width: 260, maxWidth: '100%' }}
              />
              <Button type="primary" onClick={() => setIsCreateFieldOpen(true)}>
                新增字段
              </Button>
            </Space>
          </div>

          {!canDragSort ? (
            <Typography.Text type="secondary" style={{ display: 'inline-block', fontSize: 12, marginBottom: 8 }}>
              当前为筛选/搜索结果，已禁用拖拽排序。
            </Typography.Text>
          ) : null}

          <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '24px minmax(0,1.1fr) minmax(0,1fr) 56px',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--surface-subtle)',
                borderBottom: '1px solid var(--border-color)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              <span />
              <span>字段</span>
              <span>类型 / 组件 / 状态</span>
              <span style={{ textAlign: 'right' }}>操作</span>
            </div>
            {filteredFields.map((field) => {
              const binding = bindings[field.id]
              const isDragging = draggingFieldId === field.id
              const isRemoved = hiddenFieldSet.has(field.id)
              const rowMenuItems: MenuProps['items'] = [
                { key: 'edit', icon: <EditOutlined />, label: '编辑组件' },
                { key: 'toggleVisible', label: isRemoved ? '加入当前视图' : '从当前视图移除' },
                { key: 'clearConfig', icon: <DeleteOutlined />, label: '删除配置', danger: true, disabled: !binding },
              ]
              return (
                <div
                  key={field.id}
                  draggable={canDragSort}
                  onMouseEnter={() => setHoveredFieldId(field.id)}
                  onMouseLeave={() => setHoveredFieldId((prev) => (prev === field.id ? null : prev))}
                  onDoubleClick={() => openEditor(field.id)}
                  onDragStart={() => {
                    if (!canDragSort) return
                    setDraggingFieldId(field.id)
                  }}
                  onDragEnter={() => {
                    if (!canDragSort) return
                    handleDragEnterField(field.id)
                  }}
                  onDragOver={(event) => {
                    if (!canDragSort) return
                    event.preventDefault()
                  }}
                  onDrop={() => {
                    if (!canDragSort) return
                    setDraggingFieldId(null)
                  }}
                  onDragEnd={() => setDraggingFieldId(null)}
                  style={{
                    borderTop: '1px solid var(--border-color)',
                    padding: '8px 10px',
                    display: 'grid',
                    gridTemplateColumns: '24px minmax(0,1.1fr) minmax(0,1fr) 56px',
                    alignItems: 'center',
                    gap: 8,
                    background: isDragging ? 'var(--surface-subtle)' : 'white',
                    cursor: canDragSort ? 'grab' : 'default',
                  }}
                >
                  <span
                    title={canDragSort ? '拖拽排序' : '筛选时不可拖拽'}
                    style={{ fontSize: 15, color: canDragSort ? '#94a3b8' : '#cbd5e1', userSelect: 'none' }}
                  >
                    ⠿
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {field.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {field.id}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
                    <Tag style={{ marginInlineEnd: 0 }}>{field.type}</Tag>
                    <Tag color={binding ? 'processing' : 'default'} style={{ marginInlineEnd: 0 }}>
                      {binding?.componentType ?? '默认'}
                    </Tag>
                    {isRemoved ? (
                      <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                        已移除
                      </Tag>
                    ) : (
                      <Tag color="green" style={{ marginInlineEnd: 0 }}>
                        可见
                      </Tag>
                    )}
                  </div>
                  <div
                    style={{
                      justifySelf: 'end',
                      opacity: hoveredFieldId === field.id ? 1 : 0,
                      transition: 'opacity 120ms ease',
                      pointerEvents: hoveredFieldId === field.id ? 'auto' : 'none',
                    }}
                  >
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: rowMenuItems,
                        onClick: ({ key }) => {
                          if (key === 'edit') {
                            openEditor(field.id)
                            return
                          }
                          if (key === 'toggleVisible') {
                            void toggleFieldVisibilityInCurrentView(field)
                            return
                          }
                          if (key === 'clearConfig') {
                            void handleClearFieldBinding(field)
                          }
                        },
                      }}
                    >
                      <Button size="small" icon={<MoreOutlined />} />
                    </Dropdown>
                  </div>
                </div>
              )
            })}
            {filteredFields.length === 0 ? (
              <div style={{ padding: '16px 12px', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                没有匹配的字段，请调整筛选条件或搜索关键词。
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <Drawer
        open={!!editingFieldId}
        onClose={() => void handleRequestCloseEditor()}
        width={560}
        title={`字段配置 · ${selectedField?.name ?? ''}`}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              danger
              onClick={handleClearCurrent}
              loading={isClearing}
              disabled={!editingFieldId || !bindings[editingFieldId] || isSaving}
            >
              清除配置
            </Button>
            <Space>
              <Button onClick={() => void handleRequestCloseEditor()} disabled={isSaving || isClearing}>关闭</Button>
              <Button type="primary" onClick={handleSave} loading={isSaving} disabled={!selectedField || isClearing}>
                保存配置
              </Button>
            </Space>
          </div>
        }
      >
        {selectedField ? (
          <div style={{ display: 'grid', gap: 12, paddingBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">组件类型</label>
              <Select
                value={componentType}
                onChange={(value) => setComponentType(value as FieldComponentType)}
                options={componentTypeChoices.map((item) => ({ value: item.value, label: item.label }))}
              />
            </div>

            {componentType === 'select' ? (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>下拉选项</label>
                  <Space size={6}>
                    <Button type="link" size="small" onClick={openBatchEditor} style={{ padding: 0 }}>
                      批量编辑
                    </Button>
                    <Button size="small" onClick={() => setOptionRows((prev) => [...prev, { name: '', color: '' }])}>
                      新增选项
                    </Button>
                  </Space>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {optionRows.map((row, index) => (
                    <div key={`opt_${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 150px auto', gap: 8, alignItems: 'center' }}>
                      <Input
                        value={row.name}
                        placeholder={`选项 ${index + 1}`}
                        onChange={(e) =>
                          setOptionRows((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)),
                          )
                        }
                      />
                      <Select
                        value={row.color || undefined}
                        placeholder="颜色"
                        allowClear
                        onChange={(value) =>
                          setOptionRows((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, color: value ?? '' } : item)),
                          )
                        }
                        options={colorPresets.map((item) => ({
                          value: item.value,
                          label: (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: item.value }} />
                              {item.label}
                            </span>
                          ),
                        }))}
                      />
                      <Button
                        size="small"
                        danger
                        onClick={() => setOptionRows((prev) => prev.filter((_, i) => i !== index))}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                  {optionRows.length > 0 ? (
                    <Button size="small" onClick={assignColorsForUncoloredOptions}>
                      随机配色（未设置）
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {componentType === 'cascader' ? (
              <>
                <div className="form-group">
                  <label className="form-label">父字段（一级）</label>
                  <Select
                    value={parentFieldId || undefined}
                    placeholder="请选择父字段"
                    onChange={(value) => setParentFieldId(value)}
                    options={parentCandidates.map((field) => ({ value: field.id, label: field.name }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">映射配置（格式: 父值: 子值1, 子值2）</label>
                  <Input.TextArea
                    style={{ minHeight: 120, padding: 8 }}
                    value={mappingsText}
                    onChange={(e) => setMappingsText(e.target.value)}
                    placeholder={'准备阶段: 待开始, 已受理\n实施阶段: 数据对接中'}
                  />
                </div>
              </>
            ) : null}

            <div style={{ border: '1px dashed var(--border-color)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>当前字段预览</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                可在抽屉中直接预览配置效果，确认后再保存。
              </div>

              {previewMode === 'cascader' ? (
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label">预览父级值</label>
                  <Select
                    value={previewParentValue || undefined}
                    placeholder="请选择父级值"
                    onChange={(value) => {
                      setPreviewParentValue(value)
                      setPreviewValue('')
                    }}
                    options={previewParentOptions.map((item) => ({ value: item.id, label: item.name }))}
                  />
                </div>
              ) : null}

              <div
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  background: '#fff',
                  minHeight: 48,
                  display: 'flex',
                  alignItems: 'center',
                  padding: 6,
                }}
              >
                {previewMode === 'checkbox' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={previewChecked}
                      onChange={(e) => setPreviewChecked(e.target.checked)}
                    />
                    勾选示例
                  </label>
                ) : previewMode === 'textarea' ? (
                  <Input.TextArea
                    value={previewValue}
                    onChange={(e) => setPreviewValue(e.target.value)}
                    placeholder="请输入"
                    style={{ minHeight: 78 }}
                  />
                ) : previewMode === 'date' ? (
                  <input
                    className="cell-input"
                    type="datetime-local"
                    value={previewValue}
                    onChange={(e) => setPreviewValue(e.target.value)}
                    placeholder="请选择日期"
                  />
                ) : previewMode === 'select' || previewMode === 'member' || previewMode === 'cascader' ? (
                  <select
                    className="cell-input cell-input-inline"
                    value={previewValue}
                    onChange={(e) => setPreviewValue(e.target.value)}
                    style={
                      previewSelectedOption?.color
                        ? {
                            background: `${previewSelectedOption.color}1a`,
                            color: previewSelectedOption.color,
                            borderColor: `${previewSelectedOption.color}66`,
                          }
                        : undefined
                    }
                  >
                    <option value="">请选择</option>
                    {previewSelectOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : previewMode === 'upload' || previewMode === 'image' ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Button size="small" disabled>
                      {previewMode === 'image' ? '选择图片' : '选择文件'}
                    </Button>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>上传组件预览</span>
                  </div>
                ) : (
                  <input
                    className="cell-input"
                    type="text"
                    value={previewValue}
                    onChange={(e) => setPreviewValue(e.target.value)}
                    placeholder="请输入"
                  />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={isCreateFieldOpen}
        title="新增字段"
        onCancel={() => void closeCreateFieldModal()}
        onOk={() => void handleCreateField()}
        confirmLoading={isCreatingField}
        okText="保存并绑定"
        cancelText="取消"
        okButtonProps={{ disabled: !currentViewId }}
        cancelButtonProps={{ disabled: isCreatingField }}
      >
        <div className="form-group">
          <label className="form-label">字段名称</label>
          <Input
            value={newFieldName}
            placeholder="例如：负责人"
            onChange={(event) => setNewFieldName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreateField()}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label">字段类型</label>
          <Select
            value={newFieldType}
            onChange={(value) => setNewFieldType(value as FieldType)}
            options={fieldTypeOptions.map((item) => ({ value: item.value, label: item.label }))}
          />
        </div>

        {newFieldType === 'singleSelect' || newFieldType === 'multiSelect' ? (
          <div className="form-group">
            <label className="form-label">预设选项（逗号或换行分隔）</label>
            <Input.TextArea
              style={{ minHeight: 96, padding: 8 }}
              value={newFieldOptions}
              onChange={(event) => setNewFieldOptions(event.target.value)}
              placeholder={'例如：\n待处理\n进行中\n已完成'}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={isBatchEditOpen}
        title="批量编辑选项"
        onCancel={() => void handleCloseBatchEditor()}
        onOk={applyBatchEditor}
        okText="应用"
        cancelText="取消"
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          每行一个选项，格式：`名称` 或 `名称,#颜色值`
        </Typography.Text>
        <Input.TextArea
          value={batchEditText}
          onChange={(e) => setBatchEditText(e.target.value)}
          placeholder={'待处理,#9ca3af\n进行中,#3b82f6\n已完成,#10b981'}
          style={{ minHeight: 180 }}
        />
      </Modal>
    </div>
  )
}
