export interface IncomingMessage {
  instanceName: string
  phoneNumber: string
  message: string
  messageId: string
  timestamp: number
  isGroup: boolean
}

export interface OutgoingMessage {
  instanceName: string
  instanceId?: string
  phoneNumber: string
  message: string
}

export interface InstanceStatus {
  instanceName: string
  state: 'open' | 'close' | 'connecting'
  qrCode?: string
}

export interface MessagingPort {
  sendMessage(msg: OutgoingMessage): Promise<void>
  getInstanceStatus(instanceName: string): Promise<InstanceStatus>
  createInstance(instanceName: string, webhookUrl?: string, webhookSecret?: string): Promise<{ qrCode: string }>
  deleteInstance(instanceName: string): Promise<void>
  setWebhook(instanceName: string, webhookUrl: string, secret: string): Promise<void>
  connectInstance(instanceName: string, webhookUrl?: string): Promise<{ qrCode: string }>
}
