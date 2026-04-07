# QR Code Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let guests scan a QR code instead of typing a 6-digit PIN.

**Architecture:** `AVFoundation` camera session wrapped in a `UIViewControllerRepresentable`, presented as a sheet from `PINEntryView`. Scanned PIN auto-fills and auto-submits via the existing `onChange` handler.

**Tech Stack:** SwiftUI, AVFoundation, UIKit interop via UIViewControllerRepresentable

**Spec:** `docs/superpowers/specs/2026-04-07-qr-scanner-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `ios/Hearthstone/Views/Auth/QRScannerView.swift` | Create | AVFoundation camera + QR metadata detection |
| `ios/Hearthstone/Views/Auth/PINEntryView.swift` | Modify | Add scan button + scanner sheet |
| `ios/Hearthstone/Info.plist` | Modify | NSCameraUsageDescription |

---

### Task 1: QRScannerView

**Files:**
- Create: `ios/Hearthstone/Views/Auth/QRScannerView.swift`

- [ ] **Step 1: Create QRScannerView**

```swift
// ios/Hearthstone/Views/Auth/QRScannerView.swift
import SwiftUI
import AVFoundation

struct QRScannerView: UIViewControllerRepresentable {
    let onScanned: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onScanned = { pin in
            onScanned(pin)
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}

    class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onScanned: ((String) -> Void)?
        private let captureSession = AVCaptureSession()
        private var hasScanned = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black

            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  captureSession.canAddInput(input) else {
                showPermissionDenied()
                return
            }

            captureSession.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard captureSession.canAddOutput(output) else { return }
            captureSession.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]

            let preview = AVCaptureVideoPreviewLayer(session: captureSession)
            preview.frame = view.bounds
            preview.videoGravity = .resizeAspectFill
            view.layer.addSublayer(preview)

            // Add a close button
            let closeButton = UIButton(type: .system)
            closeButton.setTitle("Cancel", for: .normal)
            closeButton.setTitleColor(.white, for: .normal)
            closeButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
            closeButton.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(closeButton)
            NSLayoutConstraint.activate([
                closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
                closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            ])

            // Add a viewfinder overlay
            let overlay = UIView()
            overlay.layer.borderColor = UIColor.white.withAlphaComponent(0.6).cgColor
            overlay.layer.borderWidth = 2
            overlay.layer.cornerRadius = 12
            overlay.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(overlay)
            NSLayoutConstraint.activate([
                overlay.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                overlay.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                overlay.widthAnchor.constraint(equalToConstant: 220),
                overlay.heightAnchor.constraint(equalToConstant: 220),
            ])

            // Add instruction label
            let label = UILabel()
            label.text = "Point at the QR code"
            label.textColor = .white
            label.font = .systemFont(ofSize: 15)
            label.textAlignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                label.topAnchor.constraint(equalTo: overlay.bottomAnchor, constant: 20),
            ])

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.captureSession.startRunning()
            }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            if let preview = view.layer.sublayers?.first(where: { $0 is AVCaptureVideoPreviewLayer }) as? AVCaptureVideoPreviewLayer {
                preview.frame = view.bounds
            }
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            if captureSession.isRunning {
                captureSession.stopRunning()
            }
        }

        @objc private func closeTapped() {
            dismiss(animated: true)
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !hasScanned,
                  let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  object.type == .qr,
                  let value = object.stringValue,
                  value.count == 6,
                  value.allSatisfy(\.isNumber) else {
                return
            }

            hasScanned = true
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            onScanned?(value)
            dismiss(animated: true)
        }

        private func showPermissionDenied() {
            let label = UILabel()
            label.text = "Camera access is needed to scan QR codes.\n\nOpen Settings to enable it."
            label.textColor = .white
            label.font = .systemFont(ofSize: 15)
            label.textAlignment = .center
            label.numberOfLines = 0
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)

            let button = UIButton(type: .system)
            button.setTitle("Open Settings", for: .normal)
            button.setTitleColor(.systemBlue, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            button.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
            button.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(button)

            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
                label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
                label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),
                button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 20),
            ])
        }

        @objc private func openSettings() {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        }
    }
}
```

- [ ] **Step 2: Add to Xcode project**

Add `QRScannerView.swift` to the Xcode project pbxproj — file reference in the Auth group under Views, build file entry in Sources. Read the pbxproj to find the Auth group and follow the pattern of existing files like `PINEntryView.swift`.

- [ ] **Step 3: Verify it builds**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED (the view exists but isn't used yet)

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Views/Auth/QRScannerView.swift ios/Hearthstone.xcodeproj/project.pbxproj
git commit -m "feat(ios): add QRScannerView with AVFoundation camera"
```

---

### Task 2: Wire Scanner into PINEntryView

**Files:**
- Modify: `ios/Hearthstone/Views/Auth/PINEntryView.swift`

- [ ] **Step 1: Add scanner state and button**

Read `ios/Hearthstone/Views/Auth/PINEntryView.swift` first.

Add a state variable at the top of the struct (alongside the existing `@State` properties):

```swift
@State private var showScanner = false
```

Add a "Scan QR Code" button after the existing "Continue" button and helper text. Find the `Spacer()` before the bottom content and add the scan button. The button should appear between the PIN field error message and the Continue button:

After the `if let error { ... }` block and before the bottom `Spacer()`, add:

```swift
Button {
    showScanner = true
} label: {
    HStack(spacing: 6) {
        Image(systemName: "qrcode.viewfinder")
        Text("Scan QR Code")
    }
    .font(.system(size: 15, weight: .medium))
    .foregroundColor(Theme.hearth)
}
.padding(.top, 20)
```

Add the sheet modifier to the outermost view (the `ZStack`):

```swift
.sheet(isPresented: $showScanner) {
    QRScannerView { scannedPin in
        pin = scannedPin
        showScanner = false
    }
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Views/Auth/PINEntryView.swift
git commit -m "feat(ios): add Scan QR Code button to PINEntryView"
```

---

### Task 3: Info.plist Camera Permission

**Files:**
- Modify: `ios/Hearthstone/Info.plist`

- [ ] **Step 1: Add NSCameraUsageDescription**

In `ios/Hearthstone/Info.plist`, add inside the top-level `<dict>`:

```xml
<key>NSCameraUsageDescription</key>
<string>Hearthstone uses the camera to scan invite QR codes.</string>
```

- [ ] **Step 2: Verify it builds**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Info.plist
git commit -m "feat(ios): add camera permission for QR code scanning"
```

---

### Task 4: End-to-End Verification

- [ ] **Step 1: Full build**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 2: Manual test on physical device**

The QR scanner requires a real camera — it won't work on the simulator. To test:

1. Build to a physical device (or TestFlight)
2. Open Hearthstone → PIN entry screen
3. Tap "Scan QR Code" → camera should open
4. Point at a QR code containing a 6-digit PIN → should auto-fill and submit
5. If camera permission was denied, should show "Open Settings" prompt

On simulator, verify the scan button appears and the sheet opens (it will show a black screen since there's no camera).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(ios): adjustments from QR scanner testing"
```
