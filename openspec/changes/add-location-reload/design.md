# Design

Restarting idle children to make Maki re-read its own config would drop its
session-scoped permission rules, which a reload must not do silently; that
part stays with Maki.
