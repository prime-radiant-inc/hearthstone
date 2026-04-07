# QR Code Scanner Design (Chunk 3)

## Goal

Let guests scan a QR code instead of typing a 6-digit PIN. The owner already shows a QR code when inviting a guest — the guest just has no way to read it.

## Problem

`GuestPINView` generates a QR code encoding the PIN digits, but the Hearthstone app has no camera scanner. The guest must read the 6 digits visually and type them. This is friction — especially for less technical guests (babysitters, house-sitters).

## Design

### Camera Scanner in PINEntryView

Add a "Scan QR Code" button below the PIN text field on the `PINEntryView`. Tapping it opens a camera view that reads QR codes. When a valid 6-digit PIN is scanned, it auto-fills and auto-submits — same as typing the 6th digit does today.

### Implementation

**SwiftUI has no built-in QR scanner.** Use `AVFoundation`'s `AVCaptureMetadataOutput` with a `UIViewControllerRepresentable` wrapper. This is the standard iOS approach — no third-party dependencies.

**New file: `QRScannerView.swift`**

A `UIViewControllerRepresentable` that:
1. Creates an `AVCaptureSession` with the back camera
2. Adds an `AVCaptureMetadataOutput` filtering for `.qr` metadata type
3. When a QR code is detected, extracts the string value
4. If the value is exactly 6 digits, calls `onScanned(pin: String)`
5. Dismisses itself

**Camera permission:** iOS requires `NSCameraUsageDescription` in Info.plist. Add: "Hearthstone uses the camera to scan invite QR codes."

**Integration with PINEntryView:**
- Add a `@State private var showScanner = false` 
- Add a "Scan QR Code" button with a camera icon below the PIN field
- Present the scanner as a `.sheet`
- When `onScanned` fires, set `pin = scannedValue` which triggers the existing `onChange` auto-submit at 6 digits

### What the QR Encodes

Currently `GuestPINView` encodes just the PIN digits (e.g., "482901"). The scanner reads this and fills the PIN field. No URL scheme, no deep link — just 6 digits. This keeps it simple and works with the existing flow.

### Edge Cases

- **Camera denied:** Show an alert explaining why the camera is needed, with a button to open Settings.
- **Invalid QR content:** Ignore any QR code that isn't exactly 6 digits. The scanner keeps running until a valid one is found or the user dismisses.
- **Simulator:** Camera isn't available on the simulator. Hide the scan button when running on simulator (check `ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]`). Or just let it fail gracefully — the sheet shows a black screen.

### No Backend Changes

This is purely iOS. The PIN flow is unchanged — the QR code just provides an alternative input method for the same 6-digit PIN.

## Scope

**In scope:**
- QRScannerView (AVFoundation camera + QR detection)
- "Scan QR Code" button on PINEntryView
- NSCameraUsageDescription in Info.plist
- Camera permission handling

**Out of scope:**
- Changing what the QR code encodes (URLs, deep links)
- QR scanning from photo library
- QR code generation changes

## File Impact

| File | Action |
|------|--------|
| `ios/Hearthstone/Views/Auth/QRScannerView.swift` | Create — AVFoundation scanner |
| `ios/Hearthstone/Views/Auth/PINEntryView.swift` | Modify — add scan button + sheet |
| `ios/Hearthstone/Info.plist` | Modify — add NSCameraUsageDescription |
