/**
 * @title LoRa Garage - Remote Node
 * @description Remote garage node responsible for door monitoring and event transmission via LoRa.
 * @status production
 * @author Giorgio Ravera
 * @date 08/07/2026
 * @version 1.0
 *
 * Responsibilities:
 * - Monitor garage door status
 * - Monitor light status
 * - Send encrypted LoRa notifications
 * - Execute remote commands
 * - Keep controller synchronized
 *
 * Hardware:
 * - Shelly Gen4 device
 * - Shelly LoRa Add-on
 * - Shelly BLU Door/Window sensor
 *
 * Related:
 * - home.js
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

/* Door State */
let lastDoorState = null;

/* Init */
function init() {
  /* Init */
  log(LOG_INFO, "LoRa Remote Node started");

  /* init door state */
  initDoorState();

  /* load AES key from shelly configuration */
  loadAesKey();

  /* Periodically send garage status */
  if(GARAGE_ENABLE_STATUS_SEND){
    Timer.set(
      GARAGE_UPDATE_INTERVAL,
      true,
      sendCurrentStatus
    );
  }

  /* Force update after boostrap */
  Timer.set(
    5000,
    false,
    sendCurrentStatus
  );

  log(LOG_INFO, "Garage update interval set to " + GARAGE_UPDATE_INTERVAL + " ms");
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

/* init door state */
function initDoorState() {

  const status = Shelly.getComponentStatus("bthomesensor:201");

  if (
    status &&
    status.value !== undefined
  ) {
    lastDoorState = status.value;

    log(
      LOG_INFO,
      "Initial door state: " +
      (lastDoorState ? "OPEN" : "CLOSED")
    );
  }
}

/* Send current status */
function sendCurrentStatus() {

  const lightState = Shelly.getComponentStatus("switch:0").output;

  if (lastDoorState === null) {
    sendMessage("U" + (lightState ? "1" : "0"));
    return;
  }

  sendMessage(
    (lastDoorState ? "O" : "C") +
    (lightState ? "1" : "0")
  );
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

    /* Light On */
    if (decryptedMessage === msg_light_on) {
      Shelly.call("Switch.Set", {
        id: 0,
        on: true
      });
    }

    /* Light Off */
    if (decryptedMessage === msg_light_off) {
      Shelly.call("Switch.Set", {
        id: 0,
        on: false
      });
    }

    /* Cover Toggle */
    if (decryptedMessage === msg_cover_toggle) {

      /* Turn On */
      Shelly.call("Switch.Set", {
        id: 1,
        on: true
      });

      /* Turn Off */
      Timer.set(500, false, function() {
        Shelly.call("Switch.Set", {
          id: 1,
          on: false
        });
      });

      /* Send message via LoRa: Acknowledge command */
      sendMessage(msg_cover_ack);
    }

    /* Status Request */
    if (decryptedMessage === msg_status_request) {

      /* Send message via LoRa: Current cover status */
      sendCurrentStatus();
    }
  }
});

/* Return Light Status */
Shelly.addStatusHandler(function (e) {
  if (!e.delta || e.delta.output === undefined) {
    return;
  }

  if (e.component === "switch:0") {
    /* Send message via LoRa */
    sendMessage(
      e.delta.output ? msg_light_on : msg_light_off
    );
  }
});

/* Return Door status */
Shelly.addStatusHandler(function(e) {

  if (e.component !== "bthomesensor:201") {
    return;
  }

  if (!e.delta || e.delta.value === undefined) {
    return;
  }

  /* Ignore duplicated events */
  if (lastDoorState === e.delta.value) {
    return;
  }

  lastDoorState = e.delta.value;

  if (e.delta.value) {
    /* Internal Log */
    log(LOG_INFO, "Cover opened");
    /* Send Message via LoRa */
    sendMessage(msg_cover_opened);
  } else {
    log(LOG_INFO, "Cover closed");
    /* Send Message via LoRa */
    sendMessage(msg_cover_closed);
  }
});

/* Main task */
init();