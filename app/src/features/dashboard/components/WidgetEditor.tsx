import { Alert, Button, Form, Input, Modal, Radio, Select, Skeleton, Steps, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { gridApiClient } from '../../grid/api'
import type { Field } from '../../grid/types/grid'
import { useDashboardStore } from '../dashboardStore'
import type { AggregationType, DashboardWidget, WidgetType } from '../types'

const WIDGET_TYPES: Array<{ value: WidgetType; label: string; desc: string }> = [
  { value: 'metric', label: '指标卡', desc: '展示聚合值' },
  { value: 'bar', label: '柱状图', desc: '分组对比统计' },
  { value: 'line', label: '折线图', desc: '趋势分析' },
  { value: 'pie', label: '饼图', desc: '占比分布' },
  { value: 'table', label: '数据列表', desc: '记录明细' },
]

type FormValues = {
  type: WidgetType
  title: string
  tableId: string
  fieldIds: string[]
  aggregation: AggregationType
  groupFieldId?: string
}

type Props = {
  open: boolean
  widget: DashboardWidget | null
  defaultTableId: string
  onClose: () => void
}

export function WidgetEditor({ open, widget, defaultTableId, onClose }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [step, setStep] = useState(0)
  const [fields, setFields] = useState<Field[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const addWidget = useDashboardStore((state) => state.addWidget)
  const updateWidget = useDashboardStore((state) => state.updateWidget)

  const isEdit = !!widget
  const selectedType = Form.useWatch('type', form)
  const selectedTableId = Form.useWatch('tableId', form)

  const typeLabelMap = useMemo(
    () => Object.fromEntries(WIDGET_TYPES.map((item) => [item.value, item.label] as const)),
    [],
  )

  const numericFieldOptions = useMemo(
    () => fields.filter((field) => field.type === 'number').map((field) => ({ value: field.id, label: field.name })),
    [fields],
  )
  const groupFieldOptions = useMemo(
    () =>
      fields
        .filter((field) => ['singleSelect', 'text', 'date'].includes(field.type))
        .map((field) => ({ value: field.id, label: field.name })),
    [fields],
  )
  const allFieldOptions = useMemo(
    () => fields.map((field) => ({ value: field.id, label: `${field.name} (${field.type})` })),
    [fields],
  )

  useEffect(() => {
    if (!open) return
    const fallbackType: WidgetType = widget?.type ?? 'metric'
    const fallbackTitle = widget?.title ?? typeLabelMap[fallbackType]
    const fallbackTableId = widget?.tableId ?? defaultTableId
    form.setFieldsValue({
      type: fallbackType,
      title: fallbackTitle,
      tableId: fallbackTableId,
      fieldIds: widget?.fieldIds ?? [],
      aggregation: widget?.aggregation ?? 'count',
      groupFieldId: widget?.groupFieldId ?? undefined,
    })
    setStep(isEdit ? 1 : 0)
  }, [defaultTableId, form, isEdit, open, typeLabelMap, widget])

  useEffect(() => {
    if (!open) return
    if (!selectedTableId) {
      setFields([])
      return
    }
    let active = true
    setFieldsLoading(true)
    void (async () => {
      try {
        const result = await gridApiClient.getFields(selectedTableId)
        if (!active) return
        setFields(result)
      } catch {
        if (!active) return
        setFields([])
      } finally {
        if (!active) return
        setFieldsLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [open, selectedTableId])

  const handleNext = async () => {
    if (step === 0) {
      await form.validateFields(['type'])
    } else if (step === 1) {
      await form.validateFields(['tableId'])
    }
    setStep((prev) => Math.min(prev + 1, 2))
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      await form.validateFields(['title'])
      const rawValues = form.getFieldsValue(true) as Partial<FormValues>
      const widgetType = rawValues.type ?? widget?.type ?? 'metric'
      const widgetTableId = rawValues.tableId ?? widget?.tableId ?? defaultTableId
      const aggregation = rawValues.aggregation ?? widget?.aggregation ?? 'count'
      const title = (rawValues.title ?? '').trim() || typeLabelMap[widgetType]
      const fieldIds = Array.isArray(rawValues.fieldIds) ? rawValues.fieldIds : widget?.fieldIds ?? []
      const groupFieldId = rawValues.groupFieldId ?? widget?.groupFieldId ?? null

      if (!widgetTableId) {
        message.error('请选择数据表后再保存。')
        return
      }

      if (isEdit && widget) {
        await updateWidget(widget.id, {
          title,
          tableId: widgetTableId,
          fieldIds,
          aggregation,
          groupFieldId,
        })
        onClose()
        return
      }

      await addWidget({
        type: widgetType,
        title,
        tableId: widgetTableId,
        fieldIds,
        aggregation,
        groupFieldId,
        layout: { x: 0, y: 999, w: 4, h: 3 },
        config: {},
      })
      onClose()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '保存组件失败，请稍后重试'
      message.error(detail)
    } finally {
      setSaving(false)
    }
  }

  const closeAndReset = () => {
    form.resetFields()
    setStep(0)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑组件' : '添加组件'}
      onCancel={closeAndReset}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Steps
        current={step}
        items={[{ title: '选择类型' }, { title: '配置数据源' }, { title: '设置标题' }]}
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical" preserve>
        {step === 0 ? (
          <Form.Item name="type" label="组件类型" rules={[{ required: true, message: '请选择组件类型' }]}>
            <Radio.Group optionType="button" buttonStyle="solid">
              {WIDGET_TYPES.map((item) => (
                <Radio.Button key={item.value} value={item.value} title={item.desc}>
                  {item.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
        ) : null}

        {step === 1 ? (
          <>
            <Form.Item name="tableId" label="数据表" rules={[{ required: true, message: '请选择数据表' }]}>
              <Select options={[{ value: defaultTableId, label: defaultTableId }]} />
            </Form.Item>

            {fieldsLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}

            <Form.Item name="aggregation" label="聚合方式" initialValue="count">
              <Select
                options={[
                  { value: 'count', label: '计数' },
                  { value: 'sum', label: '求和' },
                  { value: 'avg', label: '平均值' },
                ]}
              />
            </Form.Item>

            {selectedType === 'metric' ? (
              <Form.Item name="fieldIds" label="数值字段（用于求和/平均）">
                <Select mode="multiple" options={numericFieldOptions} placeholder="可选，不选时默认按记录数计数" />
              </Form.Item>
            ) : null}

            {selectedType === 'bar' || selectedType === 'pie' || selectedType === 'line' ? (
              <>
                <Form.Item name="groupFieldId" label="分组字段">
                  <Select options={groupFieldOptions} placeholder="请选择分组字段" allowClear />
                </Form.Item>
                <Form.Item name="fieldIds" label="数值字段（用于 sum/avg）">
                  <Select mode="multiple" options={numericFieldOptions} placeholder="可选，count 时可不选" />
                </Form.Item>
              </>
            ) : null}

            {selectedType === 'table' ? (
              <Form.Item name="fieldIds" label="展示字段">
                <Select mode="multiple" options={allFieldOptions} placeholder="不选则展示全部字段" />
              </Form.Item>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Alert type="info" showIcon message="建议标题简洁且可识别，例如：任务状态分布、本周新增工单。" style={{ marginBottom: 12 }} />
            <Form.Item name="title" label="组件标题" rules={[{ required: true, message: '请输入组件标题' }]}>
              <Input maxLength={30} placeholder="请输入组件标题" />
            </Form.Item>
          </>
        ) : null}
      </Form>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        {step > 0 ? <Button onClick={() => setStep((prev) => prev - 1)}>上一步</Button> : null}
        {step < 2 ? (
          <Button type="primary" onClick={() => void handleNext()}>
            下一步
          </Button>
        ) : (
          <Button type="primary" onClick={() => void handleSave()} loading={saving}>
            保存
          </Button>
        )}
      </div>
    </Modal>
  )
}
