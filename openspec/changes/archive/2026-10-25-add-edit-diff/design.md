# Design

Reading the file before Maki runs the edit would race Maki itself; undoing
the replacement afterwards is exact when the new text occurs once. Fuzzy
quote matching in Maki can make the replaced text differ slightly from
`old_string`; the diff then shows `old_string`, the text the model asked to
replace. MultiEdit, insert and Write are not reconstructed.
