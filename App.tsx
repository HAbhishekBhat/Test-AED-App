import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/**
 * Details of an external USB IR dongle.
 */
export interface DongleInfo {
  deviceName: string;
  vendorId: number;
  productId: number;
  isAutoDetected?: boolean;
  manufacturerName?: string | null;
  productName?: string | null;
  serialNumber?: string | null;
}

type ConnectionStatus =
  | 'INITIALIZING'
  | 'CONNECTED'
  | 'NOT_CONNECTED'
  | 'PERMISSION_DENIED';

interface IrDongleNativeModuleInterface {
  getConnectedDongle(): Promise<DongleInfo | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const {IrDongle} = NativeModules;
const irDongleNative = IrDongle as IrDongleNativeModuleInterface;

// NativeEventEmitter allows subscribing to native USB events emitted from IrDongleModule.kt
const irDongleEventEmitter = new NativeEventEmitter(IrDongle);

/**
 * Formats a numeric ID into 4-digit uppercase hexadecimal string (e.g., 0x1A86).
 */
const formatHex = (value: number): string => {
  return '0x' + value.toString(16).toUpperCase().padStart(4, '0');
};

const App: React.FC = () => {
  const [dongle, setDongle] = useState<DongleInfo | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('INITIALIZING');
  const isAlertShowingRef = useRef<boolean>(false);

  /**
   * Displays the non-stacking alert prompting the user to connect an IR dongle.
   */
  const showInsertDongleAlert = useCallback(() => {
    if (isAlertShowingRef.current) {
      return;
    }
    isAlertShowingRef.current = true;
    Alert.alert(
      'IR Dongle Required',
      'Please insert an IR dongle',
      [
        {
          text: 'OK',
          onPress: () => {
            isAlertShowingRef.current = false;
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          isAlertShowingRef.current = false;
        },
      },
    );
  }, []);

  /**
   * Refreshes or retries dongle detection and permission check.
   */
  const checkDongleStatus = useCallback(async () => {
    try {
      const connectedDevice = await irDongleNative.getConnectedDongle();
      if (connectedDevice) {
        setDongle(connectedDevice);
        setStatus('CONNECTED');
      } else {
        setDongle(null);
        setStatus('NOT_CONNECTED');
        showInsertDongleAlert();
      }
    } catch (error) {
      console.warn('[IrDongle] Error querying dongle:', error);
      setDongle(null);
      setStatus('NOT_CONNECTED');
      showInsertDongleAlert();
    }
  }, [showInsertDongleAlert]);

  useEffect(() => {
    // 1. Initial scan on component mount
    checkDongleStatus();

    // 2. Subscribe to native module events
    const attachedSubscription = irDongleEventEmitter.addListener(
      'IrDongleAttached',
      (device: DongleInfo) => {
        setDongle(device);
        setStatus('CONNECTED');
      },
    );

    const detachedSubscription = irDongleEventEmitter.addListener(
      'IrDongleDetached',
      () => {
        setDongle(null);
        setStatus('NOT_CONNECTED');
        showInsertDongleAlert();
      },
    );

    const permissionDeniedSubscription = irDongleEventEmitter.addListener(
      'IrDonglePermissionDenied',
      () => {
        setDongle(null);
        setStatus('PERMISSION_DENIED');
      },
    );

    // 3. Clean up event subscriptions on unmount
    return () => {
      attachedSubscription.remove();
      detachedSubscription.remove();
      permissionDeniedSubscription.remove();
    };
  }, [checkDongleStatus, showInsertDongleAlert]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* App Header */}
        <View style={styles.header}>
          <Text style={styles.title}>USB IR Dongle Monitor</Text>
          <Text style={styles.subtitle}>
            External USB-OTG Infrared Dongle Detector
          </Text>
        </View>

        {/* State: CONNECTED */}
        {status === 'CONNECTED' && dongle && (
          <View style={styles.section}>
            {/* Status Badges */}
            <View style={styles.badgeRow}>
              <View style={[styles.statusBadge, styles.statusBadgeConnected]}>
                <View style={[styles.statusDot, styles.statusDotConnected]} />
                <Text style={styles.statusTextConnected}>
                  IR dongle connected
                </Text>
              </View>

              {dongle.isAutoDetected ? (
                <View style={styles.autoDetectBadge}>
                  <Text style={styles.autoDetectBadgeText}>
                    ⚡ Auto-Detected VID/PID
                  </Text>
                </View>
              ) : (
                <View style={styles.allowlistBadge}>
                  <Text style={styles.allowlistBadgeText}>
                    ✓ Verified Allowlist
                  </Text>
                </View>
              )}
            </View>

            {/* Dongle Details Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Device Details</Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Device Name:</Text>
                <Text style={styles.detailValue}>{dongle.deviceName}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Vendor ID (VID):</Text>
                <Text style={styles.detailValueCode}>
                  {formatHex(dongle.vendorId)} ({dongle.vendorId})
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Product ID (PID):</Text>
                <Text style={styles.detailValueCode}>
                  {formatHex(dongle.productId)} ({dongle.productId})
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Manufacturer:</Text>
                <Text style={styles.detailValue}>
                  {dongle.manufacturerName || 'N/A (unspecified by device)'}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Product:</Text>
                <Text style={styles.detailValue}>
                  {dongle.productName || 'N/A (unspecified by device)'}
                </Text>
              </View>

              <View style={[styles.detailRow, styles.lastDetailRow]}>
                <Text style={styles.detailLabel}>Serial Number:</Text>
                <Text style={styles.detailValue}>
                  {dongle.serialNumber || 'N/A'}
                </Text>
              </View>
            </View>

            {/* Information Callout for Auto-Detected IDs */}
            {dongle.isAutoDetected && (
              <View style={styles.calloutCard}>
                <Text style={styles.calloutTitle}>Discovered Hardware IDs</Text>
                <Text style={styles.calloutText}>
                  Your device was automatically discovered:
                </Text>
                <Text style={styles.calloutCode}>
                  VID: {formatHex(dongle.vendorId)} (decimal: {dongle.vendorId})
                  {'\n'}
                  PID: {formatHex(dongle.productId)} (decimal: {dongle.productId})
                </Text>
                <Text style={styles.calloutSubtext}>
                  The app will communicate with this dongle immediately. If you
                  ever wish to strictly restrict the app to only this device model,
                  these are the exact values to use in ALLOWLIST and device_filter.xml.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* State: NOT CONNECTED / INITIALIZING */}
        {(status === 'NOT_CONNECTED' || status === 'INITIALIZING') && (
          <View style={styles.section}>
            {/* Status Badge */}
            <View style={[styles.statusBadge, styles.statusBadgeDisconnected]}>
              <View style={[styles.statusDot, styles.statusDotDisconnected]} />
              <Text style={styles.statusTextDisconnected}>
                {status === 'INITIALIZING'
                  ? 'Scanning for IR dongle...'
                  : 'No IR dongle detected'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardBodyText}>
                Connect any external USB IR dongle to the phone via USB OTG. The
                app will automatically detect attachment, discover its Vendor ID
                and Product ID, and request USB host permissions.
              </Text>

              <TouchableOpacity
                style={styles.actionButton}
                activeOpacity={0.8}
                onPress={checkDongleStatus}>
                <Text style={styles.actionButtonText}>Scan Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* State: PERMISSION DENIED */}
        {status === 'PERMISSION_DENIED' && (
          <View style={styles.section}>
            {/* Status Badge */}
            <View style={[styles.statusBadge, styles.statusBadgeWarning]}>
              <View style={[styles.statusDot, styles.statusDotWarning]} />
              <Text style={styles.statusTextWarning}>
                USB Permission Denied
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardBodyText}>
                USB host permission is required to access the IR dongle details
                and transmit/receive signals. Please grant permission when
                prompted by Android.
              </Text>

              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonRetry]}
                activeOpacity={0.8}
                onPress={checkDongleStatus}>
                <Text style={styles.actionButtonText}>
                  Request Permission / Retry
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 20,
    flexGrow: 1,
  },
  header: {
    marginBottom: 24,
    paddingTop: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  section: {
    gap: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  autoDetectBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  autoDetectBadgeText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  allowlistBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: '#A855F7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  allowlistBadgeText: {
    color: '#C084FC',
    fontWeight: '600',
    fontSize: 13,
  },
  statusBadgeConnected: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  statusBadgeDisconnected: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  statusBadgeWarning: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusDotConnected: {
    backgroundColor: '#22C55E',
  },
  statusDotDisconnected: {
    backgroundColor: '#EF4444',
  },
  statusDotWarning: {
    backgroundColor: '#EAB308',
  },
  statusTextConnected: {
    color: '#4ADE80',
    fontWeight: '600',
    fontSize: 15,
  },
  statusTextDisconnected: {
    color: '#F87171',
    fontWeight: '600',
    fontSize: 15,
  },
  statusTextWarning: {
    color: '#FDE047',
    fontWeight: '600',
    fontSize: 15,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 8,
  },
  cardBodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#CBD5E1',
    marginBottom: 18,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center',
  },
  lastDetailRow: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  detailLabel: {
    fontSize: 14,
    color: '#94A3B8',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F8FAFC',
    flex: 1.4,
    textAlign: 'right',
  },
  detailValueCode: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#38BDF8',
    flex: 1.4,
    textAlign: 'right',
  },
  calloutCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#0284C7',
  },
  calloutTitle: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  calloutText: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 6,
  },
  calloutCode: {
    fontFamily: 'monospace',
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 6,
    marginVertical: 6,
  },
  calloutSubtext: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  actionButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  actionButtonRetry: {
    backgroundColor: '#D97706',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default App;
