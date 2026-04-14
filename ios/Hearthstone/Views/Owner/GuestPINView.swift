import SwiftUI
import CoreImage.CIFilterBuiltins

struct GuestPINView: View {
    let guestName: String
    let pin: String
    let joinURL: URL
    let expiresAt: String
    let onDone: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Guest Invited")
                    .font(Theme.heading(22))
                    .foregroundColor(theme.charcoal)
                Spacer()
                Button("Done") { onDone() }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.hearth)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)

            Divider().background(theme.creamDeep)

            ScrollView {
                VStack(spacing: 24) {
                    Text("Send this to \(guestName) — they can tap the link or scan the QR.")
                        .font(.system(size: 16))
                        .foregroundColor(theme.charcoalSoft)
                        .multilineTextAlignment(.center)

                    if let qrImage = generateQR(from: joinURL.absoluteString) {
                        Image(uiImage: qrImage)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 220, height: 220)
                            .padding(16)
                            .background(theme.creamWarm)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    }

                    ShareLink(item: joinURL) {
                        HStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.up")
                            Text("Share link")
                        }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(theme.hearth)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 20)
                        .background(theme.creamWarm)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    Text(pin)
                        .font(.system(size: 28, weight: .semibold, design: .monospaced))
                        .foregroundColor(theme.charcoalSoft)
                        .kerning(4)

                    Text("Expires \(formattedExpiry)")
                        .font(.system(size: 13))
                        .foregroundColor(theme.stone)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
        .background(theme.cream)
    }

    private var formattedExpiry: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: expiresAt) else { return expiresAt }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func generateQR(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
