export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const tokenKey = 'pulse-access-token'
export const accessToken = () => sessionStorage.getItem(tokenKey)
export const setAccessToken = (token: string | null) => token ? sessionStorage.setItem(tokenKey, token) : sessionStorage.removeItem(tokenKey)

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : Array.isArray(body?.message) ? body.message.join(', ') : `Ошибка сервера (${response.status})`
    throw new ApiError(response.status, message)
  }
  return body as T
}

async function refresh(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!response.ok) { setAccessToken(null); return false }
  const body = await read<{ accessToken: string }>(response)
  setAccessToken(body.accessToken)
  return true
}

let refreshing: Promise<boolean> | null = null
export async function restoreAccess(): Promise<boolean> {
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null })
  return refreshing
}

export async function api<T>(path: string, options: RequestInit = {}, authorized = true): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (authorized && accessToken()) headers.set('Authorization', `Bearer ${accessToken()}`)
  const send = () => fetch(`/api${path}`, { ...options, headers, credentials: 'include' })
  let response = await send()
  if (response.status === 401 && authorized && await restoreAccess()) {
    headers.set('Authorization', `Bearer ${accessToken()}`)
    response = await send()
  }
  return read<T>(response)
}

export const json = (value: unknown) => JSON.stringify(value)
