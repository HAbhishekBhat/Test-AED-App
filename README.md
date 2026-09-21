# USB IR Dongle Detection App (React Native Android)

A complete Android React Native application that detects an **external USB Infrared (IR) dongle** connected to the phone via USB OTG (USB Host mode) and displays its hardware attributes.

Supports **Dynamic Auto-Detection** of any connected USB dongle without needing its Vendor ID (VID) or Product ID (PID) configured in advance.

---

## 1. Features

- **Dynamic Auto-Detection**: Plug in any external USB OTG IR dongle; the app automatically detects it, reads its Vendor ID and Product ID, and requests permission.
- **Optional Strict Mode**: Lock down the app to a specific device model using the synchronized allowlist if desired.
- **Hardware Descriptors**: Displays Device Name, Hex & Decimal VID/PID, Manufacturer, Product Name, and Serial Number.
- **Full Lifecycle Support**: Detects devices already connected on launch, hot-plugged while running, and unplugged while running.
- **Non-stacking Alerts**: Displays a popup prompting the user to insert a dongle if none is found or when unplugged, without annoying alert stacking.

---

## 2. Prerequisites & Environment Setup

This project requires **JDK 17** and the **Android SDK**.

### Check JDK 17
Verify that Java 17 is active in your terminal:
```bash
java -version
```
Expected output:
```text
openjdk version "17.0.x" ...
OpenJDK Runtime Environment ...
```

### Environment Variables
Configure your environment variables (`~/.bashrc`, `~/.zshrc`, or Windows System Environment Variables):

#### On Windows (PowerShell):
```powershell
[System.Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin"
```

#### On macOS / Linux:
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17) # macOS
# Or on Linux: export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
```

---

## 3. Project Initialization Commands

To recreate this project from scratch using the React Native CLI (without Expo):

```bash
# 1. Initialize React Native 0.74.5 with TypeScript template
npx @react-native-community/cli@0.74.5 init IrDongleApp --version 0.74.5

# 2. Navigate to project root
cd IrDongleApp

# 3. Install NPM dependencies
npm install

# 4. Verify native build using Gradle
cd android
./gradlew clean assembleDebug
```

---

## 4. How Auto-Detection Works

1. **Kernel-Level Descriptors**: When any USB device is connected via USB OTG, Android's kernel populates `UsbDevice` with its Vendor ID and Product ID immediately. These IDs do *not* require prior permissions or an allowlist.
2. **Wildcard Filter**: `res/xml/device_filter.xml` contains a wildcard `<usb-device />` entry that responds to any attached USB peripheral.
3. **Hub Filter**: The app ignores USB hubs (class 9) to prevent false detections if an OTG hub is used.
4. **Auto-Discovery Card**: When a dongle is plugged in, the app highlights it with an **⚡ Auto-Detected VID/PID** chip and displays its exact IDs so you can inspect them immediately on your phone screen!

### (Optional) Locking Down to a Specific Model
If you ever want to lock the app down so it *only* accepts your specific dongle:
1. Note the VID and PID displayed in the app (e.g. VID `0x1A86`, PID `0x7523`).
2. In `android/app/src/main/java/com/irdongleapp/irdongle/IrDongleModule.kt`:
   ```kotlin
   val ALLOWLIST = listOf(
       UsbDeviceIdentifier(vendorId = 0x1A86, productId = 0x7523)
   )
   ```
3. In `android/app/src/main/res/xml/device_filter.xml` (convert hex to decimal: 0x1A86 = 6790, 0x7523 = 29987):
   ```xml
   <usb-device vendor-id="6790" product-id="29987" />
   ```

---

## 5. How to Test with a Physical Device over USB OTG

> [!WARNING]
> **Android Virtual Devices (AVD / Emulators) CANNOT test USB Host / OTG hardware.**
> Android emulators do not emulate hardware OTG host controller attachment from the host machine. You MUST test on a physical Android phone.

### Step-by-Step Testing Procedure:
1. **Enable Developer Options & USB Debugging** on your physical Android phone:
   - Go to *Settings > About Phone* and tap *Build Number* 7 times.
   - Go to *Settings > System > Developer Options* and enable **USB Debugging**.
   - If your phone has a separate **OTG storage / OTG connection** toggle in Settings (common on OnePlus, Oppo, Vivo), turn it **ON**.
2. **Connect Phone to Development Computer via Wi-Fi ADB** (so the USB port remains free for the IR dongle):
   ```bash
   # Connect phone via USB cable first, then pair over TCP:
   adb tcpip 5555
   # Unplug USB cable from PC, check phone's IP in Wi-Fi settings, and connect:
   adb connect <PHONE_IP_ADDRESS>:5555
   adb devices # Confirm device is listed over network
   ```
3. **Run the Application**:
   ```bash
   npm start
   # In another terminal:
   npx react-native run-android
   ```
4. **Test Scenario 1: No Dongle Attached on Launch**
   - When the app starts, the state shows **No IR dongle detected** and an alert popup displays: `"Please insert an IR dongle"`.
   - Dismiss the alert. Confirm duplicate alerts do not stack.
5. **Test Scenario 2: Plug in IR Dongle via OTG while App is Open**
   - Connect the IR dongle using an OTG adapter (e.g. USB-C to USB-A female adapter).
   - Android will trigger a system permission prompt: *"Allow IrDongleApp to access [Device Name]?"*.
   - Tap **OK**.
   - The app transitions to **IR dongle connected** (green badge) with **⚡ Auto-Detected VID/PID** and populates:
     - Device Name
     - VID and PID in hex and decimal
     - Manufacturer and Product string
     - Serial Number (if exposed)
6. **Test Scenario 3: Unplug Dongle while App is Open**
   - Unplug the OTG adapter.
   - The app immediately emits `IrDongleDetached`, displays **No IR dongle detected**, and prompts with the alert popup.
7. **Test Scenario 4: Permission Denied**
   - Unplug and reconnect the dongle. When the Android permission dialog appears, tap **Cancel**.
   - The app displays **USB Permission Denied** and presents a **Request Permission / Retry** button.

---

## 6. Assumptions & Limitations

1. **Physical OTG Hardware Required**: Standard Android Virtual Devices (AVDs) lack support for emulated USB host hot-plugging. Verification must take place on hardware supporting USB Host mode (OTG).
2. **Decimal XML IDs for Strict Filters**: When using strict filters in `device_filter.xml`, Android's parser requires base-10 decimal numbers for `vendor-id` and `product-id`. (Our default wildcard `<usb-device />` requires no attributes).
3. **Restricted USB Descriptors**: On Android 10+ (API 29+), calling `UsbDevice.getSerialNumber()` or reading descriptor strings without explicit USB permission throws a `SecurityException`. The native module guards these calls within individual `try/catch` blocks and falls back to `null`.
4. **Ignored Consumer IR Blaster**: Per specification, internal IR LEDs (controlled by Android's `ConsumerIrManager`) are explicitly ignored; only physical USB devices connected via `UsbManager` are handled.
5. **Single Dongle Design**: The native module connects to the primary connected USB peripheral. Multiple simultaneous dongles over an OTG hub are not typical for IR use cases.
