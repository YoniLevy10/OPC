# PhoneKit

Shared mobile/PWA primitives for HQ, Tech, and Store shells.

## Usage

```tsx
import {
  PhoneShell,
  PhoneTabBar,
  PhoneActionDock,
  PhoneSheet,
  PhoneList,
  PhoneRow,
  PhoneStack,
} from '@/components/mobile'
```

## Tokens (`globals.css`)

- `--phone-tab-h` — bottom tab bar height (aliases `--bottomnav-h`)
- `--phone-dock-h` — action dock height
- `--phone-pad-b` — combined bottom padding helper via `.phone-pad-tab` / `.phone-pad-dock`

## Rules

- Screen agents **import** only — do not fork these components.
- Open sheets hide the action dock via `body:has([role=dialog]) .phone-action-dock`.
- Tech/Store: `PhoneActionDock` with `aboveTabBar={false}`. HQ: `aboveTabBar`.
