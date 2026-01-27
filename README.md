# IMU OSC Bridge - README

Arduino → Python → Max/MSP pipeline for streaming multi-headset IMU data via OSC with advanced aggregation modes.

## 🎯 What It Does

- **Auto-detects** M5Atom/Arduino headsets (no more hunting for COM ports!)
- **Streams** orientation (yaw/pitch/roll) + acceleration data to Max/MSP via OSC at **100Hz**
- **Aggregates** multiple headsets with 4 different modes (averaging, hierarchical, frequency extraction)
- **Records** data to CSV files for later analysis
- **Maintains** persistent device IDs even when COM ports change
- **Generates** LFO signals from motion patterns (Modes 3 & 4)

## 🆕 New Features

### Four Aggregation Modes
1. **Mode 1: Equal Averaging** - All headsets weighted equally
2. **Mode 2: Hierarchical** - One leader at 50% weight, others share remaining 50%
3. **Mode 3: Averaging + Frequency Extraction** - Equal averaging with FFT-based LFO generation
4. **Mode 4: Hierarchical + Frequency** - Leader-weighted with LFO generation

### Performance Optimizations
- **100Hz stable OSC output** with separated computation threads
- Minimal lock contention for smooth real-time streaming
- Frequency extraction runs at 10Hz (computationally efficient)

### Runtime Controls
- Switch modes on-the-fly without restarting
- Change leader device dynamically (Modes 2 & 4)
- Toggle debug output for monitoring
- Check status of all settings

## 📦 Requirements

### Python Libraries
```bash
pip install pyserial python-osc numpy
```

### Hardware
- M5Atom with BNO08x IMU (1 or more)
- USB connection to computer

## 🚀 Quick Start

### 1. Upload Arduino Code
Flash the provided Arduino sketch to your M5Atom headset(s).

### 2. Configure Python Script
Open the script and check these settings:

```python
MAX_OSC_IP = "127.0.0.1"       # Max/MSP IP (localhost)
MAX_OSC_PORT = 7400             # Max/MSP listening port
AUTO_DETECT = True              # Auto-find devices (recommended)
BAUD_RATE = 115200              # Must match Arduino
OSC_UPDATE_RATE = 100           # 100Hz OSC output (stable)
```

### 3. Run the Script
```bash
python imu_osc_bridge_optimized.py
```

The script will:
- Auto-discover connected headsets
- Show device list with persistent IDs
- Ask you to select initial mode (1, 2, 3, or 4)
- If Mode 2 or 4: prompt for leader device
- Prompt for recording mode: `r` (record), `p` (print), or `rp` (both)
- Ask if you want debug output enabled

### 4. Set Up Max/MSP
Create a `udpreceive 7400` object and route OSC messages:

**Individual Device OSC Addresses:**
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

**Aggregated OSC Addresses (All Modes):**
```
/imu/aggregated/yaw          - Combined yaw value
/imu/aggregated/pitch        - Combined pitch value
/imu/aggregated/roll         - Combined roll value
/imu/aggregated/accel_x      - Combined X acceleration
/imu/aggregated/accel_y      - Combined Y acceleration
/imu/aggregated/accel_z      - Combined Z acceleration
/imu/aggregated/mode         - Current mode number (1-4)
/imu/aggregated/leader_id    - Leader device ID (Modes 2 & 4 only)
```

**LFO Addresses (Modes 3 & 4 Only):**
```
/imu/aggregated/lfo_freq_imu_x    - Extracted frequency for yaw axis (Hz)
/imu/aggregated/lfo_imu_x         - LFO sine wave for yaw (-1.0 to 1.0)
/imu/aggregated/lfo_freq_imu_y    - Extracted frequency for pitch axis (Hz)
/imu/aggregated/lfo_imu_y         - LFO sine wave for pitch (-1.0 to 1.0)
/imu/aggregated/lfo_freq_imu_z    - Extracted frequency for roll axis (Hz)
/imu/aggregated/lfo_imu_z         - LFO sine wave for roll (-1.0 to 1.0)
/imu/aggregated/lfo_freq_accel_x  - Extracted frequency for accel X (Hz)
/imu/aggregated/lfo_accel_x       - LFO sine wave for accel X (-1.0 to 1.0)
... (same pattern for accel_y and accel_z)
```

## 📊 Data Format

### Arduino Output (Serial)
```
idNum,imu_x,imu_y,imu_z,accel_x,accel_y,accel_z
1,45.234,12.456,67.890,0.123,0.456,0.789
```

### CSV Files
```
timestamp,id,imu_x,imu_y,imu_z,accel_x,accel_y,accel_z,mode,leader_id
0.000,1,45.234,12.456,67.890,0.123,0.456,0.789,1,
0.010,1,45.567,12.789,68.012,0.124,0.457,0.790,2,1
```

### Mode Log File
```
Mode Log Started: 2025-01-27 14:30:00
============================================================
[2025-01-27 14:30:00] MODE 1 - Averaging all headsets equally
[2025-01-27 14:32:15] MODE 2 - Hierarchical with Leader Device 1 (50% weight)
[2025-01-27 14:35:00] MODE 3 - Averaging + Frequency Extraction (LFO output)
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

### Performance Tuning
```python
OSC_UPDATE_RATE = 100           # OSC messages per second (100Hz recommended)
FREQ_EXTRACTION_RATE = 10       # Frequency analysis rate (10Hz recommended)
PORT_READ_DELAY = 0.001         # Delay between serial reads (1ms)
```

### Threading
```python
USE_THREADS = False  # Sequential (reliable, recommended)
USE_THREADS = True   # Parallel (experimental)
```

## 🎮 Runtime Commands

While the script is running, type these commands:

- `1` - Switch to Mode 1 (Equal averaging)
- `2` - Switch to Mode 2 (Hierarchical)
- `3` - Switch to Mode 3 (Averaging + Frequency/LFO)
- `4` - Switch to Mode 4 (Hierarchical + Frequency/LFO)
- `leader` - Select leader device (for Modes 2 & 4)
- `debug` - Toggle debug output on/off
- `status` - Show current mode, devices, and settings
- `quit` - Exit program

## 🔧 Troubleshooting

### No Devices Found
- Check USB connections
- Verify drivers are installed (CH340/CP210x)
- Try setting `AUTO_DETECT = False` and specify ports manually

### Data Not Appearing in Max
- Verify OSC port matches (`udpreceive 7400`)
- Check firewall settings
- Test with Max's OSC monitor
- Enable debug output to verify data is being sent

### Slow or Unstable OSC Output
- ✅ **This is now fixed!** The optimized version runs at stable 100Hz
- Check debug output to verify actual update rate
- Reduce number of connected devices if CPU-limited

### Garbled/Missing Data
- Ensure Arduino `BAUD_RATE = 115200` matches Python
- Check USB cable quality
- Try different USB ports
- Look for debug messages about failed reads

### COM Port Keeps Changing
- Don't worry! Auto-detection handles this
- Device IDs are based on serial numbers, not COM ports
- Device 1 stays Device 1 even if it moves from COM3 to COM5

### Frequency Extraction Not Working
- Modes 3 & 4 need ~10 seconds of data before LFO output stabilizes
- Move headsets to generate motion patterns
- Check debug output to see extracted frequencies
- Frequencies are clamped between 0.1 Hz and 10 Hz

## 🎮 Usage Examples

### Single Headset - Basic Streaming
1. Connect headset
2. Run script: `python imu_osc_bridge_optimized.py`
3. Select Mode 1
4. Choose mode: `p` (print to console)
5. Enable debug: `y`
6. Move headset, watch data stream!

### Multiple Headsets - Hierarchical Mode
1. Connect all headsets
2. Run script
3. Select Mode 2
4. Choose Device 1 as leader
5. Choose mode: `rp` (record + print)
6. Device 1 will have 50% influence, others share remaining 50%

### Motion-to-LFO Mapping
1. Connect headsets
2. Run script
3. Select Mode 3 or 4
4. Choose mode: `r` (record only)
5. Move headsets rhythmically
6. After ~10 seconds, LFO outputs stabilize
7. Map `/imu/aggregated/lfo_*` to Max parameters

### Live Performance Setup
1. Set `USE_THREADS = True` for parallel streaming
2. Choose Mode 1 or 2 (lower CPU than Modes 3/4)
3. Choose mode: `r` (no console spam)
4. Disable debug output for minimal latency
5. Use aggregated OSC addresses for unified control

## 📊 Understanding the Modes

### Mode 1: Equal Averaging
**Best for:** Ensemble synchronization, group movement tracking
```
aggregated_value = (device1 + device2 + device3) / 3
```
All headsets contribute equally to the final output.

### Mode 2: Hierarchical
**Best for:** Leader/follower dynamics, conductor-orchestra setups
```
aggregated_value = (leader * 0.5) + (others * 0.5 / num_others)
```
One leader has 50% influence, others share remaining 50%.

### Mode 3: Averaging + Frequency
**Best for:** Rhythm extraction, pattern analysis, generative music
- Combines Mode 1 averaging
- Extracts dominant frequencies from motion (0.1 - 10 Hz)
- Generates synchronized LFO signals

### Mode 4: Hierarchical + Frequency
**Best for:** Leader-driven rhythm generation, weighted pattern extraction
- Combines Mode 2 hierarchical weighting
- Extracts frequencies from weighted motion
- Leader's motion patterns have stronger influence on LFO output

## 📝 Technical Notes

- **Update Rate:** 100Hz OSC output (optimized threading architecture)
- **Serial Input:** ~100Hz per device (Arduino sends every 10ms)
- **Frequency Range:** 0.1 Hz - 10 Hz (LFO generation)
- **Buffer Size:** 1000 samples (10 seconds at 100Hz)
- **Max Devices:** Tested up to 12 headsets simultaneously
- **CSV Files:** Auto-saved in script directory
- **Mode Log:** Separate log file tracks all mode changes
- **Stop:** Press `Ctrl+C` for clean shutdown

## 🏗️ Architecture

The optimized version uses 4 threads:

1. **Serial Reading Thread** - Reads data from devices at native rate
2. **Aggregation Calculation Thread** - Computes aggregated values (100Hz)
3. **Frequency Extraction Thread** - FFT analysis for LFO generation (10Hz)
4. **OSC Sending Thread** - Stable 100Hz OSC output
5. **Mode Control Thread** - Interactive command interface

This separation ensures stable OSC timing even during heavy computation.

## 🤠 Credits

*See you space cowboy...*

---

**Questions?** Check the inline comments in the Python script for detailed explanations.

**Performance Issues?** Make sure you're using the `_optimized.py` version with separated threading!
