The package has been configured successfully!

Make sure to first define the mapping inside the `contracts/ally.ts` file as follows.

```ts
import { AppleDriver, AppleDriverConfig } from '@bitkidd/ally-apple/build/standalone'

declare module '@ioc:Adonis/Addons/Ally' {
  interface SocialProviders {
    // ... other mappings
    yourDriver: {
      config: AppleDriverConfig
      implementation: AppleDriver
    }
  }
}
```

And add new environment variables inside `ent.ts`:

```ts
APPLE_KEY: Env.schema.string(),
APPLE_KEY_ID: Env.schema.string(),
APPLE_TEAM_ID: Env.schema.string(),
APPLE_CLIENT_ID: Env.schema.string(),
```
