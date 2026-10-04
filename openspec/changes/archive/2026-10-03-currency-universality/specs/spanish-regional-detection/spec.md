# Delta — spanish-regional-detection

> Change: `currency-universality`. 1 requirement added (REQ-7), 1 NFR added
> (NFR-3), 1 acceptance gate added. No existing requirement is modified: the
> `detectLocale` mapping table is unchanged by this change, which is itself the
> contract NFR-3 pins.

## ADDED Requirements

### REQ-7: Region-code resolution is one shared, pure contract

The system SHALL expose the region-resolution step used by both `detectLocale`
and `detectDefaultCurrency`: it normalizes a BCP-47 or Apple tag (underscores
to hyphens, case-insensitive), locates a region that is either two alpha
characters or a three-digit UN M.49 code, skips private-use singletons, and
lets an explicitly supplied `regionCode` win over any region inline in the tag.
A tag carrying no region SHALL resolve to no region. The step SHALL be pure and
free of `Intl.*`. It SHALL NOT be re-implemented per consumer.

(Previously: normalization existed only as private helpers (`splitTag`,
`resolveRegion`) inside `detectLocale`, so a second consumer would have had to
duplicate the parsing rules. This delta promotes the step to a named,
assertable contract without changing any `detectLocale` behavior.)

**Given/When/Then**:

1. Given `es_ES`, When the region resolver runs, Then it yields `ES` (case is normalized away).
2. Given `es`, When the region resolver runs, Then it yields no region.
3. Given `es-419`, When the region resolver runs, Then it yields `419` (a three-digit UN M.49 code is a region, not a variant).
4. Given `es-Ar-x-private`, When the region resolver runs, Then it yields `ar` (the private-use singleton is skipped).
5. Given `es-MX` with an explicit `regionCode` of `AR`, When the resolver runs, Then it yields `AR` (explicit region wins).
6. Given `undefined` or an empty tag, When the resolver runs, Then it yields no region.
7. Given `detectDefaultCurrency` consumes this resolver, When it is handed the tag `es_MX` with no explicit region, Then it derives `MX` from the tag and returns `MXN` — the same normalization, the same answer, no second parser.

## ADDED Non-Functional Requirements

### NFR-3: One region resolver, two consumers

The region-resolution step SHALL have exactly one implementation. `detectLocale`
and `detectDefaultCurrency` MUST NOT each normalize regions independently, and
any change to normalization semantics SHALL be pinned by both harnesses.

## Acceptance Gates

6. The shared region resolver's cases pass for both consumers, and the `detectLocale` mapping table is byte-identical before and after `detectDefaultCurrency` ships (`en-GB` + region `GB` still resolves to `en`).

## Non-goals

- This capability does NOT own the region → currency mapping table, the
  supported currency set, the symbol table, or the default-currency seed. Those
  live in `currency-universality`.
- `detectLocale` does NOT become region-driven. English and Portuguese stay
  un-regionalized by design (harness pin: `en-US` + region `AR` → `en`).
