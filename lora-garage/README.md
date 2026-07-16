# LoRa Garage

A distributed garage monitoring and control system built with Shelly devices, Shelly LoRa Add-ons and Shelly BLU sensors.

## Architecture

The system consists of two independent Shelly nodes communicating through LoRa.

```text
              MQTT
               │
┌──────────────▲▼─────────────┐
│          Home Node          │
│           home.js           │
└──────────────▲▼─────────────┘
               │
               │ LoRa
               │
┌──────────────▲▼─────────────┐
│        Garage Node          │
│         garage.js           │
└──────────────▼──────────────┘
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
- Decrypt and validate payloads
- Publish events to MQTT
- Bridge LoRa data to Home Assistant and other MQTT consumers
- Monitor garage availability
- Process periodic state synchronization

### Garage Node

Script: `garage.js`

Responsibilities:

- Monitor garage door status
- Monitor lighting state
- Execute remote commands
- Send LoRa notifications
- Synchronize garage state
- Reply to status synchronization requests

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
COP  Cover opened
CCL  Cover closed
```

### State Synchronization

```text
SRQ Request status
O1 Cover opened, light ON
O0 Cover opened, light OFF
C1 Cover closed, light ON
C0 Cover closed, light OFF
U1 Cover status unknown, light ON
U0 Cover status unknown, light OFF
```

### Battery Status

```text
B4  Battery 100%
B3  Battery 75%
B2  Battery 50%
B1  Battery 25%
B0  Battery 0%
```

### System

```text
RBT  Remote reboot
```

## Security

All LoRa payloads are:

- AES-256 encrypted
- Checksum protected
- Validated before processing

Configure a KVS entry named `lora_aes_key` containing a 256-bit AES key.

Example:

```text
openssl rand -hex 32
```

## Event Driven Design

The garage node listens directly for BLU Door/Window events:

```text
bthomesensor:201
```

No polling is used for door state detection.
 
Garage state changes are transmitted automatically whenever the cover or light status changes, minimizing LoRa traffic and power consumption.

## MQTT Topics

The Home node publishes garage, cover, lighting and LoRa information using the configured MQTT topic prefix.

Examples:

```text
<topic_prefix>/garage/online
<topic_prefix>/garage/availability
<topic_prefix>/garage/last_seen

<topic_prefix>/cover/status
<topic_prefix>/cover/set

<topic_prefix>/light/status
<topic_prefix>/light/set

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
[2026-07-08 09:15:22] [INFO] LoRa MQTT Bridge started
[2026-07-08 09:15:49] [INFO] Cover opened
[2026-07-08 09:16:10] [INFO] Cover closed
```

## License

MIT License
