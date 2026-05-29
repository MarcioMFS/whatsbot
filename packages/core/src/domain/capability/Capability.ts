import type { CapabilityProps, CapabilityTrigger } from './types.js'

export type { CapabilityProps, CapabilityTrigger }
export type { TriggerType } from './types.js'

export class Capability {
  private props: CapabilityProps

  constructor(props: CapabilityProps) {
    this.props = props
  }

  get id(): string { return this.props.id }
  get botId(): string { return this.props.botId }
  get name(): string { return this.props.name }
  get description(): string { return this.props.description }
  get examples(): string[] { return this.props.examples }
  get exclusions(): string[] { return this.props.exclusions }
  get triggers(): CapabilityTrigger[] { return this.props.triggers }
  get flowId(): string { return this.props.flowId }
  get isDefault(): boolean { return this.props.isDefault }
  get isEnabled(): boolean { return this.props.isEnabled }
  get priority(): number { return this.props.priority }
  get metadata(): Record<string, unknown> { return this.props.metadata }
  get createdAt(): Date { return this.props.createdAt }
  get updatedAt(): Date { return this.props.updatedAt }

  matchesTriggers(ctx: {
    message: string
    phase: string
    leadTags: string[]
  }): { matches: boolean; score: number; matchedTriggers: string[] } {
    let score = 0
    const matchedTriggers: string[] = []
    const msgLower = ctx.message.toLowerCase()

    for (const trigger of this.props.triggers) {
      let matched = false

      switch (trigger.type) {
        case 'keyword': {
          const keywordRegex = new RegExp(`\\b${this.escapeRegex(trigger.value)}\\b`, 'i')
          if (keywordRegex.test(ctx.message)) {
            matched = true
            score += trigger.priority
          }
          break
        }
        case 'phrase': {
          if (msgLower === trigger.value.toLowerCase()) {
            matched = true
            score += trigger.priority * 2
          }
          break
        }
        case 'state': {
          if (ctx.phase === trigger.value) {
            matched = true
            score += trigger.priority * 3
          }
          break
        }
        case 'tag': {
          if (ctx.leadTags.includes(trigger.value)) {
            matched = true
            score += trigger.priority
          }
          break
        }
      }

      if (matched) {
        matchedTriggers.push(`${trigger.type}:${trigger.value}`)
      }
    }

    // Exclusion match zeroes the score
    for (const exclusion of this.props.exclusions) {
      const exclRegex = new RegExp(`\\b${this.escapeRegex(exclusion)}\\b`, 'i')
      if (exclRegex.test(ctx.message)) {
        score = 0
        break
      }
    }

    return { matches: score > 0, score, matchedTriggers }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  toJSON(): CapabilityProps {
    return { ...this.props }
  }

  static create(props: Omit<CapabilityProps, 'id' | 'createdAt' | 'updatedAt'>): Capability {
    return new Capability({
      ...props,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static restore(props: CapabilityProps): Capability {
    return new Capability(props)
  }
}
