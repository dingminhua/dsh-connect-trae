/**
 * Failure classification shared by the Host's HTTP routes.
 *
 * Issue #66: the model-refresh route wrapped EVERY thrown error as HTTP 500.
 * A US credential sent to the Singapore gateway answers `401`, that 401 became
 * `{"error":"SOLO remote models returned HTTP 401"}` under status 500, and the
 * card could only say "HTTP 500" — so a region/routing problem was
 * indistinguishable from a plugin crash, and the user re-signed-in instead of
 * looking at the region.
 *
 * The fix is deliberately narrow: upstream HTTP verdicts and the local
 * "region not served" verdict keep their meaning when they cross the route
 * boundary. Only failures that carry no status of their own stay 500.
 *
 * @module dsh-connect-trae/failure
 */

import { TraeUnsupportedRegionError, TRAE_UNSUPPORTED_REGION_CODE } from './region.ts'

/** Code for an upstream that refused the credential (401 / 403). */
export const TRAE_AUTH_FAILURE_CODE = 'authentication'
/** Code for any other upstream HTTP verdict (4xx/5xx that is not auth). */
export const TRAE_UPSTREAM_FAILURE_CODE = 'upstream'

/**
 * A non-2xx answer from a Trae gateway, carrying the status the gateway
 * actually sent.
 *
 * Plain `Error`s are still allowed everywhere (and stay 500 at the route); this
 * class exists so the paths that DO know an upstream status can pass it on
 * instead of leaving it buried in a message string.
 */
export class TraeHttpError extends Error {
  override name = 'TraeHttpError'
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export interface TraeHttpFailure {
  /** HTTP status this Host answers with. */
  status: number
  /** Machine-readable reason, when one applies. */
  code?: typeof TRAE_AUTH_FAILURE_CODE | typeof TRAE_UNSUPPORTED_REGION_CODE | typeof TRAE_UPSTREAM_FAILURE_CODE
}

/**
 * Map a thrown failure onto the Host's HTTP answer.
 *
 *  - a region this build does not serve → `501` + `unsupported-region`
 *    (the request is well-formed; this build simply has no route for it);
 *  - an upstream 401/403 → the SAME status + `authentication`, so the client
 *    can distinguish "sign in again" from "the plugin broke";
 *  - any other upstream status → passed through verbatim + `upstream`;
 *  - anything else (a programming error, a transport failure) → `500`.
 */
export function httpFailureOf(error: unknown): TraeHttpFailure {
  if (error instanceof TraeUnsupportedRegionError) {
    return { status: 501, code: TRAE_UNSUPPORTED_REGION_CODE }
  }
  if (error instanceof TraeHttpError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 502
    if (status === 401 || status === 403) return { status, code: TRAE_AUTH_FAILURE_CODE }
    return { status, code: TRAE_UPSTREAM_FAILURE_CODE }
  }
  return { status: 500 }
}
