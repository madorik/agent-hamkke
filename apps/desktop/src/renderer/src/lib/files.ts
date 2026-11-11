import { useEffect, useState } from 'react'
import type { FileMeta } from '@ah/protocol'
import { t } from './i18n'
import { api, guard } from './store'

// 파일은 로그인이 필요해 <img src> 로 바로 못 붙인다. 한 번 받아 blob URL 로 돌려 쓴다.
const cache = new Map<string, Promise<string>>()

export function fileUrl(id: string): Promise<string> {
  let p = cache.get(id)
  if (!p) {
    p = api.fileBlob(id).then((b) => URL.createObjectURL(b))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

export function useFileUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    fileUrl(id)
      .then((u) => alive && setUrl(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id])
  return url
}

export async function saveFile(f: FileMeta) {
  const url = await guard(fileUrl(f.id))
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const isImage = (f: FileMeta) => /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.mime)

export function fmtSize(n: number) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function fileKind(f: FileMeta) {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toUpperCase() : ''
  return ext && ext.length <= 5 ? ext : f.mime.split('/').pop()?.toUpperCase() ?? t('file.kind')
}
