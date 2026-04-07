import SwiftUI
import CoreImage.CIFilterBuiltins

struct GuestPINView: View {
    let guestName: String
    let pin: String
    let expiresAt: String
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Guest Invited")
                    .font(Theme.heading(22))
                    .foregroundColor(Theme.charcoal)
                Spacer()
                Button("Done") { onDone() }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Theme.hearth)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)

            Divider().background(Theme.creamDeep)

            ScrollView {
                VStack(spacing: 24) {
                    Text("Share this code with \(guestName)")
                        .font(.system(size: 16))
                        .foregroundColor(Theme.charcoalSoft)
                        .multilineTextAlignment(.center)

                    Text(pin)
                        .font(.system(size: 40, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.charcoal)
                        .kerning(8)
                        .padding(.vertical, 20)
                        .frame(maxWidth: .infinity)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.radiusMedium)
                                .stroke(Theme.creamDeep, lineWidth: 1.5)
                        )

                    if let qrImage = generateQR(from: pin) {
                        Image(uiImage: qrImage)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 180, height: 180)
                            .padding(16)
                            .background(Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    }

                    Text("Expires \(formattedExpiry)")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.stone)

                    Text("The guest enters this code in the Hearthstone app — or scans the QR code.")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.charcoalSoft)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, 20)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
        .background(Theme.cream)
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
