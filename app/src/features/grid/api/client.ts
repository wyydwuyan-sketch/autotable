import type {
  Field,
  FieldType,
  FilterCondition,
  FilterLogic,
  RecordModel,
  ReferenceMember,
  SortCondition,
  TableButtonPermissionItem,
  TableButtonPermissions,
  TablePermissionItem,
  TablePermissionPatchItem,
  ViewPermissionItem,
  View,
  ViewConfig,
} from '../types/grid'

export interface RecordQueryOptions {
  sorts?: SortCondition[]
  filters?: FilterCondition[]
  filterLogic?: FilterLogic
}

export interface RecordPageResult {
  items: RecordModel[]
  nextCursor: string | null
  totalCount: number
}

export interface GridApiClient {
  getFields: (tableId: string) => Promise<Field[]>
  getViews: (tableId: string) => Promise<View[]>
  importViewBundle: (
    tableId: string,
    payload: {
      viewName: string
      viewType?: 'grid' | 'form'
      fields: Array<{
        name: string
        type?: FieldType
        width?: number
        options?: Array<{ id: string; name: string; color?: string; parentId?: string }>
      }>
      records: Array<Record<string, unknown>>
    },
  ) => Promise<{
    viewId: string
    viewName: string
    fieldIds: string[]
    recordCount: number
  }>
  getRecords: (
    tableId: string,
    viewId: string,
    cursor?: string,
    pageSize?: number,
    query?: RecordQueryOptions
  ) => Promise<RecordPageResult>
  updateRecord: (recordId: string, valuesPatch: Record<string, unknown>) => Promise<RecordModel>
  createRecord: (tableId: string, initialValues?: Record<string, unknown>) => Promise<RecordModel>
  deleteRecord: (recordId: string) => Promise<void>
  createField: (tableId: string, name: string, type: FieldType, options?: Array<{ id: string; name: string; color?: string; parentId?: string }>) => Promise<Field>
  deleteField: (fieldId: string) => Promise<void>
  createView: (tableId: string, name: string, type: 'grid' | 'form') => Promise<View>
  deleteView: (viewId: string) => Promise<void>
  updateView: (viewId: string, patch: { name?: string; type?: 'grid' | 'form'; config?: ViewConfig }) => Promise<View>
  getTablePermissions: (tableId: string) => Promise<TablePermissionItem[]>
  updateTablePermissions: (tableId: string, items: TablePermissionPatchItem[]) => Promise<TablePermissionItem[]>
  applyTablePermissionsByRoleDefaults: (tableId: string) => Promise<TablePermissionItem[]>
  getTableButtonPermissions: (tableId: string) => Promise<TableButtonPermissionItem[]>
  updateTableButtonPermissions: (tableId: string, items: Array<{ userId: string; buttons: TableButtonPermissions }>) => Promise<TableButtonPermissionItem[]>
  getMyTableButtonPermissions: (tableId: string) => Promise<TableButtonPermissions>
  getViewPermissions: (viewId: string) => Promise<ViewPermissionItem[]>
  updateViewPermissions: (viewId: string, items: TablePermissionPatchItem[]) => Promise<ViewPermissionItem[]>
  applyViewPermissionsByRoleDefaults: (viewId: string) => Promise<ViewPermissionItem[]>
  getTableReferenceMembers: (tableId: string) => Promise<ReferenceMember[]>
}

export const createApiClient = (client: GridApiClient): GridApiClient => client
