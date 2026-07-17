// BR Code Pix estático (EMV/BCB) — o "copia e cola" com valor embutido, gerado
// offline a partir da chave (sem PSP/API). Validado em app de banco real em
// 2026-07-17: abre com recebedor e valor preenchidos. Não há confirmação
// automática (código estático não tem webhook) — o comprovante segue sendo a
// confirmação, validado por IA no flow.

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, '0')}${value}`
}

// CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) sobre os bytes UTF-8 do payload
function crc16(payload: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(payload, 'utf-8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// Campos de exibição: EMV usa length em caracteres do payload — acento vira
// divergência entre length e bytes do CRC em algumas implementações de banco.
// ASCII-only elimina a classe de problema (bancos exibem normal).
function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '')
}

export function buildPixBrCode(params: {
  key: string
  merchantName: string
  merchantCity?: string
  amountCentavos: number
  txid?: string
}): string {
  const amount = (params.amountCentavos / 100).toFixed(2)
  const payload =
    tlv('00', '01') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', params.key)) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', amount) +
    tlv('58', 'BR') +
    tlv('59', ascii(params.merchantName).slice(0, 25)) +
    tlv('60', ascii(params.merchantCity ?? 'BRASIL').slice(0, 15)) +
    tlv('62', tlv('05', params.txid ?? '***')) +
    '6304'
  return payload + crc16(payload)
}
