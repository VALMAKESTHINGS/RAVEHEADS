#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>
#include <Adafruit_BNO08x.h>
#include <Wire.h>

#ifndef NODE_ID
#define NODE_ID 1
#endif

#define SEND_INTERVAL_MS 20

// M5 Atom I2C pins
#define SDA_PIN 32
#define SCL_PIN 26

Adafruit_BNO08x bno08x(-1);
sh2_SensorValue_t sensorValue;

typedef struct __attribute__((packed)) {
    uint8_t nodeId;
    uint32_t timestamp_ms;
    float yaw;
    float pitch;
    float roll;
} Packet;

static const uint8_t HUB_MAC[6] = {
    0x48, 0xCA, 0x43,
    0xB6, 0x04, 0x58
};

Packet pkt;

struct Euler {
    float yaw;
    float pitch;
    float roll;
} ypr;

void quaternionToEuler(
    float qr,
    float qi,
    float qj,
    float qk
) {
    ypr.yaw = atan2(
        2.0f * (qi * qj + qk * qr),
        (qi * qi - qj * qj - qk * qk + qr * qr)
    ) * RAD_TO_DEG;

    ypr.pitch = asin(
        -2.0f * (qi * qk - qj * qr)
    ) * RAD_TO_DEG;

    ypr.roll = atan2(
        2.0f * (qj * qk + qi * qr),
        (-qi * qi - qj * qj + qk * qk + qr * qr)
    ) * RAD_TO_DEG;
}

void setup() {
    Serial.begin(115200);
    delay(500);

    // REQUIRED for M5 Atom
    Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(400000);

    // WiFi required for ESP-NOW
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    if (esp_now_init() != ESP_OK) {
        Serial.println("ESP-NOW init failed");
        while (true) delay(1000);
    }

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, HUB_MAC, 6);
    peer.channel = 0;
    peer.encrypt = false;

    if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("Failed to add hub peer");
        while (true) delay(1000);
    }

    // Sensor init
    if (!bno08x.begin_I2C()) {
        Serial.println("BNO08x not found");
        while (true) delay(1000);
    }

    bno08x.enableReport(
        SH2_ARVR_STABILIZED_RV,
        5000
    );

    Serial.println("READY");
}

#define DEBUG_PRINT_MS 100

uint32_t lastPrint = 0;

void loop() {

    if (!bno08x.getSensorEvent(&sensorValue)) {
        delay(1);
        return;
    }

    if (sensorValue.sensorId != SH2_ARVR_STABILIZED_RV) {
        return;
    }

    auto &rv = sensorValue.un.arvrStabilizedRV;

    quaternionToEuler(
        rv.real,
        rv.i,
        rv.j,
        rv.k
    );

    pkt.nodeId = NODE_ID;
    pkt.timestamp_ms = millis();
    pkt.yaw = ypr.yaw;
    pkt.pitch = ypr.pitch;
    pkt.roll = ypr.roll;

    // send packet
    esp_now_send(
        HUB_MAC,
        (uint8_t*)&pkt,
        sizeof(pkt)
    );

    // debug print (10 Hz)
    if (millis() - lastPrint >= DEBUG_PRINT_MS) {

        Serial.printf(
            "[TX] node=%u yaw=%.2f pitch=%.2f roll=%.2f t=%lu\n",
            pkt.nodeId,
            pkt.yaw,
            pkt.pitch,
            pkt.roll,
            pkt.timestamp_ms
        );

        lastPrint = millis();
    }

    delay(SEND_INTERVAL_MS);
}