// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force the dev (fetch) path and a known preference.
vi.mock('./supabase', () => ({ supabase: null }))
vi.mock('./contentPref', () => ({ getPref: () => ({ lang: 'ja', level: 'rich' }) }))

import { scanArtwork } from './api'

beforeEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('scanArtwork request body', () => {
  it('includes lang/level from getPref()', async () => {
    let sent: { image?: string; mime?: string; lang?: string; level?: string } | null = null
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      return {
        ok: true,
        json: async () => ({
          status: 'ready', panorama_url: 'x', title: 't', artist: 'a', artwork_id: null,
        }),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEV', true) // ensure the dev path (supabase is mocked null)

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    await scanArtwork(blob)

    expect(fetchMock).toHaveBeenCalled()
    expect(sent!.lang).toBe('ja')
    expect(sent!.level).toBe('rich')
    expect(typeof sent!.image).toBe('string')
    expect(sent!.mime).toBe('image/jpeg')
  })
})
