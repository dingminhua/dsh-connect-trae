export type TraeUpstreamErrorKind =
  | 'authentication'
  | 'hard_credit'
  | 'soft_rate'
  | 'not_found'
  | 'server'
  | 'client'
  | 'unconfigured'

export type TraeChatResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; kind: TraeUpstreamErrorKind; message: string }

/**
 * A failure Trae reported INSIDE an already-200 SSE body, once the answer has
 * started crossing the loopback boundary.
 *
 * Issue #85 is why this is a class rather than a plain `Error`. A refusal that
 * arrives before any output can still become a real HTTP status, but one that
 * arrives after the headers and the first bytes are gone cannot: the only
 * remaining channel is the stream itself. The shim therefore has to tell
 * "the upstream throttled this request" apart from "the socket died", and it
 * gets that from `kind`/`status` here — the message text alone would have made
 * it guess.
 *
 * `traeCode` is Trae's own numeric code (`3004` for the shared-queue rate
 * limit), kept separate from `kind` so a log line can name the upstream code
 * without the plugin's reading of it.
 */
export class TraeStreamFailure extends Error {
  override name = 'TraeStreamFailure'

  constructor(
    message: string,
    readonly kind: TraeUpstreamErrorKind,
    readonly status: number,
    readonly traeCode?: number,
  ) {
    super(message)
  }
}

export interface TraeUpstreamClient {
  chatStream(bodyJson: string, signal?: AbortSignal): Promise<TraeChatResult>
}

/**
 * Safe first-stage upstream. Real Trae traffic stays disabled until one
 * edition-specific endpoint and wire codec are verified with fixtures.
 */
export class UnconfiguredTraeUpstreamClient implements TraeUpstreamClient {
  async chatStream(_bodyJson: string, _signal?: AbortSignal): Promise<TraeChatResult> {
    return {
      ok: false,
      status: 503,
      kind: 'unconfigured',
      message: 'Trae upstream protocol is not configured; complete offline protocol verification first',
    }
  }
}
