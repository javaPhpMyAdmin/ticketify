# Delta — data-access

> Change: `money-integrity`. The purchase write path persists the receipt's
> unit beside its amounts; the failure-path contract is untouched.

## MODIFIED Requirements

### Requirement: Purchase Writes Persist Real Rows

Purchase and receipt writes MUST persist real rows for the signed-in user: the
save action inserts the `purchases` row — including the receipt's currency
unit (`currency-universality` REQ-8) — and its `purchase_items` rows. The
edit path MUST persist unit corrections under the same catalog rule as the
save path: a code inside `SUPPORTED_CURRENCIES` is stored (normalized), a
code outside it is stored as no unit and MUST NOT fail the edit, and a draft
that carries no unit leaves the stored unit untouched (the update payload
omits the column). Relabel only — an edit never rewrites amounts because of a
unit change. The client MUST resolve item category slugs to `categories.id`
uuids before inserting. Storage upload for the ticket image stays out of
scope in this change. A failed write MUST surface a detectable error state
and MUST NOT report success.

(Previously: the insert carried amounts only, with no unit — a foreign receipt
persisted as a bare number and inherited the viewer's label at read time.)

#### Scenario: Purchase save persists rows with their unit

- GIVEN a signed-in user saving a receipt whose unit is `CLP`
- WHEN the user triggers purchase save
- THEN a `purchases` row is inserted for the user carrying unit `CLP`
- AND its `purchase_items` rows are inserted with resolved `category_id` uuids
- AND the save returns the new purchase id

#### Scenario: Purchase save failure

- GIVEN a write that fails (network, constraint, missing session)
- WHEN the user triggers purchase save
- THEN a detectable error state is surfaced
- AND no partial success is reported

#### Scenario: Purchase edit persists a unit correction

- GIVEN a signed-in user editing a stored receipt whose unit is `CLP`
- WHEN the user switches the unit to `UYU` on review and confirms the edit
- THEN the `purchases` row carries unit `UYU`
- AND every amount on the row is unchanged (relabel only)
- AND a draft unit outside `SUPPORTED_CURRENCIES` is stored as no unit while
  the edit still succeeds
- AND a draft with no unit leaves the stored unit untouched
