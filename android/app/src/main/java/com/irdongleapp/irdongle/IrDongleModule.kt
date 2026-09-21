package com.irdongleapp.irdongle

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Native module for detecting external USB IR dongles (USB OTG) and querying device details.
 *
 * Supports both:
 * 1. DYNAMIC AUTO-DETECTION: Automatically discovers any connected external USB OTG device,
 *    extracts its Vendor ID and Product ID directly from USB descriptors, and requests permissions.
 * 2. STRICT ALLOWLIST: Optionally locks down detection to specific known hardware IDs.
 *
 * NOTE: As per specifications, internal phone IR blasters (ConsumerIrManager) are ignored.
 * Only external USB IR dongles connected via USB Host/OTG are handled.
 */
class IrDongleModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    LifecycleEventListener {

    data class UsbDeviceIdentifier(val vendorId: Int, val productId: Int)

    companion object {
        const val NAME = "IrDongle"
        private const val ACTION_USB_PERMISSION = "com.irdongleapp.USB_PERMISSION"

        // Event names emitted to React Native
        private const val EVENT_ATTACHED = "IrDongleAttached"
        private const val EVENT_DETACHED = "IrDongleDetached"
        private const val EVENT_PERMISSION_DENIED = "IrDonglePermissionDenied"

        /**
         * Optional strict allowlist of known USB IR dongles.
         * If left with placeholder (0x0000 / 0x0000) or empty, the module automatically
         * auto-detects any attached USB OTG dongle!
         */
        val ALLOWLIST: List<UsbDeviceIdentifier> = listOf(
            // REPLACE WITH REAL DONGLE VID/PID (or leave 0x0000 to auto-detect any device)
            UsbDeviceIdentifier(vendorId = 0x0000, productId = 0x0000)
        )

        /**
         * When true, any external USB peripheral connected via OTG is automatically detected
         * if no strict allowlist match is found.
         */
        const val AUTO_DETECT_ANY_DEVICE = true
    }

    private val usbManager: UsbManager? by lazy {
        reactApplicationContext.getSystemService(Context.USB_SERVICE) as? UsbManager
    }

    private var isReceiverRegistered = false

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent == null) return

            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    val device = getDeviceFromIntent(intent) ?: return
                    if (isAcceptableDevice(device)) {
                        handleDeviceAttached(device)
                    }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    val device = getDeviceFromIntent(intent) ?: return
                    if (isAcceptableDevice(device)) {
                        sendEvent(EVENT_DETACHED, null)
                    }
                }
                ACTION_USB_PERMISSION -> {
                    val device = getDeviceFromIntent(intent) ?: return
                    val permissionGranted = intent.getBooleanExtra(
                        UsbManager.EXTRA_PERMISSION_GRANTED,
                        false
                    )

                    if (isAcceptableDevice(device)) {
                        if (permissionGranted) {
                            sendEvent(EVENT_ATTACHED, buildDongleInfo(device))
                        } else {
                            sendEvent(EVENT_PERMISSION_DENIED, null)
                        }
                    }
                }
            }
        }
    }

    init {
        reactApplicationContext.addLifecycleEventListener(this)
        registerUsbReceiver()
    }

    override fun getName(): String = NAME

    /**
     * Checks if a device is a USB hub (class 9) which should not be treated as a dongle.
     */
    private fun isHub(device: UsbDevice): Boolean {
        return device.deviceClass == UsbConstants.USB_CLASS_HUB
    }

    /**
     * Checks if the device strictly matches a non-placeholder entry in ALLOWLIST.
     */
    private fun isStrictlyAllowed(device: UsbDevice): Boolean {
        return ALLOWLIST.any {
            (it.vendorId != 0 || it.productId != 0) &&
                it.vendorId == device.vendorId &&
                it.productId == device.productId
        }
    }

    /**
     * Determines if a USB device should be handled.
     * Rejects USB hubs. Accepts allowlisted devices, or any peripheral if auto-detection is enabled.
     */
    private fun isAcceptableDevice(device: UsbDevice): Boolean {
        if (isHub(device)) return false
        if (isStrictlyAllowed(device)) return true

        val hasConfiguredAllowlist = ALLOWLIST.any { it.vendorId != 0 || it.productId != 0 }
        return AUTO_DETECT_ANY_DEVICE || !hasConfiguredAllowlist
    }

    /**
     * Finds the most relevant connected USB device.
     * Prioritizes strict allowlist matches first; otherwise returns the first candidate USB device.
     */
    private fun findConnectedDongle(): UsbDevice? {
        val manager = usbManager ?: return null
        val devices = manager.deviceList.values.filter { !isHub(it) }

        // 1. Try finding a device that matches the strict allowlist
        val allowlistedDevice = devices.firstOrNull { isStrictlyAllowed(it) }
        if (allowlistedDevice != null) {
            return allowlistedDevice
        }

        // 2. Otherwise return the first acceptable non-hub USB device (Auto-Detection)
        return devices.firstOrNull { isAcceptableDevice(it) }
    }

    /**
     * Retrieves the connected USB dongle.
     * If device is connected and permission is already granted, returns DongleInfo.
     * If device is connected but permission is not yet granted, requests permission and returns null.
     * If no device is connected, returns null.
     */
    @ReactMethod
    fun getConnectedDongle(promise: Promise) {
        val manager = usbManager
        if (manager == null) {
            promise.resolve(null)
            return
        }

        val device = findConnectedDongle()
        if (device == null) {
            promise.resolve(null)
            return
        }

        if (manager.hasPermission(device)) {
            promise.resolve(buildDongleInfo(device))
        } else {
            // Permission needed: request permission dialog asynchronously
            requestUsbPermission(device)
            promise.resolve(null)
        }
    }

    /**
     * Handles USB dongle attachment: checks permission or requests it.
     */
    private fun handleDeviceAttached(device: UsbDevice) {
        val manager = usbManager ?: return
        if (manager.hasPermission(device)) {
            sendEvent(EVENT_ATTACHED, buildDongleInfo(device))
        } else {
            requestUsbPermission(device)
        }
    }

    /**
     * Requests USB permission from the user using a PendingIntent.
     * Android 12+ (API 31+) strictly requires FLAG_MUTABLE because UsbManager mutates the intent extras.
     * Explicit package name is set to guarantee package-internal routing.
     */
    private fun requestUsbPermission(device: UsbDevice) {
        val manager = usbManager ?: return

        val permissionIntent = Intent(ACTION_USB_PERMISSION).apply {
            setPackage(reactApplicationContext.packageName)
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getBroadcast(
            reactApplicationContext,
            0,
            permissionIntent,
            flags
        )

        manager.requestPermission(device, pendingIntent)
    }

    /**
     * Builds DongleInfo WritableMap.
     * Accessing manufacturerName, productName, or serialNumber requires USB permission
     * and may throw SecurityException on newer Android versions.
     */
    private fun buildDongleInfo(device: UsbDevice): WritableMap {
        val map = Arguments.createMap()
        map.putString("deviceName", device.deviceName)
        map.putInt("vendorId", device.vendorId)
        map.putInt("productId", device.productId)
        map.putBoolean("isAutoDetected", !isStrictlyAllowed(device))

        val manufacturerName = try {
            device.manufacturerName
        } catch (e: SecurityException) {
            null
        }
        if (manufacturerName != null) {
            map.putString("manufacturerName", manufacturerName)
        } else {
            map.putNull("manufacturerName")
        }

        val productName = try {
            device.productName
        } catch (e: SecurityException) {
            null
        }
        if (productName != null) {
            map.putString("productName", productName)
        } else {
            map.putNull("productName")
        }

        val serialNumber = try {
            device.serialNumber
        } catch (e: SecurityException) {
            null
        }
        if (serialNumber != null) {
            map.putString("serialNumber", serialNumber)
        } else {
            map.putNull("serialNumber")
        }

        return map
    }

    /**
     * Extracts UsbDevice safely across Android API versions.
     */
    private fun getDeviceFromIntent(intent: Intent): UsbDevice? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }
    }

    /**
     * Emits events to JavaScript via RCTDeviceEventEmitter.
     */
    private fun sendEvent(eventName: String, params: Any?) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    /**
     * Registers the BroadcastReceiver using ContextCompat.RECEIVER_NOT_EXPORTED for Android 13/14+.
     */
    @Synchronized
    private fun registerUsbReceiver() {
        if (!isReceiverRegistered) {
            val filter = IntentFilter().apply {
                addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
                addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
                addAction(ACTION_USB_PERMISSION)
            }
            ContextCompat.registerReceiver(
                reactApplicationContext,
                usbReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            isReceiverRegistered = true
        }
    }

    /**
     * Safely unregisters the BroadcastReceiver.
     */
    @Synchronized
    private fun unregisterUsbReceiver() {
        if (isReceiverRegistered) {
            try {
                reactApplicationContext.unregisterReceiver(usbReceiver)
            } catch (e: IllegalArgumentException) {
                // Already unregistered or not registered
            } finally {
                isReceiverRegistered = false
            }
        }
    }

    // LifecycleEventListener callbacks
    override fun onHostResume() {}

    override fun onHostPause() {}

    override fun onHostDestroy() {
        unregisterUsbReceiver()
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        unregisterUsbReceiver()
        reactApplicationContext.removeLifecycleEventListener(this)
    }

    // NativeEventEmitter stub methods to prevent React Native console warnings
    @ReactMethod
    fun addListener(eventName: String) {
        // Keep: Required for RN NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Keep: Required for RN NativeEventEmitter
    }
}
