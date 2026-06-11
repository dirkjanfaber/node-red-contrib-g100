# node-red-contrib-g100

Node-RED node for UK **ENA EREC G100 Issue 2** (Customer Limitation Scheme) compliance. Tracks export and import excursions and enforces Stage 2 / Stage 3 lockout per the G100/2 specification.

## What is G100/2?

G100/2 is a UK technical regulation that governs how distributed energy resources (solar, batteries, EVs) must behave when they exceed agreed grid import or export limits. Depending on how long and how often a limit is exceeded, the system progresses through three stages:

| Stage | Meaning |
|-------|---------|
| 1 | Normal — within limits |
| 2 | Excursion tracking — threshold breaches counted; persists between excursions until counters are cleared or a reset is performed |
| 3 | Lockout — system must stop exporting/importing until reset |

The regulation distinguishes **domestic** and **commercial** sites:
- **Domestic**: user can self-reset; limited to 3 resets in any 30-day period.
- **Commercial**: installer-only reset (password required); 4-hour lockout minimum.

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-g100
```

Restart Node-RED. The node will appear in the **Victron Energy** category.

## Node: g100

### Inputs

| Topic | Payload | Description |
|-------|---------|-------------|
| *(default)* | `number` | Grid power in Watts. Positive = import, negative = export. |
| `acSource` | `1` / other | `1` = grid is the active AC source. Other values (generator, shore) suspend enforcement. |
| `reset` | `{ password?: number }` | Attempt a reset. Domestic: no password needed. Commercial: installer password required. |

### Outputs

| # | Payload | Description |
|---|---------|-------------|
| 1 | `boolean` | Lockout state — only emitted when the value changes. |
| 2 | `G100Output` object | Full status on every input message (stage, counts, timestamps, resetEligible). |

### Configuration

| Field | Default | Description |
|-------|---------|-------------|
| MEL (W) | `-3500` | Maximum Export Limit in Watts (negative). Set to the agreed export limit. |
| Enable MIL | off | Enable import limiting as well. |
| MIL (W) | `12500` | Maximum Import Limit in Watts (positive). |
| Mode | `domestic` | `domestic` or `commercial`. Controls reset policy. |
| Allow end-user reset | on | Domestic only: show a reset button to end users. |
| Installer password | `0` | Commercial only: 4-digit password for installer resets. |
| Debug | off | Attaches full internal state to output 2 messages (`msg.state`). |

### Persistence

State (excursion counters, lockout status, Stage 3 timestamps) is stored in Node-RED **file context** so it survives restarts. The node warns on deploy if context storage is not configured for file persistence.

To enable file context in Node-RED's `settings.js`:

```js
contextStorage: {
    default: {
        module: 'localfilesystem'
    }
}
```

## Requirements

- Node.js ≥ 18
- Node-RED ≥ 2.0

## License

MIT — see [LICENSE](LICENSE).
