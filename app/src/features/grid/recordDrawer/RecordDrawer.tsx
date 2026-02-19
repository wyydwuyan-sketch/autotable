import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Select } from 'antd'
import { useGridStore } from '../store/gridStore'
import { buildCascadePatch, getOptionsForField } from '../utils/cascadeRules'
import { LinkedSelect } from '../components/LinkedSelect'

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return [value]
  return []
}

const readFilesAsDataUrls = async (files: FileList | null) => {
  if (!files || files.length === 0) return []
  const readers = Array.from(files).map(
    (file) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
  )
  return Promise.all(readers)
}

type OperationLogAction = 'create_record' | 'update_record' | 'delete_record' | 'import_records'

type OperationLogItem = {
  id: string
  tableId: string
  action: OperationLogAction
  message: string
  recordId?: string
  changedFields?: string[]
  fieldChanges?: Array<{
    fieldId: string
    fieldName: string
    oldValue: unknown
    newValue: unknown
  }>
  createdAt: string
}

const OPERATION_LOGS_KEY = 'grid_operation_logs'
const OPERATION_LOG_EVENT = 'grid_operation_logs_updated'

const readOperationLogs = (): OperationLogItem[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OPERATION_LOGS_KEY)
    const parsed = raw ? (JSON.parse(raw) as OperationLogItem[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '空'
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join(', ') : '空'
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function RecordDrawer() {
  const fields = useGridStore((state) => state.fields)
  const tableReferenceMembers = useGridStore((state) => state.tableReferenceMembers)
  const cascadeRules = useGridStore((state) => state.cascadeRules)
  const viewConfig = useGridStore((state) => state.viewConfig)
  const records = useGridStore((state) => state.records)
  const drawerRecordId = useGridStore((state) => state.drawerRecordId)
  const closeDrawer = useGridStore((state) => state.closeDrawer)
  const updateCellLocal = useGridStore((state) => state.updateCellLocal)
  const submitCellPatch = useGridStore((state) => state.submitCellPatch)

  const [logs, setLogs] = useState<OperationLogItem[]>([])
  const [actionFilter, setActionFilter] = useState<'all' | OperationLogAction>('all')
  const [daysFilter, setDaysFilter] = useState<'all' | '7' | '30'>('all')
  const [limit, setLimit] = useState(20)
  const record = useMemo(() => records.find((item) => item.id === drawerRecordId) ?? null, [drawerRecordId, records])
  const recordLogs = useMemo(() => {
    if (!record) return []
    const now = Date.now()
    return logs
      .filter((item) => item.recordId === record.id)
      .filter((item) => (actionFilter === 'all' ? true : item.action === actionFilter))
      .filter((item) => {
        if (daysFilter === 'all') return true
        const dayMs = Number(daysFilter) * 24 * 60 * 60 * 1000
        return now - new Date(item.createdAt).getTime() <= dayMs
      })
      .slice(0, limit)
  }, [actionFilter, daysFilter, limit, logs, record])

  useEffect(() => {
    const sync = () => setLogs(readOperationLogs())
    sync()
    window.addEventListener(OPERATION_LOG_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(OPERATION_LOG_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (!record) {
    return null
  }

  const compactValue = (value: unknown) => {
    const text = formatValue(value)
    if (text.length <= 60) {
      return text
    }
    return `${text.slice(0, 60)}...`
  }

  return (
    <>
      <div className="drawer-mask" onClick={closeDrawer} />
      <aside className="record-drawer">
        <header className="drawer-header">
          <h2>记录详情</h2>
          <div className="drawer-actions">
            <Button onClick={closeDrawer}>关闭</Button>
          </div>
        </header>
        <div className="drawer-body">
          <div className="drawer-columns">
            <div className="drawer-col-left">
              {fields.map((field) => {
                const value = record.values[field.id]
                const componentConfig = viewConfig.components?.[field.id]
                const componentType = componentConfig?.componentType ?? 'default'
                const options =
                  field.type === 'singleSelect' || field.type === 'multiSelect'
                    ? getOptionsForField(fields, record.values, field.id, cascadeRules, viewConfig.components)
                    : []
                const selectOptions =
                  field.type === 'member' || componentType === 'member'
                    ? tableReferenceMembers.map((item) => ({ id: item.userId, name: item.username }))
                    : componentType === 'select' && componentConfig?.options && componentConfig.options.length > 0
                    ? componentConfig.options
                    : options
                return (
                  <label className="drawer-field" key={field.id}>
                    <span className="drawer-label">{field.name}</span>
                    {field.type === 'singleSelect' || field.type === 'member' || (field.type === 'text' && (componentType === 'select' || componentType === 'member' || componentType === 'cascader')) ? (
                      <LinkedSelect
                        className="drawer-input"
                        value={value == null ? '' : String(value)}
                        onChange={(nextRaw) => {
                          const next = nextRaw === '' ? null : nextRaw
                          const patch = buildCascadePatch(fields, record.values, field.id, next, cascadeRules, viewConfig.components)
                          for (const [patchFieldId, patchValue] of Object.entries(patch)) {
                            updateCellLocal(record.id, patchFieldId, patchValue)
                          }
                          void submitCellPatch(record.id, patch)
                        }}
                        options={selectOptions}
                      />
                    ) : field.type === 'multiSelect' ? (
                      <select
                        className="drawer-input"
                        multiple
                        value={toStringArray(value)}
                        onChange={(event) => {
                          const selected = Array.from(event.target.selectedOptions).map((item) => item.value)
                          updateCellLocal(record.id, field.id, selected)
                        }}
                        onBlur={(event) => {
                          const selected = Array.from(event.target.selectedOptions).map((item) => item.value)
                          void submitCellPatch(record.id, { [field.id]: selected })
                        }}
                        style={{ height: 96 }}
                      >
                        {selectOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <input
                        className="drawer-input"
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => {
                          updateCellLocal(record.id, field.id, event.target.checked)
                          void submitCellPatch(record.id, { [field.id]: event.target.checked })
                        }}
                      />
                    ) : field.type === 'text' && componentType === 'textarea' ? (
                      <Input.TextArea
                        className="drawer-input"
                        value={value == null ? '' : String(value)}
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        onChange={(event) => updateCellLocal(record.id, field.id, event.target.value)}
                        onBlur={(event) => {
                          void submitCellPatch(record.id, { [field.id]: event.target.value })
                        }}
                      />
                    ) : field.type === 'attachment' || field.type === 'image' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input
                          className="drawer-input"
                          type="file"
                          multiple={field.type === 'attachment'}
                          accept={field.type === 'image' ? 'image/*' : undefined}
                          onChange={(event) => {
                            void (async () => {
                              const urls = await readFilesAsDataUrls(event.target.files)
                              const next = field.type === 'attachment' ? [...toStringArray(value), ...urls] : urls.slice(0, 1)
                              updateCellLocal(record.id, field.id, next)
                              await submitCellPatch(record.id, { [field.id]: next })
                            })()
                          }}
                        />
                        {toStringArray(value).length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {toStringArray(value).map((item, idx) =>
                              field.type === 'image' ? (
                                <img key={`${field.id}_${idx}`} src={item} alt={`image_${idx}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-color)' }} />
                              ) : (
                                <a key={`${field.id}_${idx}`} href={item} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                                  附件 {idx + 1}
                                </a>
                              )
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <input
                        className="drawer-input"
                        type={field.type === 'number' ? 'number' : (field.type === 'date' || componentType === 'date') ? 'datetime-local' : 'text'}
                        value={
                          value == null
                            ? ''
                            : field.type === 'date' && typeof value === 'string' && !value.includes('T')
                              ? `${value}T00:00`
                              : String(value)
                        }
                        onChange={(event) =>
                          updateCellLocal(
                            record.id,
                            field.id,
                            field.type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value
                          )
                        }
                        onBlur={(event) => {
                          const next =
                            field.type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value
                          void submitCellPatch(record.id, { [field.id]: next })
                        }}
                      />
                    )}
                  </label>
                )
              })}
            </div>
            <div className="drawer-col-right">
              <div className="drawer-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                该记录操作日志
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <Select
                  value={actionFilter}
                  onChange={(value) => setActionFilter(value as 'all' | OperationLogAction)}
                  options={[
                    { value: 'all', label: '全部动作' },
                    { value: 'create_record', label: '新增' },
                    { value: 'update_record', label: '更新' },
                    { value: 'delete_record', label: '删除' },
                    { value: 'import_records', label: '导入' },
                  ]}
                />
                <Select
                  value={daysFilter}
                  onChange={(value) => setDaysFilter(value as 'all' | '7' | '30')}
                  options={[
                    { value: 'all', label: '全部时间' },
                    { value: '7', label: '最近7天' },
                    { value: '30', label: '最近30天' },
                  ]}
                />
                <Select
                  value={String(limit)}
                  onChange={(value) => setLimit(Number(value))}
                  options={[
                    { value: '20', label: '最近20条' },
                    { value: '50', label: '最近50条' },
                    { value: '100', label: '最近100条' },
                  ]}
                />
              </div>
              {recordLogs.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>暂无该记录操作日志。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recordLogs.map((item) => (
                    <div key={item.id} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 13 }}>{item.message}</div>
                      {item.fieldChanges && item.fieldChanges.length > 0 ? (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {item.fieldChanges.map((change, idx) => (
                            <div key={`${item.id}_${change.fieldId}_${idx}`} style={{ fontSize: 12, color: 'var(--text-secondary)' }} title={`${formatValue(change.oldValue)} -> ${formatValue(change.newValue)}`}>
                              {change.fieldName}: {compactValue(change.oldValue)} -&gt; {compactValue(change.newValue)}
                            </div>
                          ))}
                        </div>
                      ) : item.changedFields && item.changedFields.length > 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          变更字段: {item.changedFields.join(', ')}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
