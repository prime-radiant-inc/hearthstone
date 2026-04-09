import SwiftUI

struct HearthTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var autocapitalization: TextInputAutocapitalization = .sentences

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(theme.charcoalSoft)
                .tracking(0.8)

            TextField(placeholder, text: $text)
                .font(.system(size: 17))
                .padding(16)
                .background(theme.creamWarm)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(theme.creamDeep, lineWidth: 1.5)
                )
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
        }
    }
}
