/**
 * @title LoRa Garage - Home Controller
 * @description Home node responsible for MQTT integration, LoRa message reception and state distribution.
 * @status production
 * @author Giorgio Ravera
 * @date 08/07/2026
 * @version 1.0
 *
 * Responsibilities:
 * - Receive encrypted LoRa messages
 * - Verify message integrity
 * - Bridge LoRa events to MQTT
 * - Publish node heartbeat
 * - Publish garage and lighting events
 *
 * Hardware:
 * - Shelly Gen4 device
 * - Shelly LoRa Add-on
 *
 * Related:
 * - garage.js
 */

// Log Level
const LOG_ERROR = 0;
const LOG_WARN  = 1;
const LOG_INFO  = 2;
const LOG_DEBUG = 3;
const LOG_LEVEL = LOG_INFO;

// LoRa Parameters
const cfgAesKey = 'lora_aes_key';
let aesKey = null;
const CHECKSUM_SIZE = 4;
const LORA_PEER_ID = 100;
const ENABLE_HEARTBEAT = false; // enable periodic heartbeat message
const LORA_HEARTBEAT_INTERVAL = 600000; // 10 min

/* Garage Synchronization */
const GARAGE_TIMEOUT = 7200000; // 2h
const GARAGE_REQUEST_INTERVAL = GARAGE_TIMEOUT/2; // 1h
const GARAGE_UPDATE_INTERVAL = GARAGE_TIMEOUT/2; // 1h
const GARAGE_CHECK_INTERVAL = 600000; // 10 min
/* Garage Status Sync: Local polling or remote update? */
const GARAGE_ENABLE_STATUS_REQUEST = false; // enable periodic status request
const GARAGE_ENABLE_STATUS_SEND = !GARAGE_ENABLE_STATUS_REQUEST; // enable periodic status transmission

/* Protocol Messages - Lights */
const msg_light_on      = "LON";
const msg_light_off     = "LOF";
/* Protocol Messages - Cover */
const msg_cover_toggle  = "CTG";
const msg_cover_ack     = "CAK";
const msg_cover_opened  = "COP";
const msg_cover_closed  = "CCL";
/* Protocol Messages - Status */
const msg_status_request           = "SRQ";
const msg_status_open_light_on     = "O1";
const msg_status_open_light_off    = "O0";
const msg_status_closed_light_on   = "C1";
const msg_status_closed_light_off  = "C0";
const msg_status_unknown_light_on  = "U1";
const msg_status_unknown_light_off = "U0";
/* Reboot */
const msg_remote_reboot = "RBT";

// MQTT configuration
let mqttCfg;
let mqttPrefix;

/* Garage Last Seen timestamp */
let lastGarageSeen = 0;

/* Init */
function init() {
  /* Init */
  log(LOG_INFO, "LoRa MQTT Bridge started");

  /* load AES key from shelly configuration */
  loadAesKey();

  /* Init MQTT */
  initMQTT();

  /* Periodically check garage online status */
  Timer.set(
    GARAGE_CHECK_INTERVAL,
    true,
    checkOnlineStatus
  );

  /* Periodically request garage status */
  if(GARAGE_ENABLE_STATUS_REQUEST) {
    Timer.set(
      GARAGE_REQUEST_INTERVAL,
      true,
      requestUpdate
    );
  }

  /* Force status request after bootstrap */
  Timer.set(
    10000,
    false,
    requestUpdate
  );

  log(LOG_INFO, "Garage request interval set to " + GARAGE_REQUEST_INTERVAL + " ms");
  log(LOG_INFO, "Garage check interval set to " + GARAGE_CHECK_INTERVAL + " ms");
}

/* Function to load AES key from Shelly configuration */
function loadAesKey() {
  /* get AES key */
  Shelly.call(
    "KVS.Get",
    {
      key: cfgAesKey
    },
    function(result, error_code, error_message) {

      if (error_code !== 0) {
        throw new Error(
          "FATAL: unable to load lora_aes_key: " +
          error_message
        );
      }

      log(LOG_INFO, "AES Key loaded");
      log(
        LOG_DEBUG,
        "AES Key: " + result.value.substr(0, 8) + "..."
      );

      aesKey = result.value;
    }
  );
}

/* get current data & time */
function now() {
  let d = new Date();

  function pad(v) {
    return v < 10 ? "0" + v : "" + v;
  }

  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds())
  );
}

/* Log Function */
function log(level, msg) {

  if (level > LOG_LEVEL) {
    return;
  }

  let levelText = "INFO";

  switch (level) {
    case LOG_ERROR:
      levelText = "ERROR";
      break;

    case LOG_WARN:
      levelText = "WARN";
      break;

    case LOG_INFO:
      levelText = "INFO";
      break;

    case LOG_DEBUG:
      levelText = "DEBUG";
      break;
  }

  console.log(
    "[" + now() + "] " +
    "[" + levelText + "] " +
    msg
  );
}

/* Initialize MQTT Commands */
function initMQTT() {

  // Get MQTT prefix from config
  mqttCfg = Shelly.getComponentConfig("mqtt");
  mqttPrefix = mqttCfg.topic_prefix;
  if (!mqttPrefix || mqttPrefix === "") {
    mqttPrefix = Shelly.getDeviceInfo().id;
  }

  if (!MQTT.isConnected()) {
    log(LOG_WARN, "MQTT not connected");
    return;
  }

  /* Publish device data to homeassistant via MQTT */
  publishHADiscovery();

  if (ENABLE_HEARTBEAT) {
    mqttPublish("/lora/heartbeat", new Date().toISOString(), true);

    /* Refresh status */
    Timer.set(LORA_HEARTBEAT_INTERVAL, true, function() {
      mqttPublish("/lora/heartbeat", new Date().toISOString(), true);
    });
  }

  MQTT.subscribe(
    mqttPrefix + "/cover/set",
    function(topic, message) {

      log(
        LOG_INFO,
        "[MQTT] " + topic + " = " + message
      );

      if (message === "TOGGLE") {
        sendMessage(msg_cover_toggle);
      }
    }
  );

  MQTT.subscribe(
    mqttPrefix + "/light/set",
    function(topic, message) {

      log(
        LOG_INFO,
        "[MQTT] " + topic + " = " + message
      );

      if (message === "ON") {
        sendMessage(msg_light_on);
      }

      if (message === "OFF") {
        sendMessage(msg_light_off);
      }
    }
  );

  /* Bridge Reboot */
  MQTT.subscribe(
    mqttPrefix + "/system/reboot_bridge",
    function(topic, message) {

      if (message !== "REBOOT") {
        return;
      }

      log(LOG_WARN, "Bridge reboot requested");

      Shelly.call(
        "Shelly.Reboot",
        {},
        function(_, error_code, error_message) {
          if (error_code !== 0) {
            log(
              LOG_ERROR,
              "Reboot failed: " + error_message
            );
          }
        }
      );
    }
  );

  /* Garage Reboot */
  MQTT.subscribe(
    mqttPrefix + "/system/reboot_garage",
    function(topic, message) {

      if (message !== "REBOOT") {
        return;
      }

      log(LOG_WARN, "Garage reboot requested");

      sendMessage(msg_remote_reboot);
    }
  );

  log(LOG_INFO, "MQTT subscriptions active");
}

/* MQTT Publish */
function mqttPublish(topic, payload, retain) {
  if (!MQTT.isConnected()) {
    log(LOG_WARN, "MQTT not connected");
    return;
  }

  MQTT.publish(
    mqttPrefix + topic,
    payload,
    0,
    retain
  );
}

/* Home Assistant MQTT Discovery */
function publishHADiscovery() {

  const device = {
    identifiers: ["garage_lora"],
    manufacturer: "Shelly",
    model: "Gen4 + LoRa Add-on",
    name: "Garage LoRa"
  };

  /* Light */
  MQTT.publish(
    "homeassistant/light/garage_light/config",
    JSON.stringify({
      name: "Luce Garage",
      uniq_id: "garage_light",
      device: device,
      cmd_t: mqttPrefix + "/light/set",
      stat_t: mqttPrefix + "/light/status",
      pl_on: "ON",
      pl_off: "OFF"
    }),
    0,
    true
  );

  /* Cover */
  MQTT.publish(
    "homeassistant/cover/garage_cover/config",
    JSON.stringify({
      name: "Serranda Garage",
      uniq_id: "garage_cover",
      device: device,
      cmd_t: mqttPrefix + "/cover/set",
      stat_t: mqttPrefix + "/cover/status",
      pl_open: "TOGGLE",
      pl_cls: "TOGGLE"
    }),
    0,
    true
  );

  /* Cover Button */
  MQTT.publish(
    "homeassistant/button/garage_pulse/config",
    JSON.stringify({
      name: "Pulsante Serranda Garage",
      uniq_id: "garage_pulse",
      device: device,
      cmd_t: mqttPrefix + "/cover/set",
      pl_prs: "TOGGLE"
    }),
    0,
    true
  );

  /* Cover Door Sensor */
  MQTT.publish(
    "homeassistant/binary_sensor/garage_door/config",
    JSON.stringify({
      name: "Serranda Garage",
      uniq_id: "garage_door",
      device: device,
      stat_t: mqttPrefix + "/cover/status",
      avty_t: mqttPrefix + "/garage/availability",
      pl_avail: "online",
      pl_not_avail: "offline",
      pl_on: "open",
      pl_off: "closed",
      dev_cla: "garage_door",
      icon: "mdi:garage"
    }),
    0,
    true
  );

  /* Online Status */
  MQTT.publish(
    "homeassistant/binary_sensor/garage_online/config",
    JSON.stringify({
      name: "Garage Online",
      uniq_id: "garage_online",
      device: device,
      stat_t: mqttPrefix + "/garage/online",
      pl_on: "true",
      pl_off: "false",
      dev_cla: "connectivity"
    }),
    0,
    true
  );

  /* Last Seen */
  MQTT.publish(
    "homeassistant/sensor/garage_last_seen/config",
    JSON.stringify({
      name: "Garage Last Seen",
      uniq_id: "garage_last_seen",
      device: device,
      stat_t: mqttPrefix + "/garage/last_seen",
      dev_cla: "timestamp",
      icon: "mdi:clock-outline"
    }),
    0,
    true
  );

  /* Heartbeat */
  if (ENABLE_HEARTBEAT) {
    MQTT.publish(
      "homeassistant/sensor/lora_heartbeat/config",
      JSON.stringify({
        name: "LoRa Heartbeat",
        uniq_id: "garage_lora_heartbeat",
        device: device,
        stat_t: mqttPrefix + "/lora/heartbeat",
        dev_cla: "timestamp",
        icon: "mdi:heart-pulse"
      }),
      0,
      true
    );
  }

  /* Availability */
  MQTT.publish(
    "homeassistant/sensor/garage_availability/config",
    JSON.stringify({
      name: "Garage Availability",
      uniq_id: "garage_availability",
      device: device,
      stat_t: mqttPrefix + "/garage/availability",
      entity_category: "diagnostic",
      enabled_by_default: false,
      icon: "mdi:server-network"
    }),
    0,
    true
  );

  /* Reboot Bridge */
  MQTT.publish(
    "homeassistant/button/garage_reboot_bridge/config",
    JSON.stringify({
      name: "Riavvia Bridge LoRa",
      uniq_id: "garage_reboot_bridge",
      device: device,
      entity_category: "diagnostic",
      icon: "mdi:restart",
      cmd_t: mqttPrefix + "/system/reboot_bridge",
      pl_prs: "REBOOT"
    }),
    0,
    true
  );

  /* Reboot Garage */
  MQTT.publish(
    "homeassistant/button/garage_reboot_garage/config",
    JSON.stringify({
      name: "Riavvia Garage",
      uniq_id: "garage_reboot_garage",
      device: device,
      entity_category: "diagnostic",
      icon: "mdi:restart",
      cmd_t: mqttPrefix + "/system/reboot_garage",
      pl_prs: "REBOOT"
    }),
    0,
    true
  );

  log(LOG_INFO, "Home Assistant Discovery published");
}

/* LoRa: Encrypt Message */
function encryptMessage(msg, keyHex) {
  function fromHex(hex) {
    const arr = new ArrayBuffer(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return arr;
  }

  function padRight(msg, blockSize) {
    const paddingSize = (blockSize - msg.length % blockSize) % blockSize;;

    for (let i = 0; i < paddingSize; i++) {
      msg += ' ';
    }

    return msg;
  }

  msg = msg.trim();
  const formattedMsg = padRight(msg, 16);
  const key = fromHex(keyHex);
  const encMsg = AES.encrypt(formattedMsg, key, { mode: 'ECB' });
  return encMsg;
}

/* LoRa: Generate Checksum */
function generateChecksum(msg) {
  let checksum = 0;
  for (let i = 0; i < msg.length; i++) {
    checksum ^= msg.charCodeAt(i);
  }
  let hexChecksum = checksum.toString(16);

  while (hexChecksum.length < CHECKSUM_SIZE) {
    hexChecksum = '0' + hexChecksum;
  }

  return hexChecksum.slice(-CHECKSUM_SIZE);
}

/* LoRa: Send Message */
function sendMessage(message) {

  /* check aes key */
  if (!aesKey) {
    log(LOG_WARN, "AES key not loaded");
    return;
  }

  const checkSumMessage = generateChecksum(message) + message;
  const encryptedMessage = encryptMessage(checkSumMessage, aesKey);

  /* Publish raw message for debugging */
  if(LOG_LEVEL >= LOG_DEBUG) {
    mqttPublish("/lora/raw_tx", message, false);
  }

  Shelly.call(
    'Lora.SendBytes',
    { id: LORA_PEER_ID, data: btoa(encryptedMessage) },
    function (_, err_code, err_msg) {
      if (err_code !== 0) {
        log(
          LOG_ERROR,
          "[LoRa] Send failed: " +
          err_code +
          " " +
          err_msg
        );
      }
    }
  );
}

/* LoRa: Verify Message */
function verifyMessage(message) {
  if (message.length < CHECKSUM_SIZE + 1) {
    log(LOG_WARN, '[LoRa] invalid message (too short)');
    return;
  }

  const receivedCheckSum = message.slice(0, CHECKSUM_SIZE);
  const _message = message.slice(CHECKSUM_SIZE);
  const expectedChecksum = generateChecksum(_message);

  if (receivedCheckSum !== expectedChecksum) {
    log(LOG_WARN, '[LoRa] invalid message (checksum corrupted)');
    return;
  }

  return _message;
}

/* LoRa: Decrypt Message */
function decryptMessage(buffer, keyHex) {
  function fromHex(hex) {
    const arr = new ArrayBuffer(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return arr;
  }

  function hex2a(hex) {
    hex = hex.toString();
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  }

  function toHex(buffer) {
    let s = '';
    for (let i = 0; i < buffer.length; i++) {
      s += (256 + buffer[i]).toString(16).substr(-2);
    }
    return s;
  }

  if (!keyHex) {
    log(LOG_WARN, "AES key not loaded");
    return;
  }

  const key = fromHex(keyHex);
  const decrypted = AES.decrypt(buffer, key, { mode: 'ECB' });

  if (!decrypted || decrypted.byteLength === 0) {
    log(LOG_WARN, '[LoRa] invalid msg (empty decryption result)');
    return;
  }

  const hex = toHex(decrypted);
  const checksumMessage = hex2a(hex).trim();
  const finalMessage = verifyMessage(checksumMessage);

  return finalMessage;
}

/* Check Garage Status*/
function checkOnlineStatus() {

  const alive = (Date.now() - lastGarageSeen) < GARAGE_TIMEOUT;

  mqttPublish(
    "/garage/online",
    alive ? "true" : "false",
    true
  );

  mqttPublish(
    "/garage/availability",
    alive ? "online" : "offline",
    true
  );
}

/* Mark garage as online */
function markGarageOnline() {

  lastGarageSeen = Date.now();

  mqttPublish(
    "/garage/last_seen",
    new Date().toISOString(),
    true
  );

  checkOnlineStatus();
}

/* Send request for update */
function requestUpdate() {
  sendMessage(msg_status_request);
}

/* Process incoming LoRa messages */
Shelly.addEventHandler(function (event) {
  if (
    typeof event !== 'object' ||
    event.name !== 'lora' ||
    !event.info ||
    !event.info.data
  ) {
    return;
  }

  const encryptedMsg = atob(event.info.data);
  const decryptedMessage = decryptMessage(encryptedMsg, aesKey);

  //do nothing, message is not encrypted or AES key mismatch
  if (typeof decryptedMessage === "undefined") {
    return;
  }

  log(LOG_DEBUG, "Message received: " + decryptedMessage);
  /* Publish raw message for debugging */
  if(LOG_LEVEL >= LOG_DEBUG) {
    mqttPublish("/lora/raw_rx", decryptedMessage, false);
  }

  /* Update last seen timestamp and publish online status */
  markGarageOnline();

  /* Light On */
  if ((decryptedMessage === msg_light_on) ||
      (decryptedMessage === msg_status_open_light_on) ||
      (decryptedMessage === msg_status_closed_light_on) ||
      (decryptedMessage === msg_status_unknown_light_on) ) {
    log(LOG_INFO, "Light On");
    mqttPublish("/light/status", "ON", true);
  }

  /* Light Off */
  if ((decryptedMessage === msg_light_off) ||
      (decryptedMessage === msg_status_open_light_off) ||
      (decryptedMessage === msg_status_closed_light_off) ||
      (decryptedMessage === msg_status_unknown_light_off) ) {
    log(LOG_INFO, "Light Off");
    mqttPublish("/light/status", "OFF", true);
  }

  if (decryptedMessage === msg_cover_ack) {
    log(LOG_INFO, "Cover command executed");
    mqttPublish("/cover/ack", new Date().toISOString(), false);
  }

  if ((decryptedMessage === msg_cover_opened) ||
      (decryptedMessage === msg_status_open_light_on) ||
      (decryptedMessage === msg_status_open_light_off)) {
    log(LOG_INFO, "Cover opened");
    mqttPublish("/cover/status", "open", true);
  }

  if ((decryptedMessage === msg_cover_closed) ||
      (decryptedMessage === msg_status_closed_light_on) ||
      (decryptedMessage === msg_status_closed_light_off)) {
    log(LOG_INFO, "Cover closed");
    mqttPublish("/cover/status", "closed", true);
  }

  if ((decryptedMessage === msg_status_unknown_light_on) ||
      (decryptedMessage === msg_status_unknown_light_off)) {
    log(LOG_INFO, "Unknown cover status");
    mqttPublish("/cover/status", "unknown", true);
  }
});

/* Main task */
init();