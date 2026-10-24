# Design

The translator already kept the queued turn order; it now also owns the
write: `startTurn` calls a `deliver` hook that sends the prompt (text and
image blocks) to the child. A prompt that starts at once is delivered in the
same call, so the child sees exactly what it saw before, in the same order;
only a waiting prompt is held. Cancel follows the real handler: an unknown
or already delivered item answers 204 with no frame
(`server/src/handlers/session.ts` v2.0.32 L552–L560). The 409 uses the pinned
`ConflictError` body.
