/**
 * Typed API client. Every request carries the JWT from storage. Errors are
 * normalized into ApiError with a human-readable message from the server.
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export class ApiError extends Error {
  status: number
  code?: string
  details?: Record<string, unknown>

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function getToken(): string | null {
  return localStorage.getItem('dai_token')
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem('dai_token', token)
  else localStorage.removeItem('dai_token')
}

export interface Trader {
  id: number
  name: string
  phone: string
  email: string | null
  email_verified?: boolean
}

export interface CustomerDto {
  id: number
  client_uuid: string
  name: string
  phone: string | null
  notes: string | null
  balance_minor: number
  created_at: string
}

export interface EntryDto {
  id: number
  type: 'CREDIT' | 'PAYMENT'
  amount_minor: number
  payment_method: string | null
  note: string | null
  client_uuid: string
  voided: boolean
  void_reason: string | null
  created_at: string
}

export interface DashboardDto {
  total_owed_minor: number
  customers_owing: number
  total_customers: number
  top_customers: { id: number; name: string; balance_minor: number }[]
}

export interface SyncOpResult {
  client_uuid: string
  status: 'ok' | 'error'
  message?: string
  server_id?: number
  balance_minor?: number
  duplicate?: boolean
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new ApiError(0, 'You are offline. Please try again when connected.', 'network')
  }

  if (response.status === 204) return undefined as T

  let body: unknown = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const err = (body as { error?: { message?: string; code?: string; details?: Record<string, unknown> } }) ?? {}
    throw new ApiError(
      response.status,
      err.error?.message ?? 'Something went wrong. Please try again.',
      err.error?.code,
      err.error?.details,
    )
  }
  return body as T
}

function json(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) }
}

export const api = {
  register: (payload: { name: string; phone: string; password: string; email?: string }) =>
    request<{ token: string; trader: Trader }>('/auth/register', json('POST', payload)),
  login: (payload: { phone: string; password: string }) =>
    request<{ token: string; trader: Trader }>('/auth/login', json('POST', payload)),
  requestPasswordReset: (email: string) =>
    request<{ message: string }>('/auth/password-reset/request', json('POST', { email })),
  requestEmailVerification: (email: string, password: string) =>
    request<{ message: string }>(
      '/auth/email-verification/request',
      json('POST', { email, password }),
    ),
  confirmEmailVerification: (token: string) =>
    request<{ message: string }>(
      '/auth/email-verification/confirm',
      json('POST', { token }),
    ),
  resetPassword: (token: string, password: string) =>
    request<{ message: string }>(
      '/auth/password-reset/confirm',
      json('POST', { token, password }),
    ),
  logout: () => request<void>('/auth/logout', json('POST')),
  me: () => request<{ trader: Trader }>('/auth/me'),

  dashboard: () => request<DashboardDto>('/dashboard/summary'),
  listCustomers: (q?: string) =>
    request<{ customers: CustomerDto[]; total_owed_minor: number }>(
      `/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  createCustomer: (payload: { name: string; phone?: string; notes?: string; client_uuid?: string }) =>
    request<CustomerDto>('/customers', json('POST', payload)),
  getCustomer: (id: number) => request<CustomerDto>(`/customers/${id}`),
  updateCustomer: (id: number, payload: { name?: string; phone?: string; notes?: string }) =>
    request<CustomerDto>(`/customers/${id}`, json('PATCH', payload)),
  getLedger: (id: number) =>
    request<{ customer: CustomerDto; entries: EntryDto[]; balance_minor: number }>(
      `/customers/${id}/ledger`,
    ),

  credit: (payload: { customer_id: number; amount_minor: number; note?: string; client_uuid?: string }) =>
    request<{ entry: EntryDto; balance_minor: number }>('/ledger/credit', json('POST', payload)),
  payment: (payload: {
    customer_id: number
    amount_minor: number
    payment_method?: string
    note?: string
    client_uuid?: string
  }) => request<{ entry: EntryDto; balance_minor: number }>('/ledger/payment', json('POST', payload)),
  voidEntry: (entryId: number, reason?: string) =>
    request<{ entry: EntryDto; balance_minor: number }>(
      `/ledger/${entryId}/void`,
      json('POST', { reason }),
    ),

  sync: (operations: Record<string, unknown>[]) =>
    request<{ results: SyncOpResult[] }>('/sync', json('POST', { operations })),
}
