import SwiftUI

struct HearthButton: View {
    let title: String
    var isLoading: Bool = false
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                LinearGradient(colors: [theme.hearth, theme.hearthDark], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: theme.hearth.opacity(0.3), radius: 7, y: 4)
        }
        .disabled(isLoading)
    }
}
