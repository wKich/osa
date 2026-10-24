# Design

The translator keeps one step per Maki run but mirrors OpenCode's attempt
structure around retries: each `api_retry` marks a retry pending, and the next
frame of the attempt (a stream event, a buffered message, or a further
retry) restarts the step on the same message id first. Remaining
differences are Maki's own error wording (`API error (<status>): <body>`,
`Server error (503)`), accepted on the journeys.
