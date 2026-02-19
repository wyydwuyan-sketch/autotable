import type { AuthTokenPayload, MePayload, TenantMember, TenantRole } from './types'
import { useAuthStore } from './authStore'

const API_BASE_URL = import.meta.env.VITE_GRID_API_BASE_URL ?? 'http://192.168.1.211:8000'

type RequestError = Error & { status?: number }

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    let detail = `请求失败 (${response.status})`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body?.detail) {
        detail = body.detail
      }
    } catch {
      // keep fallback detail
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

async function requestWithBearer<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  try {
    return await requestAuth<T>(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    const status = (error as RequestError).status
    if (status !== 401) {
      throw error
    }
    const refreshed = await useAuthStore.getState().refreshAccessToken()
    if (!refreshed) {
      throw error
    }
    return requestAuth<T>(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${refreshed}`,
        ...(init?.headers ?? {}),
      },
    })
  }
}

export const authApi = {
  refresh() {
    return requestAuth<AuthTokenPayload>('/auth/refresh', { method: 'POST' })
  },
  login(username: string, password: string) {
    return requestAuth<AuthTokenPayload>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  logout() {
    return requestAuth<{ detail: string }>('/auth/logout', { method: 'POST' })
  },
  me(accessToken: string) {
    return requestWithBearer<MePayload>('/auth/me', accessToken)
  },
  switchTenant(accessToken: string, tenantId: string) {
    return requestWithBearer<AuthTokenPayload>('/tenants/switch', accessToken, {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    })
  },
  listMembers(accessToken: string) {
    return requestWithBearer<TenantMember[]>('/tenants/current/members', accessToken)
  },
  removeMember(accessToken: string, userId: string) {
    return requestWithBearer<{ detail: string }>(`/tenants/current/members/${userId}`, accessToken, {
      method: 'DELETE',
    })
  },
  createMember(
    accessToken: string,
    payload: { username: string; account: string; email?: string; mobile?: string; roleKey?: string; password?: string },
  ) {
    return requestWithBearer<TenantMember>('/tenants/current/members', accessToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  firstLoginChangePassword(account: string, password: string, newPassword: string) {
    return requestAuth<{ detail: string }>('/auth/first-login/change-password', {
      method: 'POST',
      body: JSON.stringify({ account, password, newPassword }),
    })
  },
  updateMemberRole(accessToken: string, userId: string, roleKey: string) {
    return requestWithBearer<TenantMember>(`/tenants/current/members/${userId}/role`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ roleKey }),
    })
  },
  listRoles(accessToken: string) {
    return requestWithBearer<TenantRole[]>('/tenants/current/roles', accessToken)
  },
  createRole(accessToken: string, payload: Omit<TenantRole, 'key'> & { key: string }) {
    return requestWithBearer<TenantRole>('/tenants/current/roles', accessToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateRole(accessToken: string, roleKey: string, payload: Partial<Omit<TenantRole, 'key'>>) {
    return requestWithBearer<TenantRole>(`/tenants/current/roles/${roleKey}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deleteRole(accessToken: string, roleKey: string) {
    return requestWithBearer<{ detail: string }>(`/tenants/current/roles/${roleKey}`, accessToken, {
      method: 'DELETE',
    })
  },
}
