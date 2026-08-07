# Second live contract: Michigan OptumRx 220000001116

Tracking epic: #5  
Milestone: Second live contract: Michigan OptumRx  
Branch: `cursor/michigan-live-contract`

## Contract choice

Glass already runs Wisconsin ETF / Navitus **ETG0013** as a pass-through live book. The second contract is the public traditional spread agreement already encoded as a comparator:

- **ID:** `mi-220000001116`
- **Name:** Contract 220000001116
- **PBM:** OptumRx
- **Sponsor (source):** State of Michigan (DTMB)
- **Model:** `Traditional`
- **Module:** `src/lib/contracts/michigan.ts`
- **PDF:** https://www.michigan.gov/dtmb/-/media/Project/Websites/dtmb/Procurement/Contracts/014/220000001116.pdf

Schedule B **client** rates are published and citable. **Pharmacy** network rates are not public; Glass models them and must keep that badge everywhere they appear (including `MODELED_CLIENT_MAC_MULTIPLIER`).

## Why not another PBM

No other full public traditional rate card is encoded in-repo. Michigan is the strongest published non-passthrough option we already trust enough to seed.

## Implementation sequence

1. Un-hardcode Wisconsin-only load paths (#6)
2. Seed a Michigan utilisation book (#7)
3. Fix settlement/reports for spread (#8)
4. UI switcher + citations (#9)
5. Invariant split + fixtures (#10)
6. Agent/tool contract awareness (#11)

Wisconsin remains the default pass-through demo unless product decides otherwise.
