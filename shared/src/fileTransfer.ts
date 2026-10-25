/**
 * Encrypted file download.
 *
 * The browser makes a one-time ECDH P-256 key pair and sends the public key.
 * The hub makes its own one-time key pair, derives an AES-256-GCM key
 * (ECDH -> HKDF-SHA256) and encrypts the file. The file path is the AAD.
 * Proxies that end TLS (Cloudflare tunnel) see only ciphertext.
 *
 * Envelope: [version 1B][hub public key 65B][salt 16B][iv 12B][ciphertext + tag]
 */

export const FILE_TRANSFER_VERSION = 1
export const MAX_FILE_DOWNLOAD_BYTES = 50 * 1024 * 1024

const PUBLIC_KEY_BYTES = 65
const SALT_BYTES = 16
const IV_BYTES = 12
const HEADER_BYTES = 1 + PUBLIC_KEY_BYTES + SALT_BYTES + IV_BYTES
const HKDF_INFO = new TextEncoder().encode('haqi-file-download-v1')
const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const

function toBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
    const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

/** Browser side: a one-time key pair. The private key cannot be exported. */
export async function createDownloadKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
    const pair = await crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits'])
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) }
}

/** Hub side. Throws if `recipientPublicKey` is not a valid P-256 point. */
export async function encryptFileForDownload(
    recipientPublicKey: string,
    plaintext: Uint8Array<ArrayBuffer>,
    path: string
): Promise<Uint8Array<ArrayBuffer>> {
    const recipientRaw = fromBase64Url(recipientPublicKey)
    if (recipientRaw.length !== PUBLIC_KEY_BYTES) {
        throw new Error('Invalid public key')
    }
    const recipient = await crypto.subtle.importKey('raw', recipientRaw, ECDH_PARAMS, false, [])
    const ephemeral = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveBits'])
    const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const key = await deriveAesKey(ephemeral.privateKey, recipient, salt)
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) },
        key,
        plaintext
    ))

    const envelope = new Uint8Array(HEADER_BYTES + ciphertext.length)
    envelope[0] = FILE_TRANSFER_VERSION
    envelope.set(ephemeralRaw, 1)
    envelope.set(salt, 1 + PUBLIC_KEY_BYTES)
    envelope.set(iv, 1 + PUBLIC_KEY_BYTES + SALT_BYTES)
    envelope.set(ciphertext, HEADER_BYTES)
    return envelope
}

/** Browser side. Throws if the envelope was changed or is for another path. */
export async function decryptFileDownload(
    privateKey: CryptoKey,
    envelope: Uint8Array<ArrayBuffer>,
    path: string
): Promise<Uint8Array<ArrayBuffer>> {
    if (envelope.length < HEADER_BYTES || envelope[0] !== FILE_TRANSFER_VERSION) {
        throw new Error('Unsupported download format')
    }
    const senderRaw = envelope.slice(1, 1 + PUBLIC_KEY_BYTES)
    const salt = envelope.slice(1 + PUBLIC_KEY_BYTES, 1 + PUBLIC_KEY_BYTES + SALT_BYTES)
    const iv = envelope.slice(1 + PUBLIC_KEY_BYTES + SALT_BYTES, HEADER_BYTES)
    const sender = await crypto.subtle.importKey('raw', senderRaw, ECDH_PARAMS, false, [])
    const key = await deriveAesKey(privateKey, sender, salt)
    return new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) },
        key,
        envelope.subarray(HEADER_BYTES)
    ))
}
