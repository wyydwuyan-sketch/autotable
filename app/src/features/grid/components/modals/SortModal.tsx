import { useEffect, useMemo, useState } from 'react'
import { Modal, Select, Button } from 'antd'
import type { Field, ViewConfig, SortCondition, SortDraft } from '../../types/grid'
import { newRuleId } from '../../utils/filterUtils'
import { confirmAction } from '../../../../utils/confirmAction'

interface SortModalProps {
  open: boolean
  onCancel: () => void
  fields: Field[]
  viewConfig: ViewConfig
  onUpdateViewConfig: (config: Partial<ViewConfig>) => void
}

export function SortModal({ open, onCancel, fields, viewConfig, onUpdateViewConfig }: SortModalProps) {
  const [sortRules, setSortRules] = useState<SortDraft[]>([])

  const toSortDrafts = (): SortDraft[] => {
    if (viewConfig.sorts.length > 0) {
      return viewConfig.sorts.map((item) => ({
        id: newRuleId(),
        fieldId: item.fieldId,
        direction: item.direction,
      }))
    }
    return [{ id: newRuleId(), fieldId: fields[0]?.id ?? '', direction: 'asc' }]
  }

  useEffect(() => {
    if (open) {
      setSortRules(toSortDrafts())
    }
  }, [open, viewConfig.sorts, fields])

  const baselineRules = useMemo(
    () => toSortDrafts().map((item) => ({ fieldId: item.fieldId, direction: item.direction })),
    [fields, viewConfig.sorts],
  )
  const currentRules = useMemo(
    () => sortRules.map((item) => ({ fieldId: item.fieldId, direction: item.direction })),
    [sortRules],
  )
  const hasDraftChanges = useMemo(
    () => JSON.stringify(currentRules) !== JSON.stringify(baselineRules),
    [baselineRules, currentRules],
  )

  const handleApplySort = async () => {
    const confirmed = await confirmAction({
      title: '确认应用当前排序规则？',
      okText: '确认应用',
    })
    if (!confirmed) return
    const nextSorts: SortCondition[] = sortRules
      .filter((rule) => rule.fieldId)
      .map((rule) => ({ fieldId: rule.fieldId, direction: rule.direction }))
    onUpdateViewConfig({ sorts: nextSorts })
    onCancel()
  }

  const handleRequestClose = async () => {
    if (!hasDraftChanges) {
      onCancel()
      return
    }
    const confirmed = await confirmAction({
      title: '放弃未保存的排序编辑？',
      content: '关闭后当前排序草稿不会生效。',
      okText: '放弃并关闭',
      danger: true,
    })
    if (!confirmed) return
    onCancel()
  }

  return (
    <Modal
      open={open}
      title="排序记录"
      onCancel={() => void handleRequestClose()}
      onOk={() => void handleApplySort()}
      okText="应用排序"
      cancelText="取消"
      width={760}
    >
      {sortRules.map((rule, index) => (
        <div key={rule.id} className="form-group" style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 10 }}>
          <label className="form-label">规则 {index + 1}</label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 160px auto' }}>
            <Select
              value={rule.fieldId}
              onChange={(value) => setSortRules((prev) => prev.map((item) => (item.id === rule.id ? { ...item, fieldId: value } : item)))}
              options={fields.map((field) => ({ label: field.name, value: field.id }))}
            />
            <Select
              value={rule.direction}
              onChange={(value) =>
                setSortRules((prev) =>
                  prev.map((item) => (item.id === rule.id ? { ...item, direction: value as SortDraft['direction'] } : item))
                )
              }
              options={[
                { label: '升序 (Asc)', value: 'asc' },
                { label: '降序 (Desc)', value: 'desc' },
              ]}
            />
            <Button onClick={() => setSortRules((prev) => prev.filter((item) => item.id !== rule.id))}>删除</Button>
          </div>
        </div>
      ))}
      <Button onClick={() => setSortRules((prev) => [...prev, { id: newRuleId(), fieldId: fields[0]?.id ?? '', direction: 'asc' }])}>
        + 添加规则
      </Button>
    </Modal>
  )
}
