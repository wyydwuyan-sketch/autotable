import { useEffect, useState, useMemo } from 'react'
import { Modal, Select, Button, Input, message } from 'antd'
import type { Field, ViewConfig, FilterCondition, FilterLogic, FilterPreset, FilterDraft } from '../../types/grid'
import { newRuleId, newPresetId, defaultOpByType, getFilterOpsByType, normalizeFilterValue } from '../../utils/filterUtils'
import { confirmAction } from '../../../../utils/confirmAction'

interface FilterModalProps {
  open: boolean
  onCancel: () => void
  fields: Field[]
  viewConfig: ViewConfig
  onUpdateViewConfig: (config: Partial<ViewConfig>) => void
}

export function FilterModal({ open, onCancel, fields, viewConfig, onUpdateViewConfig }: FilterModalProps) {
  const [filterRules, setFilterRules] = useState<FilterDraft[]>([])
  const [filterLogicDraft, setFilterLogicDraft] = useState<FilterLogic>('and')
  const [presetName, setPresetName] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')

  const getField = (fieldId: string) => fields.find((field) => field.id === fieldId)

  const sortedPresets = useMemo(() => {
    const presets = viewConfig.filterPresets ?? []
    return [...presets].sort((a, b) => {
      const ap = a.pinned ? 1 : 0
      const bp = b.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [viewConfig.filterPresets])

  const toFilterDrafts = (): FilterDraft[] => {
    if (viewConfig.filters.length > 0) {
      return viewConfig.filters.map((item) => ({
        id: newRuleId(),
        fieldId: item.fieldId,
        op:
          item.op === 'equals' ||
          item.op === 'neq' ||
          item.op === 'gt' ||
          item.op === 'gte' ||
          item.op === 'lt' ||
          item.op === 'lte'
            ? item.op
            : 'contains',
        value: String(item.value ?? ''),
      }))
    }
    return [
      {
        id: newRuleId(),
        fieldId: fields[0]?.id ?? '',
        op: defaultOpByType(fields[0]?.type),
        value: '',
      },
    ]
  }

  // Initialize drafts when modal opens
  useEffect(() => {
    if (open) {
      setFilterRules(toFilterDrafts())
      setFilterLogicDraft(viewConfig.filterLogic ?? 'and')
      setPresetName('')
    }
  }, [open, viewConfig.filters, viewConfig.filterLogic, fields])

  const baselineRules = useMemo(
    () => toFilterDrafts().map((item) => ({ fieldId: item.fieldId, op: item.op, value: item.value })),
    [fields, viewConfig.filters],
  )
  const currentRules = useMemo(
    () => filterRules.map((item) => ({ fieldId: item.fieldId, op: item.op, value: item.value })),
    [filterRules],
  )
  const hasDraftChanges = useMemo(
    () =>
      JSON.stringify(currentRules) !== JSON.stringify(baselineRules) ||
      filterLogicDraft !== (viewConfig.filterLogic ?? 'and') ||
      presetName.trim().length > 0,
    [baselineRules, currentRules, filterLogicDraft, presetName, viewConfig.filterLogic],
  )

  const handleApplyFilter = async () => {
    const confirmed = await confirmAction({
      title: '确认应用当前筛选条件？',
      okText: '确认应用',
    })
    if (!confirmed) return
    const nextFilters: FilterCondition[] = filterRules
      .filter((rule) => rule.fieldId && rule.value.trim())
      .map((rule) => ({
        fieldId: rule.fieldId,
        op: rule.op,
        value: normalizeFilterValue(fields, rule.fieldId, rule.op, rule.value.trim()),
      }))
    onUpdateViewConfig({ filters: nextFilters, filterLogic: filterLogicDraft })
    onCancel()
  }

  const savePreset = async () => {
    const name = presetName.trim()
    if (!name) {
      return
    }
    const confirmed = await confirmAction({
      title: `确认保存筛选方案「${name}」？`,
      okText: '确认保存',
    })
    if (!confirmed) return
    const nextFilters: FilterCondition[] = filterRules
      .filter((rule) => rule.fieldId && rule.value.trim())
      .map((rule) => ({
        fieldId: rule.fieldId,
        op: rule.op,
        value: normalizeFilterValue(fields, rule.fieldId, rule.op, rule.value.trim()),
      }))
    // Use current sorts or view config sorts? AppShell logic used viewConfig.sorts fallback
    const effectiveSorts = viewConfig.sorts
    
    const existingByName = (viewConfig.filterPresets ?? []).find((item) => item.name === name)
    const preset: FilterPreset = {
      id: existingByName?.id ?? newPresetId(),
      name,
      pinned: existingByName?.pinned ?? false,
      filters: nextFilters,
      sorts: effectiveSorts,
      filterLogic: filterLogicDraft,
    }
    const existing = viewConfig.filterPresets ?? []
    const withoutSameName = existing.filter((item) => item.name !== name)
    onUpdateViewConfig({ filterPresets: [...withoutSameName, preset] })
    setPresetName('')
  }

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = (viewConfig.filterPresets ?? []).find((item) => item.id === presetId)
    if (!preset) {
      return
    }
    onUpdateViewConfig({
      filters: preset.filters,
      sorts: preset.sorts,
      filterLogic: preset.filterLogic,
    })
  }

  const deletePreset = async (presetId: string) => {
    const target = (viewConfig.filterPresets ?? []).find((item) => item.id === presetId)
    if (!target) {
      return
    }
    const confirmed = await confirmAction({
      title: `确认删除筛选方案「${target.name}」？`,
      content: '删除后不可恢复。',
      okText: '确认删除',
      danger: true,
    })
    if (!confirmed) return
    const next = (viewConfig.filterPresets ?? []).filter((item) => item.id !== presetId)
    onUpdateViewConfig({ filterPresets: next })
    if (selectedPresetId === presetId) {
      setSelectedPresetId('')
    }
  }

  const renamePreset = (presetId: string) => {
    const current = (viewConfig.filterPresets ?? []).find((item) => item.id === presetId)
    if (!current) return
    let draftName = current.name
    Modal.confirm({
      title: '重命名筛选方案',
      content: (
        <Input
          defaultValue={current.name}
          onChange={(e) => {
            draftName = e.target.value
          }}
          placeholder="请输入新的方案名称"
        />
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: () => {
        const nextName = draftName.trim()
        if (!nextName) {
          message.warning('方案名称不能为空。')
          return Promise.reject()
        }
        const next = (viewConfig.filterPresets ?? []).map((item) =>
          item.id === presetId ? { ...item, name: nextName } : item
        )
        onUpdateViewConfig({ filterPresets: next })
      },
    })
  }

  const togglePresetPin = (presetId: string) => {
    const next = (viewConfig.filterPresets ?? []).map((item) =>
      item.id === presetId ? { ...item, pinned: !item.pinned } : item
    )
    onUpdateViewConfig({ filterPresets: next })
  }

  const handleRequestClose = async () => {
    if (!hasDraftChanges) {
      onCancel()
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的筛选编辑？',
      content: '关闭后当前筛选草稿不会生效。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    onCancel()
  }

  return (
    <Modal
      open={open}
      title="筛选记录"
      onCancel={() => void handleRequestClose()}
      onOk={() => void handleApplyFilter()}
      okText="应用筛选"
      cancelText="取消"
      width={920}
    >
      <div className="form-group">
        <label className="form-label">规则关系</label>
        <Select
          value={filterLogicDraft}
          onChange={(value) => setFilterLogicDraft(value as FilterLogic)}
          options={[
            { label: 'AND（全部满足）', value: 'and' },
            { label: 'OR（任一满足）', value: 'or' },
          ]}
        />
      </div>
      {filterRules.map((rule, index) => (
        <div key={rule.id} className="form-group" style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 10 }}>
          <label className="form-label">规则 {index + 1}</label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 120px 1fr auto' }}>
            <Select
              value={rule.fieldId}
              onChange={(value) =>
                setFilterRules((prev) =>
                  prev.map((item) => {
                    if (item.id !== rule.id) return item
                    const nextFieldId = value
                    const nextType = getField(nextFieldId)?.type
                    const nextOp = defaultOpByType(nextType)
                    return { ...item, fieldId: nextFieldId, op: nextOp }
                  })
                )
              }
              options={fields.map((field) => ({ label: field.name, value: field.id }))}
            />
            <Select
              value={rule.op}
              onChange={(value) =>
                setFilterRules((prev) =>
                  prev.map((item) => (item.id === rule.id ? { ...item, op: value as FilterDraft['op'] } : item))
                )
              }
              options={getFilterOpsByType(getField(rule.fieldId)?.type).map((op) => ({ label: op.label, value: op.value }))}
            />
            {getField(rule.fieldId)?.type === 'singleSelect' ? (
              <Select
                value={rule.value}
                placeholder="请选择"
                onChange={(value) =>
                  setFilterRules((prev) => prev.map((item) => (item.id === rule.id ? { ...item, value: value ?? '' } : item)))
                }
                options={(getField(rule.fieldId)?.options ?? []).map((option) => ({
                  label: option.name,
                  value: option.id,
                }))}
                allowClear
              />
            ) : (
              <Input
                type={getField(rule.fieldId)?.type === 'number' ? 'number' : getField(rule.fieldId)?.type === 'date' ? 'date' : 'text'}
                value={rule.value}
                placeholder="输入值"
                onChange={(e) =>
                  setFilterRules((prev) => prev.map((item) => (item.id === rule.id ? { ...item, value: e.target.value } : item)))
                }
              />
            )}
            <Button onClick={() => setFilterRules((prev) => prev.filter((item) => item.id !== rule.id))}>删除</Button>
          </div>
        </div>
      ))}
      <Button
        onClick={() =>
          setFilterRules((prev) => [
            ...prev,
            {
              id: newRuleId(),
              fieldId: fields[0]?.id ?? '',
              op: defaultOpByType(fields[0]?.type),
              value: '',
            },
          ])
        }
      >
        + 添加规则
      </Button>
      <div className="form-group" style={{ marginTop: 12 }}>
        <label className="form-label">保存为筛选方案</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            type="text"
            value={presetName}
            placeholder="例如：高优先级待处理"
            onChange={(e) => setPresetName(e.target.value)}
          />
          <Button onClick={() => void savePreset()}>保存方案</Button>
        </div>
      </div>
      {(sortedPresets.length ?? 0) > 0 ? (
        <div className="form-group">
          <label className="form-label">已有方案</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedPresets.map((preset) => (
              <div
                key={preset.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '6px 10px',
                }}
              >
                <span style={{ fontSize: 13 }}>{preset.pinned ? '★ ' : ''}{preset.name}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button onClick={() => applyPreset(preset.id)}>应用</Button>
                  <Button onClick={() => renamePreset(preset.id)}>重命名</Button>
                  <Button onClick={() => togglePresetPin(preset.id)}>
                    {preset.pinned ? '取消置顶' : '置顶'}
                  </Button>
                  <Button onClick={() => void deletePreset(preset.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
