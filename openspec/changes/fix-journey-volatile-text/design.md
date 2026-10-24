# Design

Both rules are narrow: the footer rule applies only after the normalized
model token and ` · `; the clock rule only shortens whitespace in front of an
already-normalized `<TIME>`. A full `make test-journeys` before the clock rule
left every other snapshot byte-identical.
