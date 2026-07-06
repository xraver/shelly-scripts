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

//AES key is only for example, generate unique key!! (openssl rand -hex 32)
const aesKey = 'af22a880475e5d71ddf417bd48a3ae1ffee93da92d78556ac476acafc9869140';
const CHECKSUM_SIZE = 4;

/* Protocol Messages - Lights */
const msg_light_on      = "LON";
const msg_light_off     = "LOF";
/* Protocol Messages - Cover */
const msg_cover_toggle  = "CTG";
const msg_cover_ack     = "CAK";
const msg_cover_opened  = "COP";
const msg_cover_closed  = "CCL";
const msg_cover_status  = "CST";

// Get MQTT prefix from config
let mqttCfg;
let mqttPrefix;

/* Init */
function init() {
  /* Init */
  log(LOG_INFO, "LoRa MQTT Bridge started");

  /* Init MQTT */
  initMQTT();
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

  if (!MQTT.isConnected()) {
    log(LOG_WARN, "MQTT not connected");
    return;
  }

  // Get MQTT prefix from config
  mqttCfg = Shelly.getComponentConfig("mqtt");
  mqttPrefix = mqttCfg.topic_prefix;
  if (!mqttPrefix || mqttPrefix === "") {
    mqttPrefix = Shelly.getDeviceInfo().id;
  }

  mqttPublish("/lora/online", "true", false);
  mqttPublish("/lora/heartbeat", new Date().toISOString(), false);

  /* Refresh every 5 minutes */
  Timer.set(300000, true, function() {
    mqttPublish("/lora/online", "true", true);
    mqttPublish("/lora/heartbeat", new Date().toISOString(), false);
  });

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

  log(LOG_INFO, "MQTT subscriptions active");
}

/* MQTT Publish */
function mqttPublish(topic, payload, retain) {
  if (!MQTT.isConnected()) {
    return;
  }

  MQTT.publish(
    mqttPrefix + topic,
    payload,
    0,
    retain
  );
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

  mqttPublish("/lora/raw_tx", message, false);

  const checkSumMessage = generateChecksum(message) + message;
  const encryptedMessage = encryptMessage(checkSumMessage, aesKey);

  Shelly.call(
    'Lora.SendBytes',
    { id: 100, data: btoa(encryptedMessage) },
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

/* Process Messages: Light On/Off - Cover Toggle */
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
  } else {
    log(LOG_DEBUG, "Message received: " + decryptedMessage);
    mqttPublish("/lora/raw_rx", decryptedMessage, false);

    /* Light On */
    if (decryptedMessage === msg_light_on) {
      log(LOG_INFO, "Light On");
      mqttPublish("/light/status", "ON", true);
    }

    /* Light Off */
    if (decryptedMessage === msg_light_off) {
      log(LOG_INFO, "Light Off");
      mqttPublish("/light/status", "OFF", true);
    }

    if (decryptedMessage === msg_cover_ack) {
      log(LOG_INFO, "Cover command executed");
      mqttPublish("/cover/ack", new Date().toISOString(), false);
    }

    if (decryptedMessage === msg_cover_opened) {
      log(LOG_INFO, "Cover opened");
      mqttPublish("/cover/status", "OPENED", true);
    }

    if (decryptedMessage === msg_cover_closed) {
      log(LOG_INFO, "Cover closed");
      mqttPublish("/cover/status", "CLOSED", true);
    }
  }
});

init();