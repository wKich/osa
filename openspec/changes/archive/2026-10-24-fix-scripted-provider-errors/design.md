# Design

The mock provider answers a `fail` turn with
`{"error":{"message":<message>,"type":"journey_error"}}` (`Response.json`, no
spaces), so the child builds the same string the real agent reads from that
body. The live run of both journeys now matches the offline run.
