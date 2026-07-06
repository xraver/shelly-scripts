# LoRa Garage

A distributed garage monitoring and control solution built with Shelly devices, Shelly LoRa Add-ons and Shelly BLU sensors.

## Architecture

The system consists of two independent Shelly nodes communicating through LoRa.

```text
┌─────────────────────┐
│     Home Node       │
│      home.js        │
├─────────────────────┤
│ MQTT Integration    │
│ LoRa Receiver       │
│ State Publishing    │
└─────────┬───────────┘
          │ LoRa
          │
┌─────────▼───────────┐
│    Garage Node      │
│     garage.js       │
├─────────────────────┤
│ Door Monitoring     │
│ Command Execution   │
│ State Reporting     │
└─────────────────────┘
```

## Components

### Home Node

Script: `home.js`

Responsibilities:

- Receive LoRa messages
- Verify encrypted payloads
- Publish events to MQTT
- Publish heartbeat information
- Bridge LoRa data to Home Assistant or other MQTT consumers

### Garage Node

Script: `garage.js`

Responsibilities:

- Monitor garage door status
- Monitor lighting state
- Execute remote commands
- Send LoRa notifications
- Synchronize garage state

## Hardware

### Home

- Shelly Gen4 device
- Shelly LoRa Add-on

### Garage

- Shelly Gen4 device
- Shelly LoRa Add-on
- Shelly BLU Door/Window sensor

## Communication Protocol

### Lighting

```text
LON  Light ON
LOF  Light OFF
```

### Cover Control

```text
CTG  Toggle cover
CAK  Command acknowledged
```

### Cover Status

```text
CST  Request status
COP  Cover opened
CCL  Cover closed
```

## Security

All payloads are:

- AES encrypted
- Checksum protected
- Validated before processing

Messages with invalid checksums or invalid decryption results are discarded.

## Event Driven Design

The garage node listens directly for BLU Door/Window events:

```text
bthomesensor:201
```

No polling is used.

The current cover status is transmitted automatically whenever a state change is detected.

## MQTT Topics

The Home node publishes LoRa information using the configured MQTT topic prefix.

Examples:

```text
<topic_prefix>/lora/online
<topic_prefix>/lora/heartbeat
<topic_prefix>/lora/raw_rx
<topic_prefix>/lora/raw_tx
```

## Logging

Supported log levels:

```javascript
LOG_ERROR
LOG_WARN
LOG_INFO
LOG_DEBUG
```

Example:

```text
[2026-07-08 09:15:22] [INFO] LoRa Remote Node started
[2026-07-08 09:15:49] [INFO] Cover opened
[2026-07-08 09:16:10] [INFO] Cover closed
```

## License

MIT License