import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useGridStore } from '../store/gridStore'
import { Button, Checkbox, Input, Modal, Select, Space, Typography } from 'antd'
import type { FieldType, FormFieldSetting } from '../types/grid'
import { buildCascadePatch, getOptionsForField } from '../utils/cascadeRules'
import { LinkedSelect } from '../components/LinkedSelect'
import { gridApiClient } from '../api'
import { useEffect } from 'react'
import { confirmAction } from '../../../utils/confirmAction'

const EMPTY_FIELD_IDS: string[] = []

export function FormView() {
  const { tableId = 'tbl_1' } = useParams()
  const fields = useGridStore((state) => state.fields)
  const createRecord = useGridStore((state) => state.createRecord)
  const createField = useGridStore((state) => state.createField)
  const deleteField = useGridStore((state) => state.deleteField)
  const viewConfig = useGridStore((state) => state.viewConfig)
  const updateViewConfig = useGridStore((state) => state.updateViewConfig)
  const cascadeRules = useGridStore((state) => state.cascadeRules)
  const tableReferenceMembers = useGridStore((state) => state.tableReferenceMembers)
  const [fallbackMembers, setFallbackMembers] = useState<Array<{ id: string; name: string }>>([])

  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [submitted, setSubmitted] = useState(false)
  const [mode, setMode] = useState<'fill' | 'design'>('fill')
  const [selectedHiddenFieldIds, setSelectedHiddenFieldIds] = useState<string[]>([])

  // Create Field Dialog State
  const [isFieldOpen, setIsFieldOpen] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState<FieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [isSubmittingForm, setIsSubmittingForm] = useState(false)
  const [isCreatingField, setIsCreatingField] = useState(false)
  const hasCreateFieldDraft = newFieldName.trim().length > 0 || newFieldType !== 'text' || newFieldOptions.trim().length > 0

  // Get Form Settings or defaults
  const formSettings = viewConfig.formSettings || {}
  const visibleFieldIds = formSettings.visibleFieldIds ?? EMPTY_FIELD_IDS
  const fieldConfig = formSettings.fieldConfig || {}
  const isDesignMode = mode === 'design'

  const visibleFields = useMemo(() => {
    return fields.filter(f => visibleFieldIds.includes(f.id))
  }, [fields, visibleFieldIds])
  const hiddenFields = useMemo(() => fields.filter((field) => !visibleFieldIds.includes(field.id)), [fields, visibleFieldIds])

  const memberOptions = useMemo(
    () =>
      tableReferenceMembers.length > 0
        ? tableReferenceMembers.map((item) => ({ id: item.userId, name: item.username }))
        : fallbackMembers,
    [fallbackMembers, tableReferenceMembers],
  )

  useEffect(() => {
    if (tableReferenceMembers.length > 0) {
      return
    }
    let active = true
    void (async () => {
      try {
        const list = await gridApiClient.getTableReferenceMembers(tableId)
        if (!active) return
        setFallbackMembers(list.map((item) => ({ id: item.userId, name: item.username })))
      } catch {
        if (!active) return
        setFallbackMembers([])
      }
    })()
    return () => {
      active = false
    }
  }, [tableId, tableReferenceMembers.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingForm) return
    const confirmed = await confirmAction({
      title: '确认提交表单？',
      content: '提交后会创建一条新记录。',
      okText: '确认提交',
    })
    if (!confirmed) return
    setIsSubmittingForm(true)
    try {
      await createRecord(tableId, formValues)
      setSubmitted(true)
      setFormValues({})
    } finally {
      setIsSubmittingForm(false)
    }
  }

  const handleChange = (fieldId: string, value: unknown) => {
    setFormValues((prev) => {
      const patch = buildCascadePatch(fields, prev, fieldId, value === '' ? null : value, cascadeRules, viewConfig.components)
      const next = { ...prev }
      for (const [patchFieldId, patchValue] of Object.entries(patch)) {
        next[patchFieldId] = patchValue
      }
      return next
    })
  }

  const parseOptions = (raw: string) =>
    raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ id: item, name: item }))

  const toggleFieldVisibility = (fieldId: string) => {
    const newVisibleIds = visibleFieldIds.includes(fieldId)
      ? visibleFieldIds.filter(id => id !== fieldId)
      : [...visibleFieldIds, fieldId]
    
    updateViewConfig({
      formSettings: {
        ...formSettings,
        visibleFieldIds: newVisibleIds
      }
    })
  }

  const updateFieldSetting = (fieldId: string, setting: Partial<FormFieldSetting>) => {
    const currentConfig = fieldConfig[fieldId] || {}
    updateViewConfig({
      formSettings: {
        ...formSettings,
        fieldConfig: {
          ...fieldConfig,
          [fieldId]: { ...currentConfig, ...setting }
        }
      }
    })
  }

  const restoreSelectedHiddenFields = () => {
    if (selectedHiddenFieldIds.length === 0) return
    const nextVisible = Array.from(new Set([...visibleFieldIds, ...selectedHiddenFieldIds]))
    updateViewConfig({
      formSettings: {
        ...formSettings,
        visibleFieldIds: nextVisible,
      },
    })
    setSelectedHiddenFieldIds([])
  }

  const removeSelectedHiddenFields = () => {
    if (selectedHiddenFieldIds.length === 0) return
    const targetIds = [...selectedHiddenFieldIds]
    Modal.confirm({
      title: `确认删除 ${targetIds.length} 个字段？`,
      content: '删除后不可恢复，且会从当前表中永久移除。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const nextVisible = visibleFieldIds.filter((id) => !targetIds.includes(id))
        const nextFieldConfig = Object.fromEntries(
          Object.entries(fieldConfig).filter(([fieldId]) => !targetIds.includes(fieldId)),
        )
        updateViewConfig({
          formSettings: {
            ...formSettings,
            visibleFieldIds: nextVisible,
            fieldConfig: nextFieldConfig,
          },
        })
        await Promise.all(targetIds.map((fieldId) => deleteField(fieldId)))
        setSelectedHiddenFieldIds([])
      },
    })
  }

  const handleCreateField = async () => {
    if (!newFieldName.trim()) return
    if (isCreatingField) return
    const confirmed = await confirmAction({
      title: `确认创建字段「${newFieldName.trim()}」并添加到当前表单？`,
      okText: '确认创建',
    })
    if (!confirmed) return
    setIsCreatingField(true)
    try {
      // 1. Create field in table
      // Note: We need to capture the created field ID, but current createField action doesn't return it directly.
      // However, since we are mocking, we can predict it or refactor.
      // For now, we'll rely on the fact that createField updates the store.
      // A better approach would be to update createField to return the created field.
      // Given the constraints, we will wait for the store update or fetch the latest field.
      // Actually, createField in store is async. Let's assume the last field in the list is the new one after await.

      const prevFieldsLength = fields.length
      const options = newFieldType === 'singleSelect' || newFieldType === 'multiSelect' ? parseOptions(newFieldOptions) : undefined
      await createField(tableId, newFieldName.trim(), newFieldType, options)

      // We need to get the newly created field ID to add it to visibleFieldIds
      // This is a bit of a hack because we don't get the ID back from createField
      // But since state update is synchronous in the mock (or awaited), we can access the updated state
      const updatedFields = useGridStore.getState().fields
      if (updatedFields.length > prevFieldsLength) {
        const newField = updatedFields[updatedFields.length - 1]

        // 2. Add to visible fields in this form view
        updateViewConfig({
          formSettings: {
            ...formSettings,
            visibleFieldIds: [...visibleFieldIds, newField.id]
          }
        })
      }

      setIsFieldOpen(false)
      setNewFieldName('')
      setNewFieldType('text')
      setNewFieldOptions('')
    } finally {
      setIsCreatingField(false)
    }
  }

  const closeCreateFieldModal = async () => {
    if (isCreatingField) return
    if (!hasCreateFieldDraft) {
      setIsFieldOpen(false)
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的新字段输入？',
      content: '关闭后当前字段名称和选项输入将丢失。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    setIsFieldOpen(false)
    setNewFieldName('')
    setNewFieldType('text')
    setNewFieldOptions('')
  }

  if (submitted) {
    return (
      <div className="form-view-container">
        <div className="form-success-card">
          <div className="success-icon">✓</div>
          <h2>{formSettings.successMessage || '提交成功'}</h2>
          <p>您的回答已收到。</p>
          <Button onClick={() => setSubmitted(false)}>再填一份</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="form-view-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          borderBottom: '1px solid var(--border-color)',
          background: 'white',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            表单视图
          </Typography.Title>
          <Typography.Text type="secondary">填写与设计分离，避免误操作。</Typography.Text>
        </div>
        <Space>
          <Button type={mode === 'fill' ? 'primary' : 'default'} onClick={() => setMode('fill')}>
            填写模式
          </Button>
          <Button type={mode === 'design' ? 'primary' : 'default'} onClick={() => setMode('design')}>
            设计模式
          </Button>
          {isDesignMode ? (
            <Button onClick={() => setIsFieldOpen(true)}>
              新建字段
            </Button>
          ) : null}
        </Space>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Configuration Panel (Edit Mode Only) */}
      {isDesignMode && (
        <aside className="form-config-panel" style={{ width: 300, background: 'white', borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>表单设置</h3>
          
          <div className="form-group" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>字段列表</label>
              <Button 
                onClick={() => setIsFieldOpen(true)}
                style={{ height: 28, fontSize: 12, padding: '0 8px' }}
              >
                + 新建字段
              </Button>
            </div>
            
	            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              {fields.map(field => {
                const isVisible = visibleFieldIds.includes(field.id)
                const config = fieldConfig[field.id] || {}
                
                return (
                  <div key={field.id} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, background: isVisible ? '#f8fafc' : 'white' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isVisible ? 8 : 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: isVisible ? 'var(--text-main)' : 'var(--text-muted)' }}>{field.name}</span>
                      <Checkbox checked={isVisible} onChange={() => toggleFieldVisibility(field.id)} />
                    </div>
                    
                    {isVisible && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Input
                          placeholder="自定义显示名称" 
                          style={{ height: 32, fontSize: 13 }}
                          value={config.label || ''}
                          onChange={(e) => updateFieldSetting(field.id, { label: e.target.value })}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <Checkbox checked={config.required ?? true} onChange={(e) => updateFieldSetting(field.id, { required: e.target.checked })} />
                            必填
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
	            </div>
              <div style={{ marginTop: 14, borderTop: '1px dashed var(--border-color)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  已移除字段（可恢复或删除）
                </div>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  placeholder="选择要恢复或彻底删除的字段"
                  value={selectedHiddenFieldIds}
                  onChange={(value) => setSelectedHiddenFieldIds(value)}
                  options={hiddenFields.map((field) => ({ value: field.id, label: `${field.name} (${field.type})` }))}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button onClick={restoreSelectedHiddenFields} disabled={selectedHiddenFieldIds.length === 0}>
                    恢复选中
                  </Button>
                  <Button danger onClick={removeSelectedHiddenFields} disabled={selectedHiddenFieldIds.length === 0}>
                    删除选中
                  </Button>
                </div>
              </div>
	          </div>
	        </aside>
      )}

      {/* Main Form Preview */}
      <div className="form-view-container" style={{ flex: 1, position: 'relative' }}>
        <div className="form-card">
          <div className="form-header">
            <h1>数据收集表单</h1>
            <p>请填写以下信息</p>
          </div>
          {visibleFields.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <p>暂无表单项，请点击右上角“编辑表单”添加字段。</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="form-body">
              {visibleFields.map((field) => {
                const config = fieldConfig[field.id] || {}
                const componentConfig = viewConfig.components?.[field.id]
                const componentType = componentConfig?.componentType ?? 'default'
                const label = config.label || field.name
                const required = config.required ?? true
                const placeholder = config.placeholder || `请输入${label}`
                const options =
                  field.type === 'singleSelect' || field.type === 'multiSelect'
                    ? getOptionsForField(fields, formValues, field.id, cascadeRules, viewConfig.components)
                    : []
                const selectOptions =
                  field.type === 'member' || componentType === 'member'
                    ? memberOptions
                    : componentType === 'select' && componentConfig?.options && componentConfig.options.length > 0
                    ? componentConfig.options
                    : options

                return (
                  <div key={field.id} className="form-field-group">
                    <label className="form-field-label">
                      {label}
                      {required && <span className="required-mark">*</span>}
                    </label>
                    {field.type === 'singleSelect' || field.type === 'member' || (field.type === 'text' && (componentType === 'select' || componentType === 'member' || componentType === 'cascader')) ? (
                      <LinkedSelect
                        className="form-input"
                        value={String(formValues[field.id] ?? '')}
                        onChange={(value) => handleChange(field.id, value)}
                        options={selectOptions}
                        placeholder={required ? '请选择' : '可不选'}
                      />
                    ) : field.type === 'multiSelect' ? (
                      <Select
                        mode="multiple"
                        value={Array.isArray(formValues[field.id]) ? (formValues[field.id] as string[]) : []}
                        onChange={(value) => handleChange(field.id, value)}
                        options={getOptionsForField(fields, formValues, field.id, cascadeRules, viewConfig.components).map((option) => ({
                          value: option.id,
                          label: option.name,
                        }))}
                        placeholder={required ? '请选择' : '可不选'}
                      />
                    ) : field.type === 'checkbox' ? (
                      <Checkbox
                        checked={formValues[field.id] === true}
                        onChange={(e) => handleChange(field.id, e.target.checked)}
                      />
                    ) : field.type === 'attachment' || field.type === 'image' ? (
                      <Input
                        type="file"
                        multiple={field.type === 'attachment'}
                        accept={field.type === 'image' ? 'image/*' : undefined}
                        onChange={(e) => {
                          const files = e.target.files
                          if (!files || files.length === 0) return
                          void (async () => {
                            const tasks = Array.from(files).map(
                              (file) =>
                                new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader()
                                  reader.onload = () => resolve(String(reader.result ?? ''))
                                  reader.onerror = () => reject(new Error('读取文件失败'))
                                  reader.readAsDataURL(file)
                                })
                            )
                            const urls = await Promise.all(tasks)
                            handleChange(field.id, field.type === 'image' ? urls.slice(0, 1) : urls)
                          })()
                        }}
                      />
                    ) : (
                      <Input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'datetime-local' : 'text'}
                        value={String(formValues[field.id] ?? '')}
                        onChange={(e) =>
                          handleChange(
                            field.id,
                            field.type === 'number'
                              ? (e.target.value === '' ? null : Number(e.target.value))
                              : e.target.value
                          )
                        }
                        placeholder={placeholder}
                      />
                    )}
                  </div>
                )
              })}
              <div className="form-footer">
                <Button htmlType="submit" type="primary" className="submit-btn" loading={isSubmittingForm} disabled={isSubmittingForm}>
                  {formSettings.submitText || '提交'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
      </div>

      {/* Create Field Dialog */}
        <Modal
          open={isFieldOpen}
          title="新建表单字段"
          onCancel={() => void closeCreateFieldModal()}
          onOk={() => void handleCreateField()}
          okText="创建并添加"
          cancelText="取消"
          confirmLoading={isCreatingField}
          cancelButtonProps={{ disabled: isCreatingField }}
        >
        <div className="form-group">
          <label className="form-label">字段名称</label>
          <Input
            type="text"
            placeholder="例如：客户姓名、联系电话"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateField()}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">字段类型</label>
          <Select
            value={newFieldType}
            onChange={(value) => setNewFieldType(value as FieldType)}
            options={[
              { value: 'text', label: '文本 (Text)' },
              { value: 'number', label: '数字 (Number)' },
              { value: 'date', label: '日期 (Date)' },
              { value: 'singleSelect', label: '单选 (Single Select)' },
              { value: 'multiSelect', label: '多选 (Multi Select)' },
              { value: 'member', label: '成员 (Member)' },
              { value: 'checkbox', label: '复选框 (Checkbox)' },
              { value: 'attachment', label: '附件 (Attachment)' },
              { value: 'image', label: '图片 (Image)' },
            ]}
          />
        </div>
        {(newFieldType === 'singleSelect' || newFieldType === 'multiSelect') ? (
          <div className="form-group">
            <label className="form-label">预设选项（逗号或换行分隔）</label>
            <Input.TextArea
              style={{ minHeight: 88, padding: 8 }}
              value={newFieldOptions}
              onChange={(e) => setNewFieldOptions(e.target.value)}
              placeholder={'例如：\n待处理\n进行中\n已完成'}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
