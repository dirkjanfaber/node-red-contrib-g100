# node-red-contrib-g100

Node-RED node for UK **ENA EREC G100 Issue 2** (Customer Limitation Scheme) compliance. Tracks export and import excursions and enforces Stage 2 / Stage 3 lockout per the G100/2 specification.

## What is G100/2?

**G100/2** is short for **ENA Engineering Recommendation G100 Issue 2** — *"Technical Requirements for Customer Export and Import Limitation Schemes"* — published by the [Energy Networks Association](https://www.energynetworks.org/) (ENA), the UK body representing the electricity Distribution Network Operators (DNOs).

DNOs use it as a connection condition: when a site's generation (e.g. solar) or import capacity exceeds what the local network can absorb without reinforcement, the DNO can offer a connection anyway, on the condition that the site runs a **Customer Limitation Scheme (CLS)** — a control system that keeps the site's net import/export within agreed limits, and fails safe (disconnects) if that control breaks down. G100/2 defines exactly how that control system must behave, including the two limits it enforces:

- **MEL** — Maximum Export Limit (W): the most the site may export to the grid.
- **MIL** — Maximum Import Limit (W): the most the site may import from the grid.

Depending on how long and how often a limit is exceeded ("excursion"), a compliant CLS progresses through three stages:

| Stage | Meaning |
|-------|---------|
| 1 | Normal — within limits |
| 2 | Excursion tracking — threshold breaches counted; persists between excursions until counters are cleared or a reset is performed |
| 3 | Lockout — system must stop exporting/importing until reset |

An excursion escalates from Stage 2 to Stage 3 lockout when it is sustained for 1 minute, or repeats often enough (2+ excursions within any 10-minute window, or more than 3 within 24 hours) — see [`g100-state-machine.ts`](src/lib/g100-state-machine.ts) for the exact thresholds this node implements.

The regulation distinguishes **domestic** and **commercial** sites for how Stage 3 is cleared:
- **Domestic**: user can self-reset; limited to 3 resets in any 30-day period, after which an installer password is required.
- **Commercial**: installer-only reset (password required), or a 4-hour automatic timeout.

### How this node fits in

This node is the **CLS decision engine**, not the actuator. It consumes a grid power reading (e.g. from a Victron Grid Meter node), runs the G100/2 stage/timer/counter logic described above, and emits a `lockout` boolean plus a detailed status object. It does not itself open contactors, curtail an inverter, or throttle a charger — wiring that response (e.g. driving a Victron ESS/inverter setpoint or a relay) into your flow when `lockout` is `true` is up to you. This separation keeps the compliance logic testable and auditable independently of whatever hardware happens to be enforcing it.

For the authoritative specification text and exact timing/counter values, refer to the official document: [ENA EREC G100 Issue 2 Amendment 2 — Technical Requirements for Customer Export and Import Limitation Schemes](https://www.energynetworks.org/publications/ena-erec-g100-issue-2-amendment-2-technical-requirements-customer-export-and-import-limitation-schemes) (Energy Networks Association).

## Installation

In the palette manager, search for the `node-red-contrib-g100` package and
install it from there.

The node will appear in the **Victron Energy** category once the install completes — no manual restart needed.

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

To enable file context in Node-RED's `settings-user.js`:

```js
module.exports = {
    contextStorage: {
        default: {
            module: 'localfilesystem',
            config: {
                flushInterval: 30  // seconds — write state to disk every 30 s
            }
        }
    }
}
```

`flushInterval` controls how often Node-RED writes context to disk. Lower values reduce the window in which a crash could lose Stage 3 lockout state (a compliance risk); higher values reduce write frequency (useful on SD-card based systems such as Raspberry Pi). 30 seconds is a reasonable default; 300 seconds (5 minutes) is acceptable if SD-card wear is a concern.

## Requirements

- Node.js ≥ 18
- Node-RED ≥ 2.0

## License

MIT — see [LICENSE](LICENSE).
