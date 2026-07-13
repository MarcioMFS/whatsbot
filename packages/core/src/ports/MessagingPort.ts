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

export interface OutgoingMedia {
  instanceName: string
  instanceId?: string
  phoneNumber: string
  mediaUrl: string
  mediaType?: 'image' | 'video' | 'document' | 'audio'
  caption?: string
}

export interface OutgoingPresence {
  instanceName: string
  instanceId?: string
  phoneNumber: string
  state: 'composing' | 'paused'
}

export interface InstanceStatus {
  instanceName: string
  state: 'open' | 'close' | 'connecting'
  qrCode?: string
}

export interface MessagingPort {
  sendMessage(msg: OutgoingMessage): Promise<void>
  sendMedia?(msg: OutgoingMedia): Promise<void>
  sendPresence?(msg: OutgoingPresence): Promise<void>
  getInstanceStatus(instanceName: string): Promise<InstanceStatus>
  createInstance(instanceName: string, webhookUrl?: string, webhookSecret?: string): Promise<{ qrCode: string }>
  deleteInstance(instanceName: string): Promise<void>
  setWebhook(instanceName: string, webhookUrl: string, secret: string): Promise<void>
  connectInstance(instanceName: string, webhookUrl?: string): Promise<{ qrCode: string }>
}
