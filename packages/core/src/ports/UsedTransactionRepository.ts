/**
 * Stores all transaction IDs + receipt fingerprints that have been used
 * to approve a payment. Used exclusively for duplicate detection.
 */
export interface UsedTransactionRepository {
  isUsed(botId: string, transactionId: string): Promise<boolean>
  markUsed(botId: string, transactionId: string, paymentIntentId: string, receiptFingerprint: string): Promise<void>
  isFingerprintUsed(botId: string, fingerprint: string): Promise<boolean>
}
