# IMU OSC Bridge - README

Arduino → Python → Max/MSP pipeline for streaming IMU headset data via OSC.

## 🎯 What It Does

- **Auto-detects** M5Atom/Arduino headsets (no more hunting for COM ports!)
- **Streams** orientation (yaw/pitch/roll) + acceleration data to Max/MSP via OSC
- **Records** data to CSV files for later analysis
- **Maintains** persistent device IDs even when COM ports change

## 📦 Requirements

### Python Libraries
```bash
pip install pyserial python-osc
```

### Hardware
- M5Atom with BNO08x IMU
- USB connection to computer

## 🚀 Quick Start

### 1. Upload Arduino Code
Flash the provided Arduino sketch to your M5Atom headset(s).

### 2. Configure Python Script
Open the script and check these settings:

```python
MAX_OSC_IP = "127.0.0.1"      # Max/MSP IP (localhost)
MAX_OSC_PORT = 7400            # Max/MSP listening port
AUTO_DETECT = True             # Auto-find devices (recommended)
BAUD_RATE = 115200             # Must match Arduino
```

### 3. Run the Script
```bash
python imu_osc_bridge.py
```

The script will:
- Auto-discover connected headsets
- Show device list with persistent IDs
- Prompt you for mode: `r` (record), `p` (print), or `rp` (both)

### 4. Set Up Max/MSP
Create a `udpreceive 7400` object and route OSC messages:

**OSC Address Format:**
```
/imu/1/yaw        - Device 1 yaw (degrees)
/imu/1/pitch      - Device 1 pitch (degrees)
/imu/1/roll       - Device 1 roll (degrees)
/imu/1/accel_x    - Device 1 X acceleration
/imu/1/accel_y    - Device 1 Y acceleration
/imu/1/accel_z    - Device 1 Z acceleration

/imu/2/yaw        - Device 2 yaw...
...
```

## 📊 Data Format

### Arduino Output (Serial)
```
idNum,imu_x,imu_y,imu_z,accel_x,accel_y,accel_z
1,45.234,12.456,67.890,0.123,0.456,0.789
```

### CSV Files
```
timestamp,id,imu_x,imu_y,imu_z,accel_x,accel_y,accel_z
0.000,1,45.234,12.456,67.890,0.123,0.456,0.789
0.010,1,45.567,12.789,68.012,0.124,0.457,0.790
```

## ⚙️ Configuration Options

### Auto-Detection (Recommended)
```python
AUTO_DETECT = True
DEVICE_FILTER = ["USB", "Serial", "CH340", "CP210", "UART"]
```
Script finds all USB serial devices automatically.

### Manual COM Ports
```python
AUTO_DETECT = False
MANUAL_COM_PORTS = ["COM3", "COM9"]
```
Specify exact COM ports if auto-detection fails.

### CSV Naming
```python
CSV_NAMING_MODE = "auto"  # Uses serial numbers
# or
CSV_NAMING_MODE = "manual"
MANUAL_CSV_NAMES = ["headset_1", "headset_2"]
```

### Threading
```python
USE_THREADS = False  # Sequential (reliable)
USE_THREADS = True   # Parallel (faster, less predictable)
```

## 🔧 Troubleshooting

### No Devices Found
- Check USB connections
- Verify drivers are installed (CH340/CP210x)
- Try setting `AUTO_DETECT = False` and specify ports manually

### Data Not Appearing in Max
- Verify OSC port matches (`udpreceive 7400`)
- Check firewall settings
- Test with Max's OSC monitor

### Garbled/Missing Data
- Ensure Arduino `BAUD_RATE = 115200` matches Python
- Check USB cable quality
- Reduce `PORT_READ_DELAY` if data seems slow

### COM Port Keeps Changing
- Don't worry! Auto-detection handles this
- Device IDs are based on serial numbers, not COM ports
- Device 1 stays Device 1 even if it moves from COM3 to COM5

## 🎮 Usage Examples

### Single Headset
1. Connect headset
2. Run script: `python imu_osc_bridge.py`
3. Choose mode: `p` (print to console)
4. Move headset, watch data stream!

### Multiple Headsets + Recording
1. Connect all headsets
2. Run script
3. Choose mode: `rp` (record + print)
4. Data saves to `device_1_SERIAL.csv`, `device_2_SERIAL.csv`, etc.

### Performance/Live Use
1. Set `USE_THREADS = True` for parallel streaming
2. Choose mode: `r` (record only, no console spam)
3. Lower latency for real-time Max processing

## 📝 Notes

- **Update Rate:** ~100Hz per device (Arduino sends every 10ms)
- **Max Devices:** Up to 12 headsets simultaneously
- **CSV Files:** Auto-saved in script directory
- **Stop:** Press `Ctrl+C` for clean shutdown

## 🤠 Credits

*See you space cowboy...*

---

**Questions?** Check the inline comments in the Python script for detailed explanations.
