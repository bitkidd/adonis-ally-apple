import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

export default class AppleDriverProvider {
  constructor(protected app: ApplicationContract) {}

  public async boot() {
    const Ally = this.app.container.resolveBinding('Adonis/Addons/Ally')
    const { AppleDriver } = await import('../src/AppleDriver')

    Ally.extend('apple', (_, __, config, ctx) => {
      return new AppleDriver(ctx, config)
    })
  }
}
