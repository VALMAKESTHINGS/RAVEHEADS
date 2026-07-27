/*
 * hub.ino  –  ESP-NOW Communication Hub (star topology)
 *
 * Architecture (dual-core):
 *   Core 0 – ESP-NOW RX callback  +  TX broadcast task
 *   Core 1 – Arduino loop: application processing of received data
 *
 * Star topology:
 *   • All senders unicast their packets to this hub.
 *   • Hub broadcasts (or unicasts) back to every registered sender.
 *
 * Board: any ESP32 with enough flash (M5 Atom Echo works fine as hub too)
 * Libs : esp_now, WiFi (both built-in to esp32 Arduino core)
 */

#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>

// ── Payload definitions (must match sender.ino exactly) ────────────────────────
typedef struct __attribute__((packed)) {
    uint8_t  nodeId;
    uint32_t timestamp_ms;
    int16_t  yaw;
    int16_t  pitch;
    int16_t  roll;
    uint8_t  seqNum;
} NodePayload;

typedef struct __attribute__((packed)) {
    uint8_t  fromNodeId;
    uint32_t hubTimestamp_ms;
    int16_t  broadcastValue;
} HubBroadcast;

// ── Max senders the hub tracks ─────────────────────────────────────────────────
#define MAX_PEERS  10

// ── Peer registry ──────────────────────────────────────────────────────────────
static uint8_t peerMacs[MAX_PEERS][6];
static uint8_t peerCount = 0;
static SemaphoreHandle_t peerMutex;

// ── Inter-core queues ──────────────────────────────────────────────────────────
// RX: Core0 callback → Core1 app
static QueueHandle_t rxQueue;
// TX: Core1 app → Core0 broadcaster
static QueueHandle_t txQueue;

// ── Helpers ────────────────────────────────────────────────────────────────────
static bool macKnown(const uint8_t *mac) {
    for (int i = 0; i < peerCount; i++)
        if (memcmp(peerMacs[i], mac, 6) == 0) return true;
    return false;
}

static void registerPeer(const uint8_t *mac) {
    if (peerCount >= MAX_PEERS) return;
    memcpy(peerMacs[peerCount++], mac, 6);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    esp_now_add_peer(&peer);

    Serial.printf("[HUB] new peer %02X:%02X:%02X:%02X:%02X:%02X  total=%d\n",
                  mac[0],mac[1],mac[2],mac[3],mac[4],mac[5], peerCount);
}

//__ Data framing ______________________________________________________//

// CRC-8 (polynomial 0x07, init 0x00)
uint8_t crc8(const uint8_t* data, size_t len) {
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++)
            crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
    }
    return crc;
}

void send_framed(const NodePayload* p) {
    uint8_t buf[sizeof(NodePayload)];
    memcpy(buf, p, sizeof(NodePayload));
    uint8_t crc = crc8(buf, sizeof(NodePayload));
    Serial.write(0xAA);                       // sync byte 0
    Serial.write(0x55);                       // sync byte 1
    Serial.write((uint8_t)sizeof(NodePayload)); // payload length
    Serial.write(buf, sizeof(NodePayload));   // payload
    Serial.write(crc);                        // CRC-8
}

// ── ESP-NOW callbacks (both fire on Core 0) ────────────────────────────────────
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
    if (len != sizeof(NodePayload)) return;

    xSemaphoreTake(peerMutex, portMAX_DELAY);
    if (!macKnown(info->src_addr)) {
        registerPeer(info->src_addr);
    }
    xSemaphoreGive(peerMutex);

    NodePayload pkt;
    memcpy(&pkt, data, sizeof(pkt));

    // Push to app queue; overwrite if full (keep freshest)
    xQueueSendFromISR(rxQueue, &pkt, nullptr);
}

// Send CB uses wifi_tx_info_t in this SDK version; we don't need it so skip registration.

// ── Core-0 broadcast task ──────────────────────────────────────────────────────
// Waits for app to push a HubBroadcast, then sends it to all known peers.
void broadcastTask(void *param) {
    HubBroadcast pkt;
    for (;;) {
        if (xQueueReceive(txQueue, &pkt, portMAX_DELAY) == pdTRUE) {
            xSemaphoreTake(peerMutex, portMAX_DELAY);
            for (int i = 0; i < peerCount; i++)
                esp_now_send(peerMacs[i], (uint8_t *)&pkt, sizeof(pkt));
            xSemaphoreGive(peerMutex);
        }
    }
}

// ── Setup ──────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    Serial.println("EFUSE MAC:");
    Serial.println((uint64_t)ESP.getEfuseMac(), HEX);

    WiFi.mode(WIFI_STA);
    WiFi.begin();
    delay(300);

    Serial.println("WiFi MAC:");
    Serial.println(WiFi.macAddress());


    if (esp_now_init() != ESP_OK) {
        Serial.println("ESP-NOW init failed");
        while (true) delay(1000);
    }

    esp_now_register_recv_cb(onRecv);

    peerMutex = xSemaphoreCreateMutex();
    rxQueue   = xQueueCreate(MAX_PEERS, sizeof(NodePayload));   // one slot per peer
    txQueue   = xQueueCreate(1, sizeof(HubBroadcast));          // overwrite semantics

    // Broadcast task pinned to Core 0 alongside ESP-NOW driver
    xTaskCreatePinnedToCore(
        broadcastTask,
        "espnow_bc",
        3072,
        nullptr,
        configMAX_PRIORITIES - 1,
        nullptr,
        0   // Core 0
    );

    Serial.println("[HUB] ready – waiting for senders");
}

// ── Main loop (Core 1) ─────────────────────────────────────────────────────────
// Process incoming data and decide what to broadcast back.
void loop() {
    NodePayload in;

    // Drain all pending received packets
    while (xQueueReceive(rxQueue, &in, 0) == pdTRUE) {

        Serial.printf(
            "[RX] node=%u seq=%u yaw=%d pitch=%d roll=%d t=%lu\n",
            in.nodeId,
            in.seqNum,
            in.yaw,
            in.pitch,
            in.roll,
            in.timestamp_ms
        );

        HubBroadcast reply;
        reply.fromNodeId      = in.nodeId;
        reply.hubTimestamp_ms = millis();

        // choose one:
        reply.broadcastValue = in.yaw;   // simplest valid mapping

        xQueueOverwrite(txQueue, &reply);
    }

    // Yield to avoid starving other Core-1 tasks
    vTaskDelay(1);
}
