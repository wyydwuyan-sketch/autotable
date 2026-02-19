import { createApiClient } from './client'
import type { Field, FieldType, RecordModel, TableButtonPermissions, View, ViewConfig } from '../types/grid'
import { useAuthStore } from '../../auth/authStore'

type RecordPageOut = {
  items: RecordModel[]
  nextCursor: string | null
  totalCount: number
}

const API_BASE_URL = import.meta.env.VITE_GRID_API_BASE_URL ?? 'http://192.168.1.211:8000'
const MAX_RECORDS_PAGE_SIZE = 500

type RequestError = Error & { status?: number }

async function requestJson<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      if (allowRetry) {
        const refreshed = await useAuthStore.getState().refreshAccessToken()
        if (refreshed) {
          return requestJson<T>(path, init, false)
        }
      }
      useAuthStore.getState().forceLogout()
      const authError = new Error('登录状态已失效，请重新登录。') as RequestError
      authError.status = 401
      throw authError
    }
    let detail = `请求失败 (${response.status})`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body?.detail) {
        detail = body.detail
      }
    } catch {
      // ignore parse error and keep fallback message
    }
    const error = new Error(detail) as RequestError
    error.status = response.status
    throw error
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export const httpGridApi = createApiClient({
  async getFields(tableId) {
    return requestJson<Field[]>(`/tables/${tableId}/fields`)
  },
  async getViews(tableId) {
    const views = await requestJson<View[]>(`/tables/${tableId}/views`)
    return views
  },
  async importViewBundle(tableId, payload) {
    try {
      return await requestJson<{
        viewId: string
        viewName: string
        fieldIds: string[]
        recordCount: number
      }>(`/views/import?tableId=${encodeURIComponent(tableId)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      if ((error as RequestError)?.status !== 404) {
        throw error
      }
      return requestJson<{
        viewId: string
        viewName: string
        fieldIds: string[]
        recordCount: number
      }>(`/tables/${tableId}/views/import`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    }
  },
  async getRecords(tableId, viewId, cursor, pageSize = 500, query) {
    const safePageSize = Math.max(1, Math.min(pageSize, MAX_RECORDS_PAGE_SIZE))
    return requestJson<RecordPageOut>(`/tables/${tableId}/records/query`, {
      method: 'POST',
      body: JSON.stringify({
        viewId,
        cursor,
        pageSize: safePageSize,
        filters: query?.filters,
        sorts: query?.sorts,
        filterLogic: query?.filterLogic,
      }),
    })
  },
  async updateRecord(recordId, valuesPatch) {
    return requestJson<RecordModel>(`/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ valuesPatch }),
    })
  },
  async createRecord(tableId, initialValues = {}) {
    return requestJson<RecordModel>(`/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ initialValues }),
    })
  },
  async deleteRecord(recordId) {
    await requestJson<void>(`/records/${recordId}`, { method: 'DELETE' })
  },
  async createField(tableId, name, type: FieldType, options) {
    return requestJson<Field>(`/tables/${tableId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name, type, width: 180, options }),
    })
  },
  async deleteField(fieldId) {
    await requestJson<void>(`/fields/${fieldId}`, { method: 'DELETE' })
  },
  async createView(tableId, name, type) {
    const config: ViewConfig = {
      hiddenFieldIds: [],
      fieldOrderIds: [],
      columnWidths: {},
      sorts: [],
      filters: [],
      isEnabled: true,
      order: 0,
      filterLogic: 'and',
      filterPresets: [],
      components: {},
    }
    return requestJson<View>(`/tables/${tableId}/views`, {
      method: 'POST',
      body: JSON.stringify({ name, type, config }),
    })
  },
  async deleteView(viewId) {
    await requestJson<void>(`/views/${viewId}`, { method: 'DELETE' })
  },
  async updateView(viewId, patch) {
    return requestJson<View>(`/views/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },
  async getTablePermissions(tableId) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/tables/${tableId}/permissions`,
    )
  },
  async updateTablePermissions(tableId, items) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/tables/${tableId}/permissions`,
      {
        method: 'PUT',
        body: JSON.stringify({ items }),
      },
    )
  },
  async applyTablePermissionsByRoleDefaults(tableId) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/tables/${tableId}/permissions/apply-role-defaults`,
      {
        method: 'POST',
      },
    )
  },
  async getTableButtonPermissions(tableId) {
    return requestJson<Array<{ userId: string; username: string; buttons: TableButtonPermissions }>>(
      `/tables/${tableId}/button-permissions`,
    )
  },
  async updateTableButtonPermissions(tableId, items) {
    return requestJson<Array<{ userId: string; username: string; buttons: TableButtonPermissions }>>(
      `/tables/${tableId}/button-permissions`,
      {
        method: 'PUT',
        body: JSON.stringify({ items }),
      },
    )
  },
  async getMyTableButtonPermissions(tableId) {
    return requestJson<TableButtonPermissions>(`/tables/${tableId}/button-permissions/me`)
  },
  async getViewPermissions(viewId) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/views/${viewId}/permissions`,
    )
  },
  async updateViewPermissions(viewId, items) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/views/${viewId}/permissions`,
      {
        method: 'PUT',
        body: JSON.stringify({ items }),
      },
    )
  },
  async applyViewPermissionsByRoleDefaults(viewId) {
    return requestJson<Array<{ userId: string; username: string; canRead: boolean; canWrite: boolean }>>(
      `/views/${viewId}/permissions/apply-role-defaults`,
      {
        method: 'POST',
      },
    )
  },
  async getTableReferenceMembers(tableId) {
    return requestJson<Array<{ userId: string; username: string }>>(`/tables/${tableId}/reference-members`)
  },
})
