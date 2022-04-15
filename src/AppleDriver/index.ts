/*
|--------------------------------------------------------------------------
| Apple Ally Oauth driver
|--------------------------------------------------------------------------
|
| This is a Ally Oauth Driver for Apple
|
*/

import type {
  AllyUserContract,
  ApiRequestContract,
  LiteralStringUnion,
  RedirectRequestContract,
} from '@ioc:Adonis/Addons/Ally'
import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import { Oauth2Driver, OauthException } from '@adonisjs/ally/build/standalone'
import JWKS, { CertSigningKey, JwksClient, RsaSigningKey } from 'jwks-rsa'
import { DateTime } from 'luxon'
import JWT from 'jsonwebtoken'

/**
 * Shape of Apple Access Token
 */
export type AppleAccessToken = {
  token: string
  type: string
  id_token: string
  refreshToken: string
  expiresIn: number
  expiresAt: DateTime
}

/**
 * Allowed Apple Sign In scopes
 */
export type AppleScopes = 'email' | 'string'

/**
 * Shape of the user returned from Apple
 */
export interface AppleUserContract extends Omit<AllyUserContract<AppleAccessToken>, 'token'> {}

/**
 * Shape of the Apple decoded token
 * https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js/incorporating_sign_in_with_apple_into_other_platforms
 */
export type AppleTokenDecoded = {
  iss: string
  aud: string
  exp: number
  iat: number
  sub: string
  at_hash: string
  email: string
  email_verified: 'true' | 'false'
  user?: {
    email?: string
    name?: {
      firstName: string
      lastName: string
    }
  }
  is_private_email: boolean
  auth_time: number
  nonce_supported: boolean
}

/**
 * Options available for Apple
 * @param appId App ID of your app
 * @param teamId Team ID of your Apple Developer Account
 * @param clientId Key ID, received from https://developer.apple.com/account/resources/authkeys/list
 * @param clientSecret Private key, downloaded from https://developer.apple.com/account/resources/authkeys/list
 */
export type AppleDriverConfig = {
  driver: 'apple'
  appId: string
  teamId: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  scopes?: LiteralStringUnion<AppleScopes>[]
}

/**
 * Apple Driver implementation
 */
export class AppleDriver extends Oauth2Driver<AppleAccessToken, AppleScopes> {
  /**
   * The URL for the redirect request. The user will be redirected on this page
   * to authorize the request.
   */
  protected authorizeUrl = 'https://appleid.apple.com/auth/authorize'

  /**
   * The URL to hit to exchange the authorization code for the access token
   */
  protected accessTokenUrl = 'https://appleid.apple.com/auth/token'

  /**
   * JWKS Client, it is used in Apple key verification process
   */
  protected jwksClient: JwksClient | null = null

  /**
   * The param name for the authorization code. Read the documentation of your oauth
   * provider and update the param name to match the query string field name in
   * which the oauth provider sends the authorization_code post redirect.
   */
  protected codeParamName = 'code'

  /**
   * The param name for the error. Read the documentation of your oauth provider and update
   * the param name to match the query string field name in which the oauth provider sends
   * the error post redirect
   */
  protected errorParamName = 'error'

  /**
   * Cookie name for storing the CSRF token. Make sure it is always unique. So a better
   * approach is to prefix the oauth provider name to `oauth_state` value. For example:
   * For example: "facebook_oauth_state"
   */
  protected stateCookieName = 'apple_oauth_state'

  /**
   * Parameter name to be used for sending and receiving the state from.
   * Read the documentation of your oauth provider and update the param
   * name to match the query string used by the provider for exchanging
   * the state.
   */
  protected stateParamName = 'state'

  /**
   * Parameter name for sending the scopes to the oauth provider.
   */
  protected scopeParamName = 'scope'

  /**
   * The separator indentifier for defining multiple scopes
   */
  protected scopesSeparator = ' '

  constructor(ctx: HttpContextContract, public config: AppleDriverConfig) {
    super(ctx, config)

    /**
     * Initiate JWKS client
     */
    this.jwksClient = JWKS({
      rateLimit: true,
      cache: true,
      cacheMaxEntries: 100,
      cacheMaxAge: 1000 * 60 * 60 * 24,
      jwksUri: 'https://appleid.apple.com/auth/keys',
    })

    /**
     * Extremely important to call the following method to clear the
     * state set by the redirect request.
     */
    this.loadState()
  }

  /**
   * Optionally configure the authorization redirect request. The actual request
   * is made by the base implementation of "Oauth2" driver and this is a
   * hook to pre-configure the request.
   */
  protected configureRedirectRequest(request: RedirectRequestContract<AppleScopes>) {
    /**
     * Define user defined scopes or the default one's
     */
    request.scopes(this.config.scopes || ['email'])

    request.param('client_id', this.config.appId)
    request.param('response_type', 'code')
    request.param('response_mode', 'form_post')
    request.param('grant_type', 'authorization_code')
  }

  /**
   * Update the implementation to tell if the error received during redirect
   * means "ACCESS DENIED".
   */
  public accessDenied() {
    return this.ctx.request.input('error') === 'user_denied'
  }

  /**
   * Get Apple Signning Keys to verify token
   * @param token an id_token receoived from Apple
   * @returns signing key
   */
  protected async getAppleSigningKey(token): Promise<string> {
    const decodedToken = JWT.decode(token, { complete: true })
    const key = await this.jwksClient?.getSigningKey(decodedToken?.header.kid)
    return (key as CertSigningKey)?.publicKey || (key as RsaSigningKey)?.rsaPublicKey
  }

  /**
   * Generates Client Secret
   * https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
   * @returns clientSecret
   */
  protected generateClientSecret(): string {
    const clientSecret = JWT.sign({}, this.config.clientSecret, {
      algorithm: 'ES256',
      keyid: this.config.clientId,
      issuer: this.config.teamId,
      audience: 'https://appleid.apple.com',
      subject: this.config.appId,
      expiresIn: 60,
      header: { alg: 'ES256', kid: this.config.clientId },
    })
    return clientSecret
  }

  /**
   * Parses user info from the Apple Token
   */
  protected async getUserInfo(token: string): Promise<AppleUserContract> {
    const signingKey = await this.getAppleSigningKey(token)
    const decodedUser = JWT.verify(token, signingKey, {
      issuer: 'https://appleid.apple.com',
      audience: this.config.appId,
    })
    const firstName = (decodedUser as AppleTokenDecoded)?.user?.name?.firstName || ''
    const lastName = (decodedUser as AppleTokenDecoded)?.user?.name?.lastName || ''

    return {
      id: (decodedUser as AppleTokenDecoded).sub,
      avatarUrl: null,
      original: null,
      nickName: (decodedUser as AppleTokenDecoded).sub,
      name: `${firstName}${lastName ? ` ${lastName}` : ''}`,
      email: (decodedUser as AppleTokenDecoded).email,
      emailVerificationState:
        (decodedUser as AppleTokenDecoded).email_verified === 'true' ? 'verified' : 'unverified',
    }
  }

  /**
   * Get access token
   */
  public async accessToken(
    callback?: (request: ApiRequestContract) => void
  ): Promise<AppleAccessToken> {
    /**
     * We expect the user to handle errors before calling this method
     */
    if (this.hasError()) {
      throw OauthException.missingAuthorizationCode(this.codeParamName)
    }

    /**
     * We expect the user to properly handle the state mis-match use case before
     * calling this method
     */
    if (this.stateMisMatch()) {
      throw OauthException.stateMisMatch()
    }

    return this.getAccessToken((request) => {
      request.header('Content-Type', 'application/x-www-form-urlencoded')
      request.field('client_id', this.config.appId)
      request.field('client_secret', this.generateClientSecret())
      request.field(this.codeParamName, this.getCode())

      if (typeof callback === 'function') {
        callback(request)
      }
    })
  }

  /**
   * Returns details for the authorized user
   */
  public async user(callback?: (request: ApiRequestContract) => void) {
    const token = await this.accessToken(callback)
    const user = await this.getUserInfo(token.id_token)

    return {
      ...user,
      token,
    }
  }

  /**
   * Finds the user by the access token
   */
  public async userFromToken(token: string) {
    const user = await this.getUserInfo(token)

    return {
      ...user,
      token: { token, type: 'bearer' as const },
    }
  }
}
