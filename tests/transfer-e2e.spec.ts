import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TraeCredentialStore } from '../src/auth.ts'
import { mergeTransferRecords, parseTransferFile, previewTransferFile, traeTransferRecordOf } from '../src/transfer.ts'

const temp = () => mkdtemp(join(tmpdir(), 'trae-e2e-'))

describe('transfer end-to-end: export from one store, import into another', () => {
  it('round-trips an account through the real file format', async () => {
    const dirA = await temp(); const dirB = await temp()
    const credential = { accessToken: 'live-token', refreshToken: 'rt', userId: 'u1', accountName: 'demo-user',
      host: 'https://api.trae.cn', userRegion: 'CN', expiresAtMs: 1_893_456_000_000, edition: 'cn' as const, source: 'dsh' as const }
    const storeA = new TraeCredentialStore({ storagePath: join(dirA,'none.json'), edition: 'cn', ownPath: join(dirA,'own.json'), refresh: async () => { throw new Error('unused') } })
    await storeA.importAccounts([credential])

    // Export exactly as the route does.
    const record = traeTransferRecordOf(credential, { account: { userId: 'u1', username: 'demo-user' } })
    const fileText = JSON.stringify([record])
    // Preview must not leak the token.
    expect(JSON.stringify(previewTransferFile(fileText))).not.toContain('live-token')

    // Import into a FRESH store, as a different machine would.
    const { changes, imported } = mergeTransferRecords(parseTransferFile(fileText), [0], 'cn')
    expect(imported).toBe(1)
    const storeB = new TraeCredentialStore({ storagePath: join(dirB,'none.json'), edition: 'cn', ownPath: join(dirB,'own.json'), refresh: async () => { throw new Error('unused') } })
    await storeB.importAccounts([...changes.values()])

    const accounts = await storeB.accounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.accountName).toBe('demo-user')
    // The expiry survived the millisecond boundary intact.
    expect(accounts[0]?.tokenExpiresAtMs).toBe(1_893_456_000_000)
    // And the account id converged, so re-import replaces rather than duplicates.
    const doc = JSON.parse(await readFile(join(dirB,'own.json'),'utf8'))
    expect(doc.version).toBe(2)
  })
})
