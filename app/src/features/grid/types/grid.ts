export type FieldType = 'text' | 'number' | 'date' | 'singleSelect' | 'multiSelect' | 'checkbox' | 'attachment' | 'image' | 'member'

export interface Base {
  id: string
  name: string
}

export interface Table {
  id: string
  baseId: string
  name: string
}

export interface FormFieldSetting {
  label?: string
  description?: string
  required?: boolean
  placeholder?: string
}

export interface CascadeRule {
  id: string
  name: string
  parentFieldId: string
  childFieldId: string
  enabled: boolean
  order: number
}

export type FieldComponentType = 'default' | 'input' | 'textarea' | 'date' | 'select' | 'cascader' | 'upload' | 'image' | 'member'

export interface CascaderComponentConfig {
  parentFieldId: string
  mappings: Record<string, string[]>
}

export interface FieldComponentConfig {
  componentType: FieldComponentType
  options?: FieldOption[]
  cascader?: CascaderComponentConfig
}

export interface ViewConfig {
  hiddenFieldIds: string[]
  fieldOrderIds?: string[]
  frozenFieldIds?: string[]
  columnWidths: Record<string, number>
  sorts: SortCondition[]
  filters: FilterCondition[]
  isEnabled?: boolean
  order?: number
  filterLogic?: FilterLogic
  filterPresets?: FilterPreset[]
  compactEmptyRows?: boolean
  components?: Record<string, FieldComponentConfig>
  formSettings?: {
    visibleFieldIds?: string[]
    fieldConfig?: Record<string, FormFieldSetting>
    cascadeRules?: CascadeRule[]
    submitText?: string
    successMessage?: string
  }
}

export interface SortCondition {
  fieldId: string
  direction: 'asc' | 'desc'
}

export interface FilterCondition {
  fieldId: string
  op: string
  value: unknown
}

export type FilterLogic = 'and' | 'or'

export interface FilterPreset {
  id: string
  name: string
  pinned?: boolean
  filterLogic: FilterLogic
  filters: FilterCondition[]
  sorts: SortCondition[]
}

export interface View {
  id: string
  tableId: string
  name: string
  type: 'grid' | 'form'
  config: ViewConfig
}

export interface FieldOption {
  id: string
  name: string
  color?: string
  parentId?: string
}

export type FilterDraft = {
  id: string
  fieldId: string
  op: 'contains' | 'equals' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}

export type SortDraft = {
  id: string
  fieldId: string
  direction: 'asc' | 'desc'
}

export interface Field {
  id: string
  tableId: string
  name: string
  type: FieldType
  width?: number
  options?: FieldOption[]
}

export interface RecordModel {
  id: string
  tableId: string
  values: Record<string, unknown>
}

export interface FocusedCell {
  rowId: string
  fieldId: string
}

export interface TablePermissionItem {
  userId: string
  username: string
  canRead: boolean
  canWrite: boolean
}

export interface ViewPermissionItem {
  userId: string
  username: string
  canRead: boolean
  canWrite: boolean
}

export interface TablePermissionPatchItem {
  userId: string
  canRead: boolean
  canWrite: boolean
}

export interface TableButtonPermissions {
  canCreateRecord: boolean
  canDeleteRecord: boolean
  canImportRecords: boolean
  canExportRecords: boolean
  canManageFilters: boolean
  canManageSorts: boolean
}

export interface TableButtonPermissionItem {
  userId: string
  username: string
  buttons: TableButtonPermissions
}

export interface ReferenceMember {
  userId: string
  username: string
}
