# LoRa Garage

A distributed garage monitoring and control solution built with Shelly devices, Shelly LoRa Add-ons and Shelly BLU sensors.

## Architecture

The system consists of two independent Shelly nodes communicating through LoRa.

```text
              MQTT
               ⇅
┌─────────────────────────────┐
│          Home Node          │
│           home.js           │
└──────────────⇅──────────────┘
               │
               │ LoRa
               │
┌──────────────⇅──────────────┐
│        Garage Node          │
│         garage.js           │
└──────────────┬──────────────┘
               │
               │ BLE / BTHome
               │
┌──────────────▲──────────────┐
│  Shelly BLU Door / Window   │
└─────────────────────────────┘
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
- Process periodic state synchronization

### Garage Node

Script: `garage.js`

Responsibilities:

- Monitor garage door status
- Monitor lighting state
- Execute remote commands
- Send LoRa notifications
- Synchronize garage state
- Send periodic state synchronization

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

### State Synchronization

```text
O1  Cover opened, light ON
O0  Cover opened, light OFF
C1  Cover closed, light ON
C0  Cover closed, light OFF
```

## Security

All payloads are:

- AES encrypted: configure a KVS entry named lora_aes_key containing a 256-bit AES key. Example: openssl rand -hex 32
- Checksum protected
- Validated before processing

Messages with invalid checksums or invalid decryption results are discarded.

## Event Driven Design

The garage node listens directly for BLU Door/Window events:

```text
bthomesensor:201
```

No polling is used.

Garage state changes are transmitted automatically whenever the cover or light status changes.

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
