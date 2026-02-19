import { useAuthStore } from '../auth/authStore'
import type { Dashboard, DashboardWidget, WidgetCreatePayload, WidgetData, WidgetUpdatePayload } from './types'

const API_BASE_URL = import.meta.env.VITE_GRID_API_BASE_URL ?? 'http://192.168.1.211:8000'

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
      // keep fallback message
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

export const dashboardApi = {
  getCurrent: () => requestJson<Dashboard>('/dashboards/current'),
  createWidget: (body: WidgetCreatePayload) =>
    requestJson<DashboardWidget>('/dashboards/widgets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWidget: (id: string, patch: WidgetUpdatePayload) =>
    requestJson<DashboardWidget>(`/dashboards/widgets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteWidget: (id: string) =>
    requestJson<{ ok: boolean }>(`/dashboards/widgets/${id}`, {
      method: 'DELETE',
    }),
  getWidgetData: (id: string, payload?: Record<string, unknown>) =>
    requestJson<WidgetData>(`/dashboards/widgets/${id}/data`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
}

