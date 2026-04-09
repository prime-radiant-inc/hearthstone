import SwiftUI

struct OwnerPreviewView: View {
    var householdName: String = ""

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @StateObject private var viewModel = ChatViewModel(isPreview: true)

    var body: some View {
        VStack(spacing: 0) {
            // Preview banner
            HStack {
                Label("Owner Preview", systemImage: "eye")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                Spacer()
                Button("Exit Preview") { dismiss() }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    )
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(
                LinearGradient(
                    colors: [
                        theme.previewBannerStart,
                        theme.previewBannerEnd
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )

            ChatView(viewModel: viewModel, householdName: householdName)
        }
    }
}
